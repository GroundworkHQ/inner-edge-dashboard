-- inner-edge-dashboard: people who SHOULD have Discord access but don't.
-- Paying members (Stripe) and comps (GHL ies-comp) who are either not in the
-- Discord server at all, or are in it without the Member role. The opposite of
-- "In Discord, Not Paying".
create view public.ies_v_access_gaps with (security_invoker = true) as
with should as (
  select distinct on (lower(m.email)) m.name, lower(m.email) as email, 'paying' as kind
  from public.ies_v_members m
  where m.is_paying and m.email is not null
  union all
  select p.name, p.email, 'comp'
  from public.ies_v_people p
  where p.is_comp and not p.is_paying and not p.is_ignored and p.email is not null
)
select s.name, s.email, s.kind,
       case when x.n = 0 then 'not_in_discord' else 'no_member_role' end as issue
from should s
cross join lateral (
  select count(*) as n, coalesce(bool_or(d.has_member_role), false) as has_role
  from public.ies_v_discord d
  where d.contact_email = s.email
     or d.contact_email in (select l.ghl_email from public.ies_email_links l where l.stripe_email = s.email)
) x
where x.n = 0 or not x.has_role;

revoke all on public.ies_v_access_gaps from anon, authenticated;
grant select on public.ies_v_access_gaps to authenticated;
