-- inner-edge-dashboard: schedules
-- APPLY LAST, only after the Edge Functions are deployed and their secrets set.
--
-- pg_net calls the functions over HTTPS. The shared secret the functions
-- check (IES_CRON_SECRET) is read from Supabase Vault, never written here.
-- Before applying, store it once in the SQL editor:
--   select vault.create_secret('<same value as the IES_CRON_SECRET function secret>', 'ies_cron_secret');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Hourly GoHighLevel sync, at :05
select cron.schedule('ies-ghl-sync', '5 * * * *', $$
  select net.http_post(
    url     := 'https://kdgbivcufoarmvckworj.supabase.co/functions/v1/ies-ghl-sync',
    headers := jsonb_build_object('x-ies-cron-secret',
                 (select decrypted_secret from vault.decrypted_secrets where name = 'ies_cron_secret')),
    timeout_milliseconds := 55000)
$$);

-- Hourly Discord sync, at :10
select cron.schedule('ies-discord-sync', '10 * * * *', $$
  select net.http_post(
    url     := 'https://kdgbivcufoarmvckworj.supabase.co/functions/v1/ies-discord-sync',
    headers := jsonb_build_object('x-ies-cron-secret',
                 (select decrypted_secret from vault.decrypted_secrets where name = 'ies_cron_secret')),
    timeout_milliseconds := 55000)
$$);

-- Daily MRR snapshot, 23:55 UTC
select cron.schedule('ies-mrr-snapshot', '55 23 * * *', $$ select public.ies_snapshot_mrr() $$);
