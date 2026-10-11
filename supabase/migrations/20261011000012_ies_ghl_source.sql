-- inner-edge-dashboard: how each GHL contact was created, so "Signed Up, Never
-- Paid" only counts real member-site signups (not imports, email-synced
-- contacts, tests or internal accounts).
alter table public.ies_ghl_contacts add column source text, add column attribution_medium text;
