// Past-due alerts for the Discord staff channel. Runs after every Stripe sync:
// posts once when a subscription goes past due (with the member's story and a
// sample DM so a mod can reach out), and once when it settles. ies_member_alerts
// keeps it to one post per episode. Skips quietly until the webhook is set.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { lower } from "./ies.ts";
import { accountArgs, stripe } from "./stripe_client.ts";

type Sub = {
  subscription_id: string; customer_id: string; status: string; monthly_amount_cents: number;
  started_at: string | null; ended_at: string | null; current_period_end: string | null;
};

const DAY = 86_400_000;
// Stripe > Settings > Billing > Manage failed payments: Smart Retries up to 4
// times within 1 week, then cancel the subscription. Change both together.
const RETRY_WINDOW_DAYS = 7;
const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "unknown";
const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

function relDays(iso: string): string {
  const d = Math.round((new Date(iso).getTime() - Date.now()) / DAY);
  if (d === 0) return "today";
  return d > 0 ? `in ${d} day${d === 1 ? "" : "s"}` : `${-d} day${d === -1 ? "" : "s"} ago`;
}

function tenure(fromIso: string): string {
  const days = Math.max(0, Math.round((Date.now() - new Date(fromIso).getTime()) / DAY));
  if (days < 45) return `${days} days`;
  const months = Math.round(days / 30.4);
  return `${months} month${months === 1 ? "" : "s"}`;
}

export async function runPastDueAlerts(db: SupabaseClient): Promise<string> {
  const hook = Deno.env.get("IES_DISCORD_ALERT_WEBHOOK")?.trim();
  if (!hook) return "alerts off (no webhook)";
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(hook)) return "alerts off (webhook url invalid)";

  const [{ data: pastDue, error: e1 }, { data: open, error: e2 }] = await Promise.all([
    db.from("ies_stripe_subscriptions").select("*").eq("status", "past_due"),
    db.from("ies_member_alerts").select("*").eq("kind", "past_due").is("resolved_at", null),
  ]);
  if (e1 || e2) throw new Error(`alerts read: ${(e1 ?? e2)!.message}`);

  const openIds = new Set((open ?? []).map((a) => a.subscription_id));
  const dueIds = new Set((pastDue ?? []).map((s) => s.subscription_id));
  let posted = 0, settled = 0;

  for (const sub of (pastDue ?? []) as Sub[]) {
    if (openIds.has(sub.subscription_id)) continue;
    // Claim the episode first: if two syncs overlap, the unique index lets only one post.
    const { data: claim, error } = await db.from("ies_member_alerts")
      .insert({ subscription_id: sub.subscription_id, customer_id: sub.customer_id, kind: "past_due" })
      .select("id").single();
    if (error) continue;
    try {
      await post(hook, await pastDueMessage(db, sub));
    } catch (e) {
      // Not sent: release the claim so the next sync tries again.
      await db.from("ies_member_alerts").delete().eq("id", claim.id);
      throw e;
    }
    posted++;
  }

  for (const alert of open ?? []) {
    if (dueIds.has(alert.subscription_id)) continue;
    const { data: sub } = await db.from("ies_stripe_subscriptions").select("status").eq("subscription_id", alert.subscription_id).maybeSingle();
    if (!sub) continue;
    const paid = sub.status === "active" || sub.status === "trialing";
    const name = await customerName(db, alert.customer_id);
    await post(hook, paid
      ? `✅ **${name}** paid. Their membership is back to normal, no need to reach out.`
      : `❌ **${name}**'s subscription was cancelled after the failed payment (Stripe status: ${sub.status}). Check their portal access and Discord role are removed.`);
    await db.from("ies_member_alerts").update({ resolved_at: new Date().toISOString(), resolution: paid ? "paid" : "cancelled" }).eq("id", alert.id);
    settled++;
  }
  return `alerts: ${posted} new, ${settled} settled`;
}

async function post(hook: string, content: string) {
  const res = await fetch(hook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // No pings: member names come from Stripe/GHL and must never mention @everyone.
    // The webhook's own name in Discord is ignored; every post shows as Member Alerts.
    body: JSON.stringify({ username: "Member Alerts", content: content.slice(0, 2000), allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) throw new Error(`discord webhook ${res.status}`);
}

async function customerName(db: SupabaseClient, customerId: string): Promise<string> {
  const { data } = await db.from("ies_stripe_customers").select("name, email").eq("customer_id", customerId).maybeSingle();
  return data?.name || data?.email || "A member";
}

async function pastDueMessage(db: SupabaseClient, sub: Sub): Promise<string> {
  const { data: cust } = await db.from("ies_stripe_customers").select("name, email").eq("customer_id", sub.customer_id).maybeSingle();
  const email = lower(cust?.email);

  // Every email this person is known by: their Stripe email plus any manual GHL<->Stripe link.
  const emails = new Set<string>(email ? [email] : []);
  if (email) {
    const [a, b] = await Promise.all([
      db.from("ies_email_links").select("ghl_email, stripe_email").eq("ghl_email", email),
      db.from("ies_email_links").select("ghl_email, stripe_email").eq("stripe_email", email),
    ]);
    for (const l of [...(a.data ?? []), ...(b.data ?? [])]) { emails.add(l.ghl_email); emails.add(l.stripe_email); }
  }
  const list = [...emails];

  // Full subscription history across every Stripe customer with those emails.
  const { data: custs } = list.length ? await db.from("ies_stripe_customers").select("customer_id").in("email", list) : { data: [] };
  const custIds = [...new Set([sub.customer_id, ...(custs ?? []).map((c) => c.customer_id)])];
  const { data: subsRaw } = await db.from("ies_stripe_subscriptions").select("*").in("customer_id", custIds);
  const history = ((subsRaw ?? []) as Sub[])
    .filter((s) => !["incomplete", "incomplete_expired"].includes(s.status) && s.started_at)
    .sort((a, b) => a.started_at!.localeCompare(b.started_at!));
  const first = history[0]?.started_at ?? sub.started_at;
  const cancellations = history.filter((s) => s.ended_at).length;

  const { data: contact } = list.length
    ? await db.from("ies_ghl_contacts").select("name, discord_username, tags").in("email", list).order("date_added", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const discordName = contact?.discord_username ?? null;
  const { data: member } = discordName
    ? await db.from("ies_discord_members").select("user_id, username, display_name, joined_at, roles").eq("username", discordName).maybeSingle()
    : { data: null };
  const tags: string[] = contact?.tags ?? [];
  const roles: string[] = member?.roles ?? [];

  // Failed invoice details straight from Stripe. Optional: the restricted key may
  // not read invoices, and the alert is still useful without them.
  // Without invoice access, the failed renewal is the start of the current
  // period (Stripe rolls the period forward even when the charge fails).
  let pastDueSince: string | null = null;
  if (sub.current_period_end) {
    const d = new Date(sub.current_period_end);
    d.setUTCMonth(d.getUTCMonth() - 1);
    pastDueSince = d.toISOString();
  }
  let invoiceLine = "";
  let retriesDone = false;
  let payUrl: string | null = null;
  try {
    const s = stripe();
    const live = await s.subscriptions.retrieve(sub.subscription_id, {}, ...accountArgs());
    const invId = typeof live.latest_invoice === "string" ? live.latest_invoice : live.latest_invoice?.id;
    if (invId) {
      const inv = await s.invoices.retrieve(invId, {}, ...accountArgs());
      pastDueSince = new Date(inv.created * 1000).toISOString();
      retriesDone = !inv.next_payment_attempt;
      // Stripe's hosted page for this exact invoice: paying it clears past-due at once.
      payUrl = inv.hosted_invoice_url ?? null;
      const next = inv.next_payment_attempt ? fmt(new Date(inv.next_payment_attempt * 1000).toISOString()) : "none left";
      invoiceLine = `• **Retries:** ${inv.attempt_count} attempt${inv.attempt_count === 1 ? "" : "s"} so far for ${money(inv.amount_due)}, next retry: ${next}\n`;
    }
  } catch { /* no invoice access: leave the line out */ }
  const cancelsOn = pastDueSince ? new Date(new Date(pastDueSince).getTime() + RETRY_WINDOW_DAYS * DAY).toISOString() : null;

  const name = cust?.name || contact?.name || cust?.email || "Unknown member";
  const firstName = name.split(/\s+/)[0];
  const rejoins = Math.max(0, history.length - 1);
  const isNew = first ? Date.now() - new Date(first).getTime() < 60 * DAY : false;

  const story: string[] = [];
  story.push(`• **Member Since:** ${fmt(first)} (${first ? tenure(first) : "unknown"})`);
  story.push(`• **Paying:** ${money(sub.monthly_amount_cents)}/mo, this subscription started ${fmt(sub.started_at)}`);
  story.push(`• **History:** ${cancellations === 0 ? "never cancelled before" : `cancelled ${cancellations} time${cancellations === 1 ? "" : "s"} before, rejoined ${rejoins} time${rejoins === 1 ? "" : "s"}`}`);
  story.push(discordName
    // <@id> renders as a clickable profile (click it, then Message). allowed_mentions
    // is empty, so it never pings them.
    ? `• **Discord:** ${member ? `<@${member.user_id}> (@${discordName})` : `@${discordName}`}${member ? `, joined ${fmt(member.joined_at)}${roles.length ? `, roles: ${roles.join(", ")}` : ", no roles"}` : " (not found in the server)"}`
    : `• **Discord:** no username on file, reach out by email: ${cust?.email ?? "unknown"}`);
  if (tags.includes("skool-migrant")) story.push("• **Came Over from Skool**");

  const tips: string[] = [];
  if (isNew) tips.push("New member hitting their first renewal. Often just a card limit or a bank blocking a new merchant.");
  if (cancellations > 0) tips.push(`Has left and come back${rejoins > 1 ? " more than once" : ""}. Worth asking what brought them back and what would make them stay.`);
  if (!isNew && cancellations === 0) tips.push("Long-standing member who has never left. Most likely an expired or replaced card, keep it light.");
  if (roles.some((r) => /coaching/i.test(r))) tips.push("In Coaching Corner, so they're engaged. Mention the coaching sessions.");

  const since = !isNew && first ? ` You've been with us since ${fmt(first).replace(/^\d+ /, "")} and we'd hate to lose you.` : "";
  // Masked link: pasted into a DM, the member sees only "Update your card here"
  // and the long Stripe URL stays hidden.
  const fix = payUrl
    ? `It only takes a minute: [Update your card here](${payUrl})`
    : "Reply here and we'll send you the link to update it.";
  const dm = cancellations > 0
    ? `Hey ${firstName}, it's great having you back in Inner Edge. Quick heads up: your last membership payment didn't go through, which is usually just an expired or replaced card. ${fix}\n\nAnd if something's not working for you, I'd genuinely like to hear it.`
    : `Hey ${firstName}, quick heads up from the Inner Edge team: your last membership payment didn't go through, which is usually just an expired or replaced card.${since} ${fix}\n\nThat way you don't lose access.`;

  return [
    `⚠️ **Payment Failed: ${name}**`,
    "",
    `• **Past Due Since:** ${pastDueSince ? `${fmt(pastDueSince)} (${relDays(pastDueSince)})` : "unknown"}`,
    `• **Stripe Cancels It:** ${retriesDone ? "any time now, all retries are used up" : cancelsOn ? `around ${fmt(cancelsOn)} (${relDays(cancelsOn)}) unless the card is updated` : "unknown"}`,
    ...story,
    invoiceLine.trimEnd() || null,
    // Masked link: Discord shows the text, the long Stripe URL stays hidden.
    payUrl ? `• **[Payment Update Link](${payUrl})**` : null,
    "",
    "**How to Approach It**",
    ...tips.map((t) => `• ${t}`),
    "",
    "**Sample DM** (Copy, Tweak, Send)",
    "```",
    dm,
    "```",
  ].filter((l): l is string => l !== null).join("\n");
}
