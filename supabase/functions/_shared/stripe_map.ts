// Turns Stripe objects into ies_ rows. Kept free of I/O so it can be unit tested.
import { lower, PROJECT_ID } from "./ies.ts";

type Recurring = { interval: "day" | "week" | "month" | "year"; interval_count: number };
type Item = { quantity?: number | null; current_period_end?: number | null; price: { unit_amount: number | null; currency: string; recurring: Recurring | null } };
export type StripeSub = {
  id: string;
  customer: string | { id: string };
  status: string;
  items: { data: Item[] };
  start_date?: number | null;
  canceled_at?: number | null;
  cancel_at_period_end?: boolean;
  ended_at?: number | null;
  current_period_end?: number | null;
};
export type StripeCustomer = { id: string; email?: string | null; name?: string | null; created?: number; deleted?: boolean };

const iso = (t?: number | null) => (t ? new Date(t * 1000).toISOString() : null);

// Price per month in cents, quantity included. Discounts and coupons are NOT
// applied, so this can read slightly above Stripe's own MRR if any are in use.
export function monthlyCents(items: Item[]): number {
  let total = 0;
  for (const it of items) {
    const unit = it.price.unit_amount ?? 0;
    const qty = it.quantity ?? 1;
    const r = it.price.recurring;
    if (!r) continue;
    const perMonth: Record<Recurring["interval"], number> = { day: 365 / 12, week: 52 / 12, month: 1, year: 1 / 12 };
    total += (unit * qty * perMonth[r.interval]) / (r.interval_count || 1);
  }
  return Math.round(total);
}

export function subRow(s: StripeSub) {
  return {
    project_id: PROJECT_ID,
    subscription_id: s.id,
    customer_id: typeof s.customer === "string" ? s.customer : s.customer.id,
    status: s.status,
    monthly_amount_cents: monthlyCents(s.items.data),
    currency: s.items.data[0]?.price.currency ?? null,
    started_at: iso(s.start_date),
    canceled_at: iso(s.canceled_at),
    cancel_at_period_end: !!s.cancel_at_period_end,
    ended_at: iso(s.ended_at),
    // Newer Stripe API versions moved this onto the subscription item.
    current_period_end: iso(s.current_period_end ?? s.items.data[0]?.current_period_end),
    updated_at: new Date().toISOString(),
  };
}

export function customerRow(c: StripeCustomer) {
  return {
    project_id: PROJECT_ID,
    customer_id: c.id,
    email: lower(c.email),
    name: c.name ?? null,
    created_at: iso(c.created),
    updated_at: new Date().toISOString(),
  };
}
