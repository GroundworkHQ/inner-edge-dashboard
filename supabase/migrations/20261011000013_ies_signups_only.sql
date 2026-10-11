-- inner-edge-dashboard: "Signed Up, Never Paid" counts only real member-site
-- signups (GHL source = 'membership'), never test addresses (mailinator) or
-- contacts marked 'ignore' in ies_role_overrides (internal/second accounts).
alter table public.ies_role_overrides drop constraint ies_role_overrides_role_check;
alter table public.ies_role_overrides add constraint ies_role_overrides_role_check
  check (role in ('staff', 'comp', 'none', 'ignore'));

create or replace view public.ies_v_people with (security_invoker = true) as
select
  g.contact_id,
  g.name,
  g.email,
  g.discord_username,
  g.tags,
  coalesce(o.role = 'staff', g.tags && array['ies-team']) as is_staff,
  coalesce(o.role = 'comp',  g.tags && array['ies-comp']) as is_comp,
  exists (select 1 from public.ies_v_paying p
          where p.email = g.email or p.email = (select l.stripe_email from public.ies_email_links l where l.ghl_email = g.email)) as is_paying,
  exists (select 1 from public.ies_v_ever_subscribed e
          where e.email = g.email or e.email = (select l.stripe_email from public.ies_email_links l where l.ghl_email = g.email)) as ever_subscribed,
  g.date_added,
  (g.tags && array['skool-migrant']) as is_skool_migrant,
  (g.source = 'membership') as is_signup,
  (coalesce(o.role = 'ignore', false) or g.email like '%@mailinator.com') as is_ignored
from public.ies_ghl_contacts g
left join public.ies_role_overrides o on o.ghl_email = g.email;

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
     where email is not null and not ever_subscribed and not is_staff and not is_comp
       and not is_skool_migrant and is_signup and not is_ignored)                    as never_paid,
  (select count(*) from public.ies_v_discord)                                        as discord_members,
  (select count(*) from public.ies_v_discord
     where status in ('not_paying', 'unmatched') and has_member_role)                as discord_not_paying,
  (select count(*) from public.ies_v_discord where status = 'unmatched' and has_member_role) as discord_unmatched,
  (select count(*) from public.ies_v_people
     where email is not null and not ever_subscribed and not is_staff and not is_comp
       and is_skool_migrant and not is_ignored)                                      as skool_never_joined;
