# inner-edge-dashboard — Claude Code context

## Read first
Before working, read **`docs/REFERENCE.md`** — the source of truth for this project. This file is just the quick orientation.

## What this is
A live members and MRR dashboard for **Inner Edge Scalping** (Forex scalping community, $77/mo). Shared by Miguel, Wendy and Lee: paid members, MRR, comps/staff, Discord-but-not-paying, signed-up-never-paid, new and churned this month.

## Stack
**Luis' stack, locked. Do not substitute Next.js, Vercel or a build step.**
- Static HTML/CSS/JS, no framework, no package.json, on **GitHub Pages** at `dashboard.inneredgescalping.com`
- **Supabase Edge Functions** (Deno/TS) for all backend work
- Supabase **internal-prod** (`kdgbivcufoarmvckworj`): Postgres + magic-link Auth, `ies_` table prefix, RLS on every table
- Resend for the magic-link emails

## Conventions & rules
- Secrets live in Edge Function env only. The page ships the public anon key and nothing else. Repo is PUBLIC.
- Every table: `ies_` prefix, a scoping column, RLS enabled. Run the rls-auditor agent after any schema change.
- Access is an allowlist of three emails, enforced in RLS, not just in the page.
- Stripe, GoHighLevel and Discord are all READ-ONLY sources. Never write back to them. One exception: past-due alerts post to a private staff channel through a Discord webhook (`IES_DISCORD_ALERT_WEBHOOK`); that's a post, not a write to member data.
- Never commit member data (emails, names, handles) to this repo.
- Commit + push only when Miguel says so. Commit messages end with the Co-Authored-By line.

## Current priority
Backend LIVE on internal-prod since 2026-10-10/11: migrations applied, 4 Edge Functions deployed, hourly syncs (GHL :05, Discord :10, Stripe :15) plus daily MRR snapshot. Page not yet on GitHub Pages; DNS for `dashboard.inneredgescalping.com` not yet added. Counting rules: `docs/REFERENCE.md` §8. Preview locally with a static server; `?demo=1` shows fake data (use it for screenshots so member names stay out of chat). Login is email + password only and must never trigger a Supabase auth email.
