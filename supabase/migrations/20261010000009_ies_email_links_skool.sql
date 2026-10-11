-- inner-edge-dashboard: link GHL contacts to Stripe customers whose email differs
-- (duplicate contacts, typos), and split out the old Skool imports.
create table public.ies_email_links (
  project_id   text not null default 'inner-edge' check (project_id = 'inner-edge'),
  ghl_email    text primary key check (ghl_email = lower(ghl_email)),
  stripe_email text not null check (stripe_email = lower(stripe_email)),
  note         text,
  created_at   timestamptz not null default now()
);
alter table public.ies_email_links enable row level security;
revoke all on public.ies_email_links from anon, authenticated;
grant select on public.ies_email_links to authenticated;
create policy ies_viewer_read on public.ies_email_links for select to authenticated
  using (project_id = 'inner-edge' and exists (select 1 from public.ies_viewers v
         where v.project_id = ies_email_links.project_id and v.email = lower(auth.jwt() ->> 'email')));

-- Same columns as before plus is_skool_migrant on the end. Paying / ever-subscribed
-- now also check the linked Stripe email.
create or replace view public.ies_v_people with (security_invoker = true) as
select
  g.contact_id,
  g.name,
  g.email,
  g.discord_username,
  g.tags,
  (g.tags && array['ies-team'])   as is_staff,
  (g.tags && array['ies-member']) as is_comp,
  exists (select 1 from public.ies_v_paying p
          where p.email = g.email or p.email = (select l.stripe_email from public.ies_email_links l where l.ghl_email = g.email)) as is_paying,
  exists (select 1 from public.ies_v_ever_subscribed e
          where e.email = g.email or e.email = (select l.stripe_email from public.ies_email_links l where l.ghl_email = g.email)) as ever_subscribed,
  g.date_added,
  (g.tags && array['skool-migrant']) as is_skool_migrant
from public.ies_ghl_contacts g;

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
       and not is_skool_migrant)                                                     as never_paid,
  (select count(*) from public.ies_v_discord)                                        as discord_members,
  (select count(*) from public.ies_v_discord
     where status in ('not_paying', 'unmatched') and has_member_role)                as discord_not_paying,
  (select count(*) from public.ies_v_discord where status = 'unmatched' and has_member_role) as discord_unmatched,
  (select count(*) from public.ies_v_people
     where email is not null and not ever_subscribed and not is_staff and not is_comp
       and is_skool_migrant)                                                         as skool_never_joined;
