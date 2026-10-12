-- inner-edge-dashboard: one row per past-due episode, so the Discord staff alert
-- posts once when a subscription goes past due and once when it settles (paid
-- or cancelled), never every hour. Written only by the Edge Functions (service
-- role); no dashboard viewer needs it, so no grants and no policy = deny-all.
create table public.ies_member_alerts (
  id              bigint generated always as identity primary key,
  project_id      text not null default 'inner-edge' check (project_id = 'inner-edge'),
  subscription_id text not null,
  customer_id     text not null,
  kind            text not null check (kind in ('past_due')),
  opened_at       timestamptz not null default now(),
  resolved_at     timestamptz,
  resolution      text check (resolution in ('paid', 'cancelled'))
);
create unique index ies_member_alerts_one_open
  on public.ies_member_alerts (subscription_id, kind) where resolved_at is null;
alter table public.ies_member_alerts enable row level security;
revoke all on public.ies_member_alerts from anon, authenticated;
-- The identity sequence inherits Supabase's default anon/authenticated grants;
-- nobody but the service role should touch it.
revoke all on sequence public.ies_member_alerts_id_seq from anon, authenticated;
