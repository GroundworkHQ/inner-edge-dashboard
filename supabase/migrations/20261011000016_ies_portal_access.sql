-- inner-edge-dashboard: member-portal access, from the GHL tag ies-member.
-- ies-member now means "has access to the Inner Edge Scalping product in the
-- member portal": the GHL workflow "Tag IES Member on Status Update" adds it on
-- Product access granted and removes it on Product access removed (rewired
-- 2026-10-11; backfilled the same day from Memberships > Member analytics).
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
  (coalesce(o.role = 'ignore', false) or g.email like '%@mailinator.com') as is_ignored,
  (g.tags && array['ies-member']) as has_portal_access
from public.ies_ghl_contacts g
left join public.ies_role_overrides o on o.ghl_email = g.email;

-- Who has portal access who shouldn't, and who should but doesn't.
create view public.ies_v_portal_gaps with (security_invoker = true) as
-- Paying in Stripe, but no GHL contact with portal access (via their own email
-- or a linked GHL email).
select m.name, m.email, 'paying' as kind, 'no_portal_access' as issue
from (select distinct on (lower(email)) name, lower(email) as email from public.ies_v_members where is_paying and email is not null) m
where not exists (
  select 1 from public.ies_v_people p
  where p.has_portal_access
    and (p.email = m.email or p.email in (select l.ghl_email from public.ies_email_links l where l.stripe_email = m.email)))
union all
-- Comps and staff without portal access.
select p.name, p.email, case when p.is_staff then 'staff' else 'comp' end, 'no_portal_access'
from public.ies_v_people p
where (p.is_staff or p.is_comp) and not p.is_paying and not p.has_portal_access and not p.is_ignored
union all
-- Portal access, but not paying, not a comp and not staff.
select p.name, p.email, 'free', 'unpaid_portal_access'
from public.ies_v_people p
where p.has_portal_access and not p.is_paying and not p.is_staff and not p.is_comp;

revoke all on public.ies_v_portal_gaps from anon, authenticated;
grant select on public.ies_v_portal_gaps to authenticated;
