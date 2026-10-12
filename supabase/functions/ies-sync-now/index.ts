// Refresh button → runs the GHL, Stripe and Discord syncs now instead of
// waiting for the hourly crons. Only dashboard viewers can call it: the
// gateway checks the login (verify_jwt), then the caller's own token must be
// able to read their ies_viewers row, the same RLS check the page relies on.
// The cron secret never leaves the server.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { admin, env } from "../_shared/ies.ts";

const ORIGINS = ["https://dashboard.inneredgescalping.com", "http://localhost:8000"];
const SYNCS = { ghl: "ies-ghl-sync", stripe: "ies-stripe-backfill", discord: "ies-discord-sync" };
const COOLDOWN_MS = 60_000; // a double-click or two viewers at once runs it once

function reply(req: Request, body: unknown, status = 200): Response {
  const origin = req.headers.get("origin") ?? "";
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
      "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
      "access-control-allow-methods": "POST, OPTIONS",
      vary: "origin",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return reply(req, null, 204);
  if (req.method !== "POST") return reply(req, { error: "method" }, 405);

  const auth = req.headers.get("authorization") ?? "";
  const asUser = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth } },
  });
  const { data: viewer } = await asUser.from("ies_viewers").select("email").maybeSingle();
  if (!viewer) return reply(req, { error: "forbidden" }, 403);

  const { data: last } = await admin().from("ies_sync_runs").select("ran_at")
    .eq("source", "ghl").order("ran_at", { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - new Date(last.ran_at).getTime() < COOLDOWN_MS) {
    return reply(req, { ok: true, skipped: "synced under a minute ago" });
  }

  const base = env("SUPABASE_URL");
  const results = await Promise.all(Object.entries(SYNCS).map(async ([source, fn]) => {
    try {
      const res = await fetch(`${base}/functions/v1/${fn}`, {
        method: "POST",
        headers: { "x-ies-cron-secret": env("IES_CRON_SECRET") },
      });
      return [source, res.ok] as const;
    } catch {
      return [source, false] as const;
    }
  }));
  const ok = Object.fromEntries(results);
  return reply(req, { ok: results.every(([, v]) => v), sources: ok });
});
