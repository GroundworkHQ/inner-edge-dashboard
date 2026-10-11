// GHL contact -> ies_ghl_contacts row. No I/O, unit tested.
import { lower, PROJECT_ID } from "./ies.ts";

export const DISCORD_FIELD = "I9YLZU6lRoH90ssY9WgH";      // contact.discord_username
export const TRADINGVIEW_FIELD = "5Mo67ahsjjv7WnFq1TZE";  // contact.tradingview_username

export type Contact = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  contactName?: string | null;
  tags?: string[];
  dateAdded?: string | null;
  source?: string | null;
  attributionSource?: { medium?: string | null; sessionSource?: string | null } | null;
  customFields?: { id: string; value?: unknown }[];
  searchAfter?: unknown[];
};

export const field = (c: Contact, id: string) => {
  const v = c.customFields?.find((f) => f.id === id)?.value;
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

export function contactRow(c: Contact, syncedAt: string) {
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || c.contactName || null;
  return {
    project_id: PROJECT_ID,
    contact_id: c.id,
    email: lower(c.email),
    name,
    tags: c.tags ?? [],
    discord_username: lower(field(c, DISCORD_FIELD)),
    tradingview_username: field(c, TRADINGVIEW_FIELD),
    date_added: c.dateAdded ?? null,
    // How the contact got into GHL ("membership" = signed up on the member
    // site; csv_import, email/calendar sync, manual entry are not signups).
    source: c.source ?? null,
    attribution_medium: c.attributionSource?.medium ?? c.attributionSource?.sessionSource ?? null,
    synced_at: syncedAt,
  };
}
