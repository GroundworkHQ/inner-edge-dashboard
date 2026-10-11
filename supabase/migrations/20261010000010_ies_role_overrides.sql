-- inner-edge-dashboard: dashboard-only staff/comp overrides. Changing GHL tags
-- can fire GHL automations, so a role correction that should only affect the
-- dashboard goes here instead. An override replaces what the tags say.
create table public.ies_role_overrides (
  project_id text not null default 'inner-edge' check (project_id = 'inner-edge'),
  ghl_email  text primary key check (ghl_email = lower(ghl_email)),
  role       text not null check (role in ('staff', 'comp', 'none')),
  note       text,
  created_at timestamptz not null default now()
);
alter table public.ies_role_overrides enable row level security;
revoke all on public.ies_role_overrides from anon, authenticated;
grant select on public.ies_role_overrides to authenticated;
create policy ies_viewer_read on public.ies_role_overrides for select to authenticated
  using (project_id = 'inner-edge' and exists (select 1 from public.ies_viewers v
         where v.project_id = ies_role_overrides.project_id and v.email = lower(auth.jwt() ->> 'email')));

create or replace view public.ies_v_people with (security_invoker = true) as
select
  g.contact_id,
  g.name,
  g.email,
  g.discord_username,
  g.tags,
  coalesce(o.role = 'staff', g.tags && array['ies-team'])  as is_staff,
  coalesce(o.role = 'comp',  g.tags && array['ies-member']) as is_comp,
  exists (select 1 from public.ies_v_paying p
          where p.email = g.email or p.email = (select l.stripe_email from public.ies_email_links l where l.ghl_email = g.email)) as is_paying,
  exists (select 1 from public.ies_v_ever_subscribed e
          where e.email = g.email or e.email = (select l.stripe_email from public.ies_email_links l where l.ghl_email = g.email)) as ever_subscribed,
  g.date_added,
  (g.tags && array['skool-migrant']) as is_skool_migrant
from public.ies_ghl_contacts g
left join public.ies_role_overrides o on o.ghl_email = g.email;
