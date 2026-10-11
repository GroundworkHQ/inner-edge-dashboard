-- inner-edge-dashboard: strip Supabase's default grants down to SELECT only.
-- Applied 2026-10-10 after the rls-auditor found authenticated still held
-- REFERENCES/TRIGGER on the tables and full write grants on the views.
revoke all on public.ies_viewers, public.ies_stripe_customers, public.ies_stripe_subscriptions,
              public.ies_ghl_contacts, public.ies_discord_members, public.ies_mrr_daily, public.ies_sync_runs,
              public.ies_v_paying, public.ies_v_ever_subscribed, public.ies_v_people,
              public.ies_v_discord, public.ies_v_metrics
  from authenticated;
grant select on public.ies_viewers, public.ies_stripe_customers, public.ies_stripe_subscriptions,
                public.ies_ghl_contacts, public.ies_discord_members, public.ies_mrr_daily, public.ies_sync_runs,
                public.ies_v_paying, public.ies_v_ever_subscribed, public.ies_v_people,
                public.ies_v_discord, public.ies_v_metrics
  to authenticated;
-- Webhook dedupe log: service role only.
revoke all on public.ies_stripe_events from authenticated, anon;
