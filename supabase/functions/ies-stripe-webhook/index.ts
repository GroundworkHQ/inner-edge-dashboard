// Stripe → ies_stripe_*  (instant updates)
// Verifies the Stripe signature on every call, ignores events it has already
// seen, and never writes anything back to Stripe.
import Stripe from "npm:stripe@17";
import { admin, env, json, logRun, PROJECT_ID } from "../_shared/ies.ts";
import {
  customerRow, refundedFirstPaymentSubs, subRow, type StripeCharge, type StripeCustomer, type StripeSub,
} from "../_shared/stripe_map.ts";
import { accountArgs, stripe } from "../_shared/stripe_client.ts";

const HANDLED = new Set([
  "customer.created",
  "customer.updated",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "charge.refunded",
]);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const sig = req.headers.get("stripe-signature");
  if (!sig) return json({ error: "no signature" }, 400);
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await Stripe.webhooks.constructEventAsync(
      body, sig, env("IES_STRIPE_WEBHOOK_SECRET"), undefined, Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return json({ error: "bad signature" }, 400);
  }

  // On a Connect platform endpoint, only accept the Inner Edge account.
  const acct = Deno.env.get("IES_STRIPE_ACCOUNT")?.trim();
  if (acct && event.account && event.account !== acct) return json({ ignored: "other account" });
  if (!HANDLED.has(event.type)) return json({ ignored: event.type });

  const db = admin();
  // Idempotency: first writer wins; a retry of the same event is a no-op.
  const { error: seenErr } = await db.from("ies_stripe_events")
    .insert({ project_id: PROJECT_ID, event_id: event.id, type: event.type });
  if (seenErr) {
    if (seenErr.code === "23505") return json({ duplicate: true });
    return json({ error: seenErr.message }, 500);
  }

  try {
    if (event.type === "charge.refunded") {
      // The event carries the charge, so no Stripe call is needed. Only a full
      // refund of a signup's first payment takes it out of "New This Month".
      const ch = event.data.object as unknown as StripeCharge;
      const cus = !ch.customer ? null : typeof ch.customer === "string" ? ch.customer : ch.customer.id;
      if (ch.refunded && cus) {
        const { data: subs, error: readErr } = await db.from("ies_stripe_subscriptions")
          .select("subscription_id, customer_id, started_at").eq("customer_id", cus);
        if (readErr) throw new Error(readErr.message);
        const ids = refundedFirstPaymentSubs([ch], subs ?? []);
        if (ids.length) {
          const { error } = await db.from("ies_stripe_subscriptions")
            .update({ first_payment_refunded: true }).in("subscription_id", ids);
          if (error) throw new Error(error.message);
        }
      }
    } else if (event.type.startsWith("customer.subscription.")) {
      // Stripe does not guarantee event order, so an older event could land
      // after a newer one. Re-read the subscription's CURRENT state instead of
      // trusting the event body; the order then stops mattering.
      const evSub = event.data.object as unknown as StripeSub;
      const sub = await stripe().subscriptions.retrieve(evSub.id, {}, ...accountArgs()) as unknown as StripeSub;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      // Make sure we know who the customer is (email is how everything joins up).
      const { data: known } = await db.from("ies_stripe_customers").select("customer_id").eq("customer_id", customerId).maybeSingle();
      if (!known) {
        const c = await stripe().customers.retrieve(customerId, {}, ...accountArgs()) as unknown as StripeCustomer;
        if (!c.deleted) await db.from("ies_stripe_customers").upsert(customerRow(c), { onConflict: "customer_id" });
      }
      const { error } = await db.from("ies_stripe_subscriptions").upsert(subRow(sub), { onConflict: "subscription_id" });
      if (error) throw new Error(error.message);
    } else {
      const c = event.data.object as unknown as StripeCustomer;
      const { error } = await db.from("ies_stripe_customers").upsert(customerRow(c), { onConflict: "customer_id" });
      if (error) throw new Error(error.message);
    }
    await logRun(db, "stripe", true, event.type);
    return json({ ok: true });
  } catch (e) {
    // Let Stripe retry: forget the event so the retry is processed.
    await db.from("ies_stripe_events").delete().eq("event_id", event.id);
    await logRun(db, "stripe", false, `${event.type}: ${(e as Error).message}`);
    return json({ error: "processing failed" }, 500);
  }
});
