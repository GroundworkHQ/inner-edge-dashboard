-- inner-edge-dashboard: core tables
-- Shared internal-prod project, so every table is ies_-prefixed, carries the
-- project_id scoping column, and has RLS enabled. NOT APPLIED until Miguel
-- reviews it (schema changes on internal-prod are L3).

-- ---------------------------------------------------------------------------
-- Who may view the dashboard. Three rows: Miguel, Wendy, Lee.
-- ---------------------------------------------------------------------------
create table public.ies_viewers (
  project_id text not null default 'inner-edge' check (project_id = 'inner-edge'),
  email      text not null check (email = lower(email)),
  name       text,
  created_at timestamptz not null default now(),
  primary key (project_id, email)
);

-- ---------------------------------------------------------------------------
-- Stripe (written only by the ies-stripe-* functions with the service role)
-- ---------------------------------------------------------------------------
create table public.ies_stripe_customers (
  project_id  text not null default 'inner-edge' check (project_id = 'inner-edge'),
  customer_id text primary key,
  email       text,                 -- lowercased on write
  name        text,
  created_at  timestamptz,
  updated_at  timestamptz not null default now()
);
create index ies_stripe_customers_email on public.ies_stripe_customers (email);

create table public.ies_stripe_subscriptions (
  project_id           text not null default 'inner-edge' check (project_id = 'inner-edge'),
  subscription_id      text primary key,
  customer_id          text not null,
  status               text not null,   -- active, past_due, canceled, trialing, unpaid, incomplete...
  monthly_amount_cents integer not null default 0,  -- normalised to one month, quantity included
  currency             text,
  started_at           timestamptz,
  canceled_at          timestamptz,     -- when they clicked cancel
  cancel_at_period_end boolean not null default false,
  ended_at             timestamptz,     -- when access actually stopped
  current_period_end   timestamptz,
  updated_at           timestamptz not null default now()
);
create index ies_stripe_subscriptions_customer on public.ies_stripe_subscriptions (customer_id);
create index ies_stripe_subscriptions_status   on public.ies_stripe_subscriptions (status);

-- Every webhook event id we've processed, so a retried event is ignored.
create table public.ies_stripe_events (
  project_id  text not null default 'inner-edge' check (project_id = 'inner-edge'),
  event_id    text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- GoHighLevel contacts (hourly full sync)
-- ---------------------------------------------------------------------------
create table public.ies_ghl_contacts (
  project_id           text not null default 'inner-edge' check (project_id = 'inner-edge'),
  contact_id           text primary key,
  email                text,           -- lowercased on write
  name                 text,
  tags                 text[] not null default '{}',
  discord_username     text,           -- lowercased on write, contact.discord_username
  tradingview_username text,           -- contact.tradingview_username
  date_added           timestamptz,
  synced_at            timestamptz not null default now()
);
create index ies_ghl_contacts_email   on public.ies_ghl_contacts (email);
create index ies_ghl_contacts_discord on public.ies_ghl_contacts (discord_username);

-- ---------------------------------------------------------------------------
-- Discord server members (hourly full sync)
-- ---------------------------------------------------------------------------
create table public.ies_discord_members (
  project_id   text not null default 'inner-edge' check (project_id = 'inner-edge'),
  user_id      text primary key,
  username     text not null,          -- the unique @username, lowercased
  display_name text,
  joined_at    timestamptz,
  is_bot       boolean not null default false,
  synced_at    timestamptz not null default now()
);
create index ies_discord_members_username on public.ies_discord_members (username);

-- ---------------------------------------------------------------------------
-- Daily snapshot for the MRR trend line, plus a log of every sync run
-- ---------------------------------------------------------------------------
create table public.ies_mrr_daily (
  project_id   text not null default 'inner-edge' check (project_id = 'inner-edge'),
  day          date not null,
  mrr_cents    integer not null,
  paid_members integer not null,
  taken_at     timestamptz not null default now(),
  primary key (project_id, day)
);

create table public.ies_sync_runs (
  id         bigint generated always as identity primary key,
  project_id text not null default 'inner-edge' check (project_id = 'inner-edge'),
  source     text not null check (source in ('stripe', 'stripe-backfill', 'ghl', 'discord', 'snapshot')),
  ok         boolean not null,
  detail     text,
  ran_at     timestamptz not null default now()
);
create index ies_sync_runs_recent on public.ies_sync_runs (source, ran_at desc);

-- Lock down immediately in the same migration so the tables are never exposed
-- between 01 and 02 (02 repeats these, harmlessly).
alter table public.ies_viewers              enable row level security;
alter table public.ies_stripe_customers     enable row level security;
alter table public.ies_stripe_subscriptions enable row level security;
alter table public.ies_stripe_events        enable row level security;
alter table public.ies_ghl_contacts         enable row level security;
alter table public.ies_discord_members      enable row level security;
alter table public.ies_mrr_daily            enable row level security;
alter table public.ies_sync_runs            enable row level security;
