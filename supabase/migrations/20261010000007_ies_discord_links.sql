-- inner-edge-dashboard: manual Discord -> member links for accounts GHL can't hold.
-- GHL keeps ONE Discord username per contact, and the ies-discord-name-to-ghl
-- Zapier workflow overwrites it from the Zapier table. Second accounts, family
-- members on someone's access, and paying members with no GHL contact are
-- linked here instead, by the email of the member they belong to.
create table public.ies_discord_links (
  project_id       text not null default 'inner-edge' check (project_id = 'inner-edge'),
  discord_username text primary key check (discord_username = lower(discord_username)),
  contact_email    text not null check (contact_email = lower(contact_email)),
  note             text,
  created_at       timestamptz not null default now()
);
alter table public.ies_discord_links enable row level security;
revoke all on public.ies_discord_links from anon, authenticated;
grant select on public.ies_discord_links to authenticated;
create policy ies_viewer_read on public.ies_discord_links for select to authenticated
  using (project_id = 'inner-edge' and exists (select 1 from public.ies_viewers v
         where v.project_id = ies_discord_links.project_id and v.email = lower(auth.jwt() ->> 'email')));

-- Same columns as before; now also resolves people through ies_discord_links,
-- and falls back to Stripe for a linked email that has no GHL contact.
create or replace view public.ies_v_discord with (security_invoker = true) as
select
  d.user_id,
  d.username,
  d.display_name,
  d.joined_at,
  coalesce(p.name, (select c.name from public.ies_stripe_customers c where c.email = l.contact_email limit 1)) as contact_name,
  coalesce(p.email, l.contact_email) as contact_email,
  case
    when p.contact_id is null and l.contact_email is null                       then 'unmatched'
    when coalesce(p.is_paying, false)
      or exists (select 1 from public.ies_v_paying vp where vp.email = l.contact_email) then 'paying'
    when p.is_staff or p.is_comp                                                 then 'comp_staff'
    else                                                                              'not_paying'
  end as status
from public.ies_discord_members d
left join public.ies_discord_links l on l.discord_username = d.username
left join lateral (
  select * from public.ies_v_people vp
  where vp.discord_username = d.username or vp.email = l.contact_email
  order by (vp.discord_username = d.username) desc nulls last, vp.is_paying desc, vp.date_added desc
  limit 1
) p on true
where not d.is_bot;
