-- inner-edge-dashboard: comps now come from a dedicated GHL tag, ies-comp
-- (created 2026-10-10). ies-member is also applied by a GHL automation ("Tag IES
-- Member on Status Update"), so it can't reliably mean "free access".
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
  (g.tags && array['skool-migrant']) as is_skool_migrant
from public.ies_ghl_contacts g
left join public.ies_role_overrides o on o.ghl_email = g.email;
