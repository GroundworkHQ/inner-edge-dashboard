// Discord → ies_discord_members  (hourly, full sync)
// Needs a bot in the server with the Server Members intent. Read-only: it
// lists members and never posts, kicks or changes roles.
import { admin, cronAuthorised, env, json, logRun, upsertChunked } from "../_shared/ies.ts";
import { type Member, memberRow } from "../_shared/discord_map.ts";

async function fetchAll(): Promise<Member[]> {
  const out: Member[] = [];
  let after = "0";
  for (let page = 0; page < 100; page++) { // hard stop: 100k members
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${env("IES_DISCORD_GUILD_ID")}/members?limit=1000&after=${after}`,
      { headers: { Authorization: `Bot ${env("IES_DISCORD_BOT_TOKEN")}` } },
    );
    if (res.status === 429) { // rate limited: wait as told, then retry the same page
      const wait = Number((await res.json()).retry_after ?? 1);
      await new Promise((r) => setTimeout(r, Math.ceil(wait * 1000)));
      page--;
      continue;
    }
    if (!res.ok) throw new Error(`Discord ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const batch = await res.json() as Member[];
    out.push(...batch);
    if (batch.length < 1000) return out;
    after = batch[batch.length - 1].user.id;
  }
  throw new Error("Discord pagination did not finish");
}

// Role id -> name for the server, so member rows can store role names.
async function fetchRoleNames(): Promise<Map<string, string>> {
  const res = await fetch(`https://discord.com/api/v10/guilds/${env("IES_DISCORD_GUILD_ID")}/roles`, {
    headers: { Authorization: `Bot ${env("IES_DISCORD_BOT_TOKEN")}` },
  });
  if (!res.ok) throw new Error(`Discord roles ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const roles = await res.json() as { id: string; name: string }[];
  return new Map(roles.map((r) => [r.id, r.name]));
}

Deno.serve(async (req) => {
  if (!cronAuthorised(req)) return json({ error: "unauthorised" }, 401);
  const db = admin();
  const syncedAt = new Date().toISOString();
  try {
    const [members, roleNames] = await Promise.all([fetchAll(), fetchRoleNames()]);
    await upsertChunked(db, "ies_discord_members", members.map((m) => memberRow(m, syncedAt, roleNames)), "user_id");
    const { error } = await db.from("ies_discord_members").delete().lt("synced_at", syncedAt);
    if (error) throw new Error(`prune: ${error.message}`);
    const humans = members.filter((m) => !m.user.bot).length;
    const withMember = members.filter((m) => !m.user.bot && (m.roles ?? []).some((id) => roleNames.get(id)?.toLowerCase() === "member")).length;
    await logRun(db, "discord", true, `${humans} members, ${withMember} with the Member role`);
    return json({ ok: true, members: humans });
  } catch (e) {
    await logRun(db, "discord", false, (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
