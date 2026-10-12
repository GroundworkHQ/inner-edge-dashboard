-- inner-edge-dashboard: the sync-log identity sequence inherited Supabase's
-- default anon/authenticated grants (nextval/setval). Only the service role
-- writes ies_sync_runs, so nobody else needs the counter.
revoke all on sequence public.ies_sync_runs_id_seq from anon, authenticated;
