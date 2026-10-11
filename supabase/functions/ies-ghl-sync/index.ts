// GoHighLevel → ies_ghl_contacts  (hourly, full sync)
// Read-only Private Integration token. Contacts deleted in GHL disappear here
// on the next run (anything not seen this run is removed).
import { admin, cronAuthorised, env, json, logRun, upsertChunked } from "../_shared/ies.ts";
import { type Contact, contactRow, DISCORD_FIELD, field } from "../_shared/ghl_map.ts";

const API = "https://services.leadconnectorhq.com";

async function fetchAll(): Promise<Contact[]> {
  const out: Contact[] = [];
  let searchAfter: unknown[] | undefined;
  for (let page = 0; page < 200; page++) { // hard stop: 20k contacts
    const res = await fetch(`${API}/contacts/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("IES_GHL_PRIVATE_TOKEN")}`,
        Version: "2021-07-28",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        locationId: env("IES_GHL_LOCATION_ID"),
        pageLimit: 100,
        sort: [{ field: "dateAdded", direction: "asc" }],
        ...(searchAfter ? { searchAfter } : {}),
      }),
    });
    if (!res.ok) throw new Error(`GHL ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const { contacts = [] } = await res.json() as { contacts: Contact[] };
    out.push(...contacts);
    if (contacts.length < 100) return out;
    searchAfter = contacts[contacts.length - 1].searchAfter;
  }
  throw new Error("GHL pagination did not finish");
}

Deno.serve(async (req) => {
  if (!cronAuthorised(req)) return json({ error: "unauthorised" }, 401);
  const db = admin();
  const syncedAt = new Date().toISOString();
  try {
    const contacts = await fetchAll();
    await upsertChunked(db, "ies_ghl_contacts", contacts.map((c) => contactRow(c, syncedAt)), "contact_id");
    // Only prune after a complete, successful fetch, so a GHL outage never empties the table.
    const { error } = await db.from("ies_ghl_contacts").delete().lt("synced_at", syncedAt);
    if (error) throw new Error(`prune: ${error.message}`);
    const withDiscord = contacts.filter((c) => field(c, DISCORD_FIELD)).length;
    const detail = `${contacts.length} contacts, ${withDiscord} with Discord username`;
    await logRun(db, "ghl", true, detail);
    return json({ ok: true, detail });
  } catch (e) {
    await logRun(db, "ghl", false, (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
