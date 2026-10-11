-- inner-edge-dashboard: Discord role names, so "In Discord, Not Paying" only
-- flags people who still hold the Member role. The team removes the role on
-- cancellation (Zapier table "Remove Role: Member" button) rather than kicking,
-- so being in the server alone doesn't mean someone has access.
alter table public.ies_discord_members add column roles text[] not null default '{}';

create or replace view public.ies_v_discord with (security_invoker = true) as
select
  d.user_id,
  d.username,
  d.display_name,
  d.joined_at,
  coalesce(p.name, (select c.name from public.ies_stripe_customers c where c.email = l.contact_email limit 1)) as contact_name,
  coalesce(p.email, l.contact_email) as contact_email,
  case
    when p.contact_id is null and l.contact_email is null                       then 'unmatched'
    when coalesce(p.is_paying, false)
      or exists (select 1 from public.ies_v_paying vp where vp.email = l.contact_email) then 'paying'
    when p.is_staff or p.is_comp                                                 then 'comp_staff'
    else                                                                              'not_paying'
  end as status,
  exists (select 1 from unnest(d.roles) r where lower(r) = 'member') as has_member_role
from public.ies_discord_members d
left join public.ies_discord_links l on l.discord_username = d.username
left join lateral (
  select * from public.ies_v_people vp
  where vp.discord_username = d.username or vp.email = l.contact_email
  order by (vp.discord_username = d.username) desc nulls last, vp.is_paying desc, vp.date_added desc
  limit 1
) p on true
where not d.is_bot;

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
  (select count(*) from public.ies_v_discord
     where status in ('not_paying', 'unmatched') and has_member_role)                as discord_not_paying,
  (select count(*) from public.ies_v_discord where status = 'unmatched' and has_member_role) as discord_unmatched;
