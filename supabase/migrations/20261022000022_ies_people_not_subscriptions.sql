-- inner-edge-dashboard: New and Churned count PEOPLE, not subscriptions.
--
-- 2026-10-22: a member whose subscription ended one day and who signed up again
-- the next showed as both Churned and New this month, though they never really
-- left. The Cancelled list already skips anyone paying now; these two
-- flags now follow the same idea.
--
--   is_churned: ended this month AND the customer has no paying subscription now.
--   is_new:     started this month AND the customer was not a member on the 1st
--               (a returning member who left in an earlier month still counts).
--
-- Same columns, same order as before; only those two flags change, so
-- ies_v_metrics and the gap views keep working unchanged.
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
  s.started_at >= b.month_start and not s.first_payment_refunded
    and not exists (
      select 1 from public.ies_stripe_subscriptions o
      where o.customer_id = s.customer_id
        and o.project_id = s.project_id
        and o.subscription_id <> s.subscription_id
        and o.status not in ('incomplete', 'incomplete_expired')
        and o.started_at < b.month_start
        and coalesce(o.ended_at, 'infinity'::timestamptz) >= b.month_start
    )                                                        as is_new,
  s.ended_at >= b.month_start
    and not exists (
      select 1 from public.ies_stripe_subscriptions o
      where o.customer_id = s.customer_id
        and o.project_id = s.project_id
        and o.status in ('active', 'past_due')
    )                                                        as is_churned,
  s.status = 'past_due'                                      as is_past_due,
  s.status = 'active' and s.cancel_at_period_end             as is_cancelling
from public.ies_stripe_subscriptions s
left join public.ies_stripe_customers c on c.customer_id = s.customer_id
cross join bounds b
where s.status not in ('incomplete', 'incomplete_expired');

revoke all on public.ies_v_members from anon, authenticated;
grant select on public.ies_v_members to authenticated;
