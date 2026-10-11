-- inner-edge-dashboard: per-member view behind the stat-card name dropdowns.
-- Failed first payments (incomplete / incomplete_expired) are not members, so
-- they no longer count as "new" or "churned". ies_v_metrics now counts from
-- this view so the numbers and the name lists can never disagree.
create view public.ies_v_members with (security_invoker = true) as
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
  s.started_at >= b.month_start                              as is_new,
  s.ended_at   >= b.month_start                              as is_churned,
  s.status = 'past_due'                                      as is_past_due,
  s.status = 'active' and s.cancel_at_period_end             as is_cancelling
from public.ies_stripe_subscriptions s
left join public.ies_stripe_customers c on c.customer_id = s.customer_id
cross join bounds b
where s.status not in ('incomplete', 'incomplete_expired');

create or replace view public.ies_v_metrics with (security_invoker = true) as
select
  (select coalesce(sum(monthly_amount_cents), 0) from public.ies_stripe_subscriptions
     where status in ('active', 'past_due'))                                         as mrr_cents,
  (select currency from public.ies_stripe_subscriptions
     where status in ('active', 'past_due') and currency is not null
     group by currency order by count(*) desc limit 1)                              as currency,
  (select count(distinct customer_id) from public.ies_v_members where is_paying)     as paid_members,
  (select count(distinct customer_id) from public.ies_v_members where is_past_due)   as past_due,
  (select count(distinct customer_id) from public.ies_v_members where is_cancelling) as cancelling,
  (select count(distinct customer_id) from public.ies_v_members where is_new)        as new_this_month,
  (select count(distinct customer_id) from public.ies_v_members where is_churned)    as churned_this_month,
  (select count(*) from public.ies_v_people where (is_staff or is_comp) and not is_paying) as comps_staff,
  (select count(*) from public.ies_v_people
     where email is not null and not ever_subscribed and not is_staff and not is_comp) as never_paid,
  (select count(*) from public.ies_v_discord)                                        as discord_members,
  (select count(*) from public.ies_v_discord where status in ('not_paying', 'unmatched')) as discord_not_paying,
  (select count(*) from public.ies_v_discord where status = 'unmatched')             as discord_unmatched;

revoke all on public.ies_v_members from anon, authenticated;
grant select on public.ies_v_members to authenticated;

-- A failed first payment is not "ever subscribed": those people belong in
-- "Signed Up, Never Paid".
create or replace view public.ies_v_ever_subscribed with (security_invoker = true) as
select distinct lower(c.email) as email
from public.ies_stripe_subscriptions s
join public.ies_stripe_customers c on c.customer_id = s.customer_id
where c.email is not null and s.status not in ('incomplete', 'incomplete_expired');

-- One-off, run 2026-10-10: rebuild daily MRR history from subscription start/end
-- dates so the trend line isn't empty on day one. Real snapshots take over from here.
-- insert into public.ies_mrr_daily (project_id, day, mrr_cents, paid_members, taken_at)
-- select 'inner-edge', d::date, coalesce(sum(s.monthly_amount_cents), 0), count(distinct s.customer_id), now()
-- from generate_series(date '2026-03-04', (now() at time zone 'Europe/London')::date - 1, interval '1 day') d
-- left join public.ies_stripe_subscriptions s
--   on s.status not in ('incomplete', 'incomplete_expired')
--  and (s.started_at at time zone 'Europe/London')::date <= d::date
--  and (s.ended_at is null or (s.ended_at at time zone 'Europe/London')::date > d::date)
-- group by d on conflict (project_id, day) do nothing;
