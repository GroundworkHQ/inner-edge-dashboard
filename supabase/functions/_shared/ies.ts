// Shared helpers for the ies-* Edge Functions.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const PROJECT_ID = "inner-edge";

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v.trim(); // pasted secrets often carry a trailing newline
}

// Service-role client. Bypasses RLS, so it only ever runs server-side here.
export function admin(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Scheduled and manual runs must present the shared secret. Constant-time compare.
export function cronAuthorised(req: Request): boolean {
  const got = new TextEncoder().encode(req.headers.get("x-ies-cron-secret") ?? "");
  const want = new TextEncoder().encode(env("IES_CRON_SECRET"));
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

export async function logRun(
  db: SupabaseClient,
  source: "stripe" | "stripe-backfill" | "ghl" | "discord",
  ok: boolean,
  detail: string | null,
) {
  await db.from("ies_sync_runs").insert({ project_id: PROJECT_ID, source, ok, detail });
}

// Upsert in chunks so a big sync never hits request size limits.
export async function upsertChunked(
  db: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  size = 500,
) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + size), { onConflict });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
}

export const lower = (s: string | null | undefined) => (s ? s.trim().toLowerCase() : null);
