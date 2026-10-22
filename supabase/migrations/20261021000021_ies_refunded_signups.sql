-- inner-edge-dashboard: a signup whose first payment was fully refunded is not
-- a real join, so it no longer counts as "New This Month". It still counts as
-- churned and cancelled, because the membership did start and end.
-- Set by the charge.refunded webhook (instant) and the hourly Stripe backfill
-- (safety net, needs Charges: Read on the restricted key).
alter table public.ies_stripe_subscriptions
  add column first_payment_refunded boolean not null default false;

-- Same columns as before; only is_new changes.
create or replace view public.ies_v_members with (security_invoker = true) as
with bounds as (
  select (date_trunc('month', now() at time zone 'Europe/London') at time zone 'Europe/London') as month_start
)
select
  s.subscription_id,
  s.customer_id,
  c.name,
  c.email,
  s.status,
  s.started_at,
  s.ended_at,
  s.current_period_end,
  s.status in ('active', 'past_due')                         as is_paying,
  s.started_at >= b.month_start and not s.first_payment_refunded as is_new,
  s.ended_at   >= b.month_start                              as is_churned,
  s.status = 'past_due'                                      as is_past_due,
  s.status = 'active' and s.cancel_at_period_end             as is_cancelling
from public.ies_stripe_subscriptions s
left join public.ies_stripe_customers c on c.customer_id = s.customer_id
cross join bounds b
where s.status not in ('incomplete', 'incomplete_expired');

revoke all on public.ies_v_members from anon, authenticated;
grant select on public.ies_v_members to authenticated;
