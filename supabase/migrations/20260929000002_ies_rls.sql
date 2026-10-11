-- inner-edge-dashboard: row level security
-- Viewers get SELECT only, and only if their login email is in ies_viewers.
-- Nobody gets INSERT/UPDATE/DELETE through the API: the Edge Functions write
-- with the service role, which bypasses RLS by design.
--
-- No SECURITY DEFINER helpers on purpose. The viewer check is a plain subquery
-- on ies_viewers, which itself only ever reveals the caller's own row.

alter table public.ies_viewers              enable row level security;
alter table public.ies_stripe_customers     enable row level security;
alter table public.ies_stripe_subscriptions enable row level security;
alter table public.ies_stripe_events        enable row level security;
alter table public.ies_ghl_contacts         enable row level security;
alter table public.ies_discord_members      enable row level security;
alter table public.ies_mrr_daily            enable row level security;
alter table public.ies_sync_runs            enable row level security;

-- Anonymous visitors get nothing at all, not even table metadata via the API.
revoke all on public.ies_viewers, public.ies_stripe_customers, public.ies_stripe_subscriptions,
              public.ies_stripe_events, public.ies_ghl_contacts, public.ies_discord_members,
              public.ies_mrr_daily, public.ies_sync_runs
  from anon;
revoke insert, update, delete, truncate on
              public.ies_viewers, public.ies_stripe_customers, public.ies_stripe_subscriptions,
              public.ies_stripe_events, public.ies_ghl_contacts, public.ies_discord_members,
              public.ies_mrr_daily, public.ies_sync_runs
  from authenticated;

-- A viewer can see their own allowlist row (that is what the other policies test).
create policy ies_viewers_self on public.ies_viewers
  for select to authenticated
  using (project_id = 'inner-edge' and email = lower(auth.jwt() ->> 'email'));

-- Every data table: readable only by an allowlisted viewer of the same project.
create policy ies_viewer_read on public.ies_stripe_customers for select to authenticated
  using (project_id = 'inner-edge' and exists (select 1 from public.ies_viewers v
         where v.project_id = ies_stripe_customers.project_id and v.email = lower(auth.jwt() ->> 'email')));

create policy ies_viewer_read on public.ies_stripe_subscriptions for select to authenticated
  using (project_id = 'inner-edge' and exists (select 1 from public.ies_viewers v
         where v.project_id = ies_stripe_subscriptions.project_id and v.email = lower(auth.jwt() ->> 'email')));

create policy ies_viewer_read on public.ies_ghl_contacts for select to authenticated
  using (project_id = 'inner-edge' and exists (select 1 from public.ies_viewers v
         where v.project_id = ies_ghl_contacts.project_id and v.email = lower(auth.jwt() ->> 'email')));

create policy ies_viewer_read on public.ies_discord_members for select to authenticated
  using (project_id = 'inner-edge' and exists (select 1 from public.ies_viewers v
         where v.project_id = ies_discord_members.project_id and v.email = lower(auth.jwt() ->> 'email')));

create policy ies_viewer_read on public.ies_mrr_daily for select to authenticated
  using (project_id = 'inner-edge' and exists (select 1 from public.ies_viewers v
         where v.project_id = ies_mrr_daily.project_id and v.email = lower(auth.jwt() ->> 'email')));

create policy ies_viewer_read on public.ies_sync_runs for select to authenticated
  using (project_id = 'inner-edge' and exists (select 1 from public.ies_viewers v
         where v.project_id = ies_sync_runs.project_id and v.email = lower(auth.jwt() ->> 'email')));

-- ies_stripe_events has RLS on and NO policy: invisible to everyone but the service role.
