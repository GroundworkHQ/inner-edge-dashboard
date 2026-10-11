// Discord member -> ies_discord_members row. No I/O, unit tested.
import { PROJECT_ID } from "./ies.ts";

export type Member = {
  user: { id: string; username: string; global_name?: string | null; bot?: boolean };
  nick?: string | null;
  joined_at?: string | null;
  roles?: string[];
};

// roleNames maps the server's role ids to names, so rows store readable names
// (e.g. "Member") rather than ids that mean nothing outside Discord.
export function memberRow(m: Member, syncedAt: string, roleNames: Map<string, string> = new Map()) {
  return {
    project_id: PROJECT_ID,
    user_id: m.user.id,
    username: m.user.username.toLowerCase(),
    display_name: m.nick ?? m.user.global_name ?? null,
    joined_at: m.joined_at ?? null,
    is_bot: !!m.user.bot,
    roles: (m.roles ?? []).map((id) => roleNames.get(id)).filter((n): n is string => !!n),
    synced_at: syncedAt,
  };
}
