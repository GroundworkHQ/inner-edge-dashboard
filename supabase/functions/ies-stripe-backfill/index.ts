// One-off (and safe to re-run) full load of every Stripe customer and
// subscription, so the dashboard is right from day one instead of only
// knowing about events that arrive after the webhook goes live.
// Trigger manually with the x-ies-cron-secret header.
import { admin, cronAuthorised, json, logRun, upsertChunked } from "../_shared/ies.ts";
import { customerRow, subRow, type StripeCustomer, type StripeSub } from "../_shared/stripe_map.ts";
import { accountArgs, stripe } from "../_shared/stripe_client.ts";

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

    const detail = `${customers.length} customers, ${subs.length} subscriptions`;
    await logRun(db, "stripe-backfill", true, detail);
    return json({ ok: true, detail });
  } catch (e) {
    await logRun(db, "stripe-backfill", false, (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
