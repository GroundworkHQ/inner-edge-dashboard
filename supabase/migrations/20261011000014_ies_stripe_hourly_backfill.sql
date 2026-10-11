-- inner-edge-dashboard: hourly full Stripe re-sync at :15 as a safety net under
-- the webhook. If a webhook delivery is missed or the signing secret is wrong,
-- the dashboard is never more than an hour out of date. 94 customers / 126 subs,
-- so this is a few Stripe list calls per hour.
select cron.schedule('ies-stripe-backfill', '15 * * * *', $$
  select net.http_post(
    url     := 'https://kdgbivcufoarmvckworj.supabase.co/functions/v1/ies-stripe-backfill',
    headers := jsonb_build_object('x-ies-cron-secret',
                 (select decrypted_secret from vault.decrypted_secrets where name = 'ies_cron_secret')),
    timeout_milliseconds := 55000)
$$);
