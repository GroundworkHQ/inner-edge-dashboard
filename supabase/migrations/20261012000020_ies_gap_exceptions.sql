-- inner-edge-dashboard: access gaps the team has looked at and accepted (e.g. a
-- staff member who doesn't need portal access). Listed here, they stop flagging
-- on the Members cards. Rows are added by hand per person + issue; no member data
-- lives in this file.
create table public.ies_gap_exceptions (
  project_id text not null default 'inner-edge' check (project_id = 'inner-edge'),
  email      text not null check (email = lower(email)),
  issue      text not null check (issue in ('not_in_discord', 'no_member_role', 'no_portal_access')),
  note       text,
  created_at timestamptz not null default now(),
  primary key (email, issue)
);
alter table public.ies_gap_exceptions enable row level security;
revoke all on public.ies_gap_exceptions from anon, authenticated;
grant select on public.ies_gap_exceptions to authenticated;
create policy ies_viewer_read on public.ies_gap_exceptions for select to authenticated
  using (project_id = 'inner-edge' and exists (select 1 from public.ies_viewers v
         where v.project_id = ies_gap_exceptions.project_id and v.email = lower(auth.jwt() ->> 'email')));

-- Same columns as before; accepted gaps are filtered out.
create or replace view public.ies_v_access_gaps with (security_invoker = true) as
select g.* from (
  with should as (
    select distinct on (lower(m.email)) m.name, lower(m.email) as email, 'paying'::text as kind
    from public.ies_v_members m
    where m.is_paying and m.email is not null
    union all
    select p.name, p.email, 'comp'::text
    from public.ies_v_people p
    where p.is_comp and not p.is_paying and not p.is_ignored and p.email is not null
  )
  select s.name, s.email, s.kind,
         case when x.n = 0 then 'not_in_discord'::text else 'no_member_role'::text end as issue
  from should s
  cross join lateral (
    select count(*) as n, coalesce(bool_or(d.has_member_role), false) as has_role
    from public.ies_v_discord d
    where d.contact_email = s.email
       or d.contact_email in (select l.ghl_email from public.ies_email_links l where l.stripe_email = s.email)
  ) x
  where x.n = 0 or not x.has_role
) g
where not exists (select 1 from public.ies_gap_exceptions e where e.email = lower(g.email) and e.issue = g.issue);

create or replace view public.ies_v_portal_gaps with (security_invoker = true) as
select g.* from (
  select m.name, m.email, 'paying'::text as kind, 'no_portal_access'::text as issue
  from (select distinct on (lower(email)) name, lower(email) as email
        from public.ies_v_members where is_paying and email is not null) m
  where not exists (
    select 1 from public.ies_v_people p
    where p.has_portal_access
      and (p.email = m.email or p.email in (select l.ghl_email from public.ies_email_links l where l.stripe_email = m.email)))
  union all
  select p.name, p.email, case when p.is_staff then 'staff'::text else 'comp'::text end, 'no_portal_access'::text
  from public.ies_v_people p
  where (p.is_staff or p.is_comp) and not p.is_paying and not p.has_portal_access and not p.is_ignored
  union all
  select p.name, p.email, 'free'::text, 'unpaid_portal_access'::text
  from public.ies_v_people p
  where p.has_portal_access and not p.is_paying and not p.is_staff and not p.is_comp
) g
where not exists (select 1 from public.ies_gap_exceptions e where e.email = lower(g.email) and e.issue = g.issue);
