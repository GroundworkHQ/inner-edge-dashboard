// One-off (and safe to re-run) full load of every Stripe customer and
// subscription, so the dashboard is right from day one instead of only
// knowing about events that arrive after the webhook goes live.
// Trigger manually with the x-ies-cron-secret header.
import { admin, cronAuthorised, json, logRun, upsertChunked } from "../_shared/ies.ts";
import {
  customerRow, refundedFirstPaymentSubs, subRow, type StripeCharge, type StripeCustomer, type StripeSub,
} from "../_shared/stripe_map.ts";
import { accountArgs, stripe } from "../_shared/stripe_client.ts";
import { runPastDueAlerts } from "../_shared/member_alerts.ts";

Deno.serve(async (req) => {
  if (!cronAuthorised(req)) return json({ error: "unauthorised" }, 401);
  const db = admin();
  try {
    const s = stripe();
    const opts = accountArgs();

    const customers: ReturnType<typeof customerRow>[] = [];
    for await (const c of s.customers.list({ limit: 100 }, ...opts)) customers.push(customerRow(c as unknown as StripeCustomer));

    const subs: ReturnType<typeof subRow>[] = [];
    for await (const sub of s.subscriptions.list({ status: "all", limit: 100 }, ...opts)) subs.push(subRow(sub as unknown as StripeSub));

    await upsertChunked(db, "ies_stripe_customers", customers, "customer_id");
    await upsertChunked(db, "ies_stripe_subscriptions", subs, "subscription_id");

    // Safety net for the charge.refunded webhook: flag signups whose first
    // payment was fully refunded. Needs Charges: Read on the restricted key;
    // without it this is skipped and noted, and the sync still succeeds.
    let refunds: string;
    try {
      const since = Math.floor(Date.now() / 1000) - 62 * 86400; // covers this month and last
      const charges: StripeCharge[] = [];
      for await (const ch of s.charges.list({ created: { gte: since }, limit: 100 }, ...opts)) {
        if (ch.refunded) charges.push(ch as unknown as StripeCharge);
      }
      const ids = refundedFirstPaymentSubs(charges, subs);
      // Authoritative for the scanned window: set the matches, clear the rest.
      // Older subscriptions keep whatever flag they had.
      const windowStart = new Date((since + 600) * 1000).toISOString();
      const { error: clearErr } = await db.from("ies_stripe_subscriptions")
        .update({ first_payment_refunded: false })
        .eq("first_payment_refunded", true).gte("started_at", windowStart)
        .not("subscription_id", "in", `(${ids.map((i) => `"${i}"`).join(",") || '""'})`);
      if (clearErr) throw new Error(clearErr.message);
      if (ids.length) {
        const { error } = await db.from("ies_stripe_subscriptions")
          .update({ first_payment_refunded: true }).in("subscription_id", ids);
        if (error) throw new Error(error.message);
      }
      refunds = `${ids.length} refunded signups`;
    } catch (e) { refunds = `refund check skipped: ${(e as Error).message}`; }

    // Discord past-due alerts ride on this sync. A Discord failure is noted in
    // the run detail but never fails the Stripe sync itself.
    let alerts: string;
    try { alerts = await runPastDueAlerts(db); } catch (e) { alerts = `alerts failed: ${(e as Error).message}`; }

    const detail = `${customers.length} customers, ${subs.length} subscriptions; ${refunds}; ${alerts}`;
    await logRun(db, "stripe-backfill", true, detail);
    return json({ ok: true, detail });
  } catch (e) {
    await logRun(db, "stripe-backfill", false, (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
