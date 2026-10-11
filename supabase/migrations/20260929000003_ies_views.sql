-- inner-edge-dashboard: the numbers
-- All views are security_invoker, so they run with the viewer's own RLS and
-- can never be used to read around it. Months are counted in UK time, since
-- that is where the business and most members are.
--
-- DEFINITIONS (the dashboard labels these, keep them in sync with docs §1)
--   paying     = a Stripe subscription that is active or past_due
--                (past_due still counts toward MRR, same as Stripe's own MRR)
--   comps/staff = GHL tag ies-member (comps) or ies-team (staff), not paying
--   never paid  = a GHL contact whose email has never had any subscription,
--                excluding comps/staff
--   discord not paying = a non-bot Discord member who is not linked, through
--                GHL's Discord Username, to a paying email or to comps/staff

create view public.ies_v_paying with (security_invoker = true) as
select distinct lower(c.email) as email, s.customer_id
from public.ies_stripe_subscriptions s
join public.ies_stripe_customers c on c.customer_id = s.customer_id
where s.status in ('active', 'past_due') and c.email is not null;

create view public.ies_v_ever_subscribed with (security_invoker = true) as
select distinct lower(c.email) as email
from public.ies_stripe_subscriptions s
join public.ies_stripe_customers c on c.customer_id = s.customer_id
where c.email is not null;

create view public.ies_v_people with (security_invoker = true) as
select
  g.contact_id,
  g.name,
  g.email,
  g.discord_username,
  g.tags,
  (g.tags && array['ies-team'])   as is_staff,
  (g.tags && array['ies-member']) as is_comp,
  exists (select 1 from public.ies_v_paying p where p.email = g.email)          as is_paying,
  exists (select 1 from public.ies_v_ever_subscribed e where e.email = g.email) as ever_subscribed,
  g.date_added
from public.ies_ghl_contacts g;

-- One row per Discord member, with who they are (if we can tell) and whether they pay.
create view public.ies_v_discord with (security_invoker = true) as
select
  d.user_id,
  d.username,
  d.display_name,
  d.joined_at,
  p.name  as contact_name,
  p.email as contact_email,
  case
    when p.contact_id is null         then 'unmatched'
    when p.is_paying                  then 'paying'
    when p.is_staff or p.is_comp      then 'comp_staff'
    else                                   'not_paying'
  end as status
from public.ies_discord_members d
left join lateral (
  select * from public.ies_v_people vp
  where vp.discord_username = d.username
  order by vp.is_paying desc, vp.date_added desc
  limit 1
) p on true
where not d.is_bot;

-- The headline numbers, one row.
create view public.ies_v_metrics with (security_invoker = true) as
with bounds as (
  select (date_trunc('month', now() at time zone 'Europe/London') at time zone 'Europe/London') as month_start
)
select
  (select coalesce(sum(monthly_amount_cents), 0) from public.ies_stripe_subscriptions
     where status in ('active', 'past_due'))                                         as mrr_cents,
  (select currency from public.ies_stripe_subscriptions
     where status in ('active', 'past_due') and currency is not null
     group by currency order by count(*) desc limit 1)                              as currency,
  (select count(distinct customer_id) from public.ies_stripe_subscriptions
     where status in ('active', 'past_due'))                                         as paid_members,
  (select count(*) from public.ies_stripe_subscriptions where status = 'past_due')   as past_due,
  (select count(*) from public.ies_stripe_subscriptions
     where status = 'active' and cancel_at_period_end)                               as cancelling,
  (select count(distinct customer_id) from public.ies_stripe_subscriptions, bounds
     where started_at >= bounds.month_start)                                         as new_this_month,
  (select count(distinct customer_id) from public.ies_stripe_subscriptions, bounds
     where ended_at >= bounds.month_start)                                           as churned_this_month,
  (select count(*) from public.ies_v_people where (is_staff or is_comp) and not is_paying) as comps_staff,
  (select count(*) from public.ies_v_people
     where email is not null and not ever_subscribed and not is_staff and not is_comp) as never_paid,
  (select count(*) from public.ies_v_discord)                                        as discord_members,
  (select count(*) from public.ies_v_discord where status in ('not_paying', 'unmatched')) as discord_not_paying,
  (select count(*) from public.ies_v_discord where status = 'unmatched')             as discord_unmatched;

-- Daily snapshot for the trend line. Called by pg_cron (runs as postgres, so
-- it is not subject to RLS). Not callable through the API.
create function public.ies_snapshot_mrr() returns void
language sql
set search_path = public
as $$
  insert into public.ies_mrr_daily (project_id, day, mrr_cents, paid_members)
  select 'inner-edge', (now() at time zone 'Europe/London')::date, m.mrr_cents, m.paid_members
  from public.ies_v_metrics m
  on conflict (project_id, day) do update
    set mrr_cents = excluded.mrr_cents, paid_members = excluded.paid_members, taken_at = now();
  insert into public.ies_sync_runs (source, ok, detail) values ('snapshot', true, null);
$$;
revoke execute on function public.ies_snapshot_mrr() from public, anon, authenticated;

revoke all on public.ies_v_paying, public.ies_v_ever_subscribed, public.ies_v_people,
              public.ies_v_discord, public.ies_v_metrics
  from anon;
