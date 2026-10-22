# inner-edge-dashboard — Reference

> Source-of-truth reference for inner-edge-dashboard. Keep it current; `CLAUDE.md` points every new session here.

## 1. Overview
A live dashboard for **Inner Edge Scalping**, the Forex scalping community Miguel partners in with Wendy and Lee ($77/mo, one plan). Replaces counting members by hand across Stripe, GoHighLevel and Discord.

**Viewers:** Miguel, Wendy and Lee only. **Email + password login (changed 2026-10-10 from magic link).** The page never makes Supabase send an email: internal-prod's auth emails go out IBS-branded and Miguel wants nothing IBS on this. Accounts are created by Miguel in Supabase (Add user, Auto Confirm, temp password); people change their own password with Set Password. Reset = delete + re-add (no IBS email). Resend had no free domain slot (10/10) for an Inner Edge sender.

**What it shows**
- MRR and its trend
- Paid members (active Stripe subscriptions)
- New and churned this month
- Free members, three kinds (all three wanted):
  1. **Comps and staff:** GoHighLevel tags `ies-comp` (comps, tag created 2026-10-10; was `ies-member`, which a GHL automation also applies) and `ies-team` (staff). Dashboard-only corrections go in `ies_role_overrides` so GHL automations never fire.
  2. **In Discord, not paying**
  3. **Signed up, never paid:** GoHighLevel contacts with no subscription

Context as of 2026-09-01: ~59 active subs, ~$4.6k MRR, 91 member-portal users, 111 GHL contacts.

## 2. Stack & accounts
**Luis' stack (no-build static Pages + Supabase Edge). Chosen by Miguel 2026-09-29 over a Next.js/Vercel build and over a Mission Control tab (Mission Control is personal; this is shared).**

| Piece | Choice |
|---|---|
| Front end | Static HTML/CSS/JS, supabase-js from a CDN, no build |
| Hosting | GitHub Pages, repo `GroundworkHQ/inner-edge-dashboard` (public), custom domain `dashboard.inneredgescalping.com` |
| Backend | Supabase Edge Functions |
| DB + Auth | Supabase `internal-prod` (`kdgbivcufoarmvckworj`), `ies_` tables |
| Email | Resend as Supabase Auth SMTP (avoids Supabase's built-in send limits) |

**Data sources (all read-only)**
- **Stripe:** Inner Edge connected account `acct_1Sz098PlBE5vm85Q`. Signup happens in GoHighLevel, billing in Stripe. It may sit under GHL's Stripe Connect, in which case Wendy or Lee must create the restricted key and webhook from their side.
- **GoHighLevel:** location `06KFUoalbbFOPinVxNeY`. Needs a Private Integration token with read scopes only.
- **Discord:** a bot with the Server Members intent, read-only.
- **TradingView:** no API, out of scope.

**DNS:** `inneredgescalping.com` carries email records for `mail.` (Resend: DKIM at `resend._domainkey.mail`, bounce MX at `send.mail`, plus `_dmarc`). Add only the `dashboard` CNAME. Never touch the others, never move nameservers.

## 3. Architecture
```
Stripe ──webhook (instant)──▶ ies-stripe-webhook ─┐
GoHighLevel ──hourly cron──▶ ies-ghl-sync ────────┼─▶ ies_* tables (RLS) ◀── static dashboard (magic link)
Discord ──hourly cron──────▶ ies-discord-sync ────┘
```
- Crons run inside Supabase (pg_cron + pg_net calling the functions).
- The page only ever reads through RLS as a logged-in allowlisted user. Functions write with the service role.
- Draft tables (to be designed and reviewed before creation): subscriptions / customers from Stripe, contacts + tags from GHL, Discord members, an allowlist of viewer emails, and a daily MRR snapshot for the trend line. Each needs a scoping column per the internal-prod rules.

## 4. What's built
**2026-09-29, all LOCAL. Nothing applied to internal-prod, nothing deployed, nothing pushed.**

| Piece | Files | Checked how |
|---|---|---|
| Tables | `supabase/migrations/…01_ies_tables.sql` | Parsed with pglast (real Postgres parser) |
| Access rules | `…02_ies_rls.sql`: SELECT only, only for emails in `ies_viewers`; anon gets nothing; no SECURITY DEFINER | Parsed |
| Numbers | `…03_ies_views.sql`: `ies_v_metrics`, `ies_v_people`, `ies_v_discord` etc., all `security_invoker`; `ies_snapshot_mrr()` | Parsed |
| Schedules | `…04_ies_cron.sql`: GHL :05 and Discord :10 hourly, MRR snapshot 23:55 UTC. Apply LAST | Parsed |
| Stripe webhook | `ies-stripe-webhook`: verifies signature, dedupes event ids, re-reads the subscription from Stripe so out-of-order events can't regress state | `deno check` clean |
| Stripe backfill | `ies-stripe-backfill`: full load, safe to re-run, needs cron secret | `deno check` clean |
| GHL sync | `ies-ghl-sync`: full contact sync, prunes deleted contacts only after a complete fetch | `deno check` clean |
| Discord sync | `ies-discord-sync`: full member sync, handles rate limits, same safe prune | `deno check` clean |
| Mapping logic | `_shared/*_map.ts` | 9 unit tests pass (`deno test supabase/functions/tests`) |
| Dashboard | `index.html`, `css/app.css`, `js/*.js`, `CNAME` | Screenshotted in `?demo=1` mode on desktop and at phone width; login screen renders |

**Not verified:** anything that needs the real database or real keys: the SQL actually running, RLS behaving as intended (run rls-auditor after applying), and the functions against live Stripe/GHL/Discord.

**Known approximation:** MRR ignores coupons/discounts, so it can read slightly above Stripe's own MRR if any are in use.

`?demo=1` shows invented data with no login, flagged "Demo Data" in the header. Safe to leave in: it never touches Supabase.

## 5. What's next
**Go-live checklist, in order. Items marked (M) need Miguel; (W/L) may need Wendy or Lee.**
1. ~~(M) Approve and apply migrations 01 to 03 on internal-prod, then run rls-auditor.~~ **Applied 2026-10-10** (as ies_tables, ies_rls, ies_views), plus 05 ies_grants_tighten (SELECT-only grants). rls-auditor static checks pass; live rolled-back test: anon denied, stranger sees 0 rows and cannot write, allowlisted viewer sees rows, ies_stripe_events hidden from all.
2. (M) Insert the three `ies_viewers` rows (Miguel, Wendy, Lee emails).
3. (M) Supabase Auth on internal-prod: invite the same three emails as users (login uses `shouldCreateUser: false`), add `https://dashboard.inneredgescalping.com` to the Redirect URLs allowlist, and point Auth SMTP at Resend if not already. Note Auth settings are SHARED across every project in internal-prod.
4. (M, has full Stripe access as of 2026-10-10) Stripe: restricted key (**saved as IES_STRIPE_RESTRICTED_KEY 2026-10-10**; account is direct, IES_STRIPE_ACCOUNT stays empty) (Customers + Subscriptions read) and a webhook endpoint → `…/functions/v1/ies-stripe-webhook` for the `customer.*` and `customer.subscription.*` events. Find out whether the account is under GHL's Connect platform; if so set `IES_STRIPE_ACCOUNT`.
5. (W/L) GoHighLevel Private Integration token, contacts read-only.
6. ~~(M/W/L) Create a Discord bot~~ **Done 2026-10-10**, guild id `1467280492595253526`; secrets IES_DISCORD_BOT_TOKEN, IES_DISCORD_GUILD_ID, IES_GHL_PRIVATE_TOKEN, IES_GHL_LOCATION_ID saved. Was: Create a Discord bot with the Server Members intent, invite it (no permissions needed), note the server (guild) id.
7. **Functions deployed 2026-10-10 via Supabase MCP** (imports rewritten to ./_shared/ at deploy since the MCP bundles shared files beside index.ts). Was: (M) Set the function secrets (names in `.env.local.example`), deploy the four functions, run `ies-stripe-backfill` once.
8. ~~(M) Store `ies_cron_secret` in Vault, apply migration 04.~~ **Done 2026-10-10.** First runs OK: Stripe 94 customers / 126 subs, GHL 136 contacts (74 with Discord), Discord 91 members. Fixed: stripe-node rejects an empty `{}` options arg, so `accountArgs()` returns a spreadable empty array.
9. (M) Commit + push, enable GitHub Pages, add the `dashboard` CNAME at the DNS host (do NOT touch the mail records).
10. ~~(M) Add the Discord → GHL step to the "Add Discord Name" Zap (see §7).~~ **Done differently 2026-10-10:** a separate Zapier durable workflow `ies-discord-name-to-ghl` (id `01a1282c-31d6-796f-b960-7e994033c3cf`, private, editor https://zapier.com/workflow/01a1282c-31d6-796f-b960-7e994033c3cf). Trigger: Zapier Tables new-or-updated record on the Discord Role Table; writes `discord_username` via LeadConnector Add/Update Contact (upserts by email, so an unknown email would create a contact). The classic "Add Discord Name" Zap is untouched. Draft-tested; the real trigger payload shape was NOT sampled, so check the first live run (a `no-email` skip lists the payload keys). Same day: 7 names written to GHL by hand (joined since Sep 29); Jan 1 to Sep 28 already complete. The dashboard's Discord card turns orange for paying members 1 to 14 days old with no Discord name.

## 6. Conventions
- `ies_` prefix on every table, function name and cron job.
- Secrets only in Edge Function env: `IES_STRIPE_RESTRICTED_KEY`, `IES_STRIPE_WEBHOOK_SECRET`, `IES_GHL_PRIVATE_TOKEN`, `IES_DISCORD_BOT_TOKEN`. Never in the page, never in git, never printed in chat.
- Verify the Stripe webhook signature on every call.
- Member data never leaves Supabase: not in the repo, not in artifacts or shared docs (GDPR, UK/US members).
- The HighLevel MCP is bound to this same location but is a live client CRM: treat it as read-only.

## 7. Open decisions
- ~~Discord ↔ Stripe matching~~ **DECIDED 2026-09-29:** match via a GHL **Discord Username** contact field. Created 2026-09-29: id `I9YLZU6lRoH90ssY9WgH`, key `contact.discord_username`, TEXT, next to TradingView Username in the same folder. **Source of Discord names:** the Zapier Table "Skool Customers → Discord Role Table" (First/Last Name, Email, Date Joined, Discord Username, Status, Record ID, Notes), fed by Miguel's classic Zap **"Add Discord Name"**. Rows date from 2026-04-20.
**Backfilled 2026-09-29:** 89 table rows → 75 unique email/username pairs (newest row wins per email) → 74 matched exactly one GHL contact by email and were written (1 had no GHL contact). No ambiguous matches.
**Still to do:** add a step to the "Add Discord Name" Zap that also writes `contact.discord_username` in GHL, so new members stay linked. Classic Zaps can't be edited through the Zapier MCP, so Miguel does this in the Zap editor.
- Whether Stripe sits under GHL's Connect platform (decides who creates the key and webhook).

## 8. Counting rules (as of 2026-10-11)
- **Abandoned Checkout** (renamed from "Signed Up, Never Paid" 2026-10-11) = GHL `source = 'membership'` (real member-site signups) with no real subscription, not staff/comp/Skool, not `@mailinator.com`, not `ignore` in `ies_role_overrides`. Imports, email/calendar-synced and hand-added contacts never count.
- **Skool, Never Joined** = tag `skool-migrant`, never subscribed.
- **Comps** = tag `ies-comp`; **Staff** = tag `ies-team`. Dashboard-only corrections: `ies_role_overrides` (`staff` / `comp` / `none` / `ignore`).
- **New This Month** = subscriptions started since the 1st (UK time), minus any whose first payment was fully refunded (`ies_stripe_subscriptions.first_payment_refunded`, 2026-10-21). A refunded signup still counts in Churned and Cancelled. The flag is set by the `charge.refunded` webhook (instant) and the hourly backfill (safety net, scans the last 62 days of charges); a refunded charge is matched to the same customer's subscription that started within 10 minutes of it, so no invoice access is needed. Needs **Charges: Read** on the restricted key and `charge.refunded` on the webhook endpoint; without them the backfill notes "refund check skipped" and carries on.
- **Cancelled** = ended subscriptions, minus anyone paying again, minus deleted Stripe customers, collapsed per person (first initial + surname).
- **In Discord, Not Paying** = holds the Discord **Member** role, not paying, not comp/staff.
- Link tables (dashboard-only, never written back to GHL): `ies_email_links` (GHL email → Stripe email: duplicates, typos, someone else paying), `ies_discord_links` (Discord → member email: second accounts, family).
- Stripe: webhook plus an hourly full re-sync at :15 (`ies-stripe-backfill` cron) as a safety net. As of 2026-10-11 01:05 UTC the webhook had received no events yet, so it is unverified.
- **Portal access** = GHL tag `ies-member`. Kept current by the GHL workflow "Tag IES Member on Status Update" (rewired 2026-10-11 in the GoForClose white-label at app.goforclose.com): triggers Product access granted / Product access removed for product "Inner Edge Scalping" (`c792937f-ce54-4cd0-8b7b-03c36783e530`) and Subscription cancelled; an If/else branches on "Workflow trigger". Re-entry is on. Branches: granted adds `ies-member` and (since 2026-10-12) removes `ies-cancellation`, so a rejoiner loses the stale tag; access removed removes it; subscription cancelled adds `ies-cancellation` and (since 2026-10-12) also removes `ies-member`, because the access-removed trigger missed Issac and Chris King. Backfilled 2026-10-11 from Memberships > Courses > Analytics > Member analytics (86 with "Total Products" 1). `ies_v_portal_gaps` flags paying/comp/staff without access and access holders who are none of those.
- GHL (white-label GoForClose) has no public API for portal access, which is why it goes through a tag. Read that list in the UI at Memberships > Courses > Analytics > Member analytics.

## Past-due alerts (2026-10-12)
After every Stripe sync (hourly at :15, and on the Refresh button) `_shared/member_alerts.ts` posts to a private staff Discord channel via the webhook in Edge secret `IES_DISCORD_ALERT_WEBHOOK`. One post when a subscription goes `past_due`: member since, price, how many times they cancelled and rejoined, Discord handle/roles, Skool origin, failed invoice details if the Stripe key can read invoices, tips on how to approach it, and a copy-paste sample DM. One follow-up when it settles (paid or cancelled). `ies_member_alerts` (service-role only, deny-all RLS) keeps it to one post per episode; a failed Discord post releases the claim so the next sync retries. No webhook set means alerts are skipped and the run detail says so. Tags: `IES_DISCORD_ALERT_PING` (comma-separated Discord user IDs, tagged on failed + paid posts, the follow-up person) and `IES_DISCORD_ACCESS_PING` (tagged on cancelled posts, the person who removes course access and the Discord role). IDs live in Edge secrets, not the repo. Stripe retry window is hard-coded as `RETRY_WINDOW_DAYS = 7` to match Stripe's Smart Retries setting (4 tries within 1 week, then cancel); change both together.

## Accepted access gaps (2026-10-12)
`ies_gap_exceptions` (email + issue: `not_in_discord`, `no_member_role`, `no_portal_access`, with a note) lists gaps the team has accepted, e.g. staff who don't need portal access or hand-added people to leave alone. `ies_v_access_gaps` and `ies_v_portal_gaps` filter them out, so they stop flagging. Rows are inserted by hand on internal-prod, never in a migration, so no member emails land in this public repo. Members cards show a "⚠ N to check" count on the face; the full notes sit at the top of the dropdown and each affected name gets a tag.

