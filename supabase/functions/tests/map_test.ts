// Unit tests for the pure mapping code. Run: deno test supabase/functions/tests
import { assertEquals } from "jsr:@std/assert@1";
import { customerRow, monthlyCents, refundedFirstPaymentSubs, subRow } from "../_shared/stripe_map.ts";
import { contactRow } from "../_shared/ghl_map.ts";
import { memberRow } from "../_shared/discord_map.ts";

const price = (cents: number, interval: "day" | "week" | "month" | "year", count = 1) => ({
  unit_amount: cents, currency: "usd", recurring: { interval, interval_count: count },
});

Deno.test("monthly plan counts as-is", () => {
  assertEquals(monthlyCents([{ quantity: 1, price: price(7700, "month") }]), 7700);
});

Deno.test("yearly plan is divided by 12, quantity multiplies", () => {
  assertEquals(monthlyCents([{ quantity: 2, price: price(12000, "year") }]), 2000);
});

Deno.test("every-3-months plan is divided by 3", () => {
  assertEquals(monthlyCents([{ quantity: 1, price: price(21000, "month", 3) }]), 7000);
});

Deno.test("one-off (non-recurring) items add nothing", () => {
  assertEquals(monthlyCents([{ price: { unit_amount: 5000, currency: "usd", recurring: null } }]), 0);
});

Deno.test("subscription row: dates, customer id, period end on the item (new API)", () => {
  const row = subRow({
    id: "sub_1", customer: { id: "cus_1" }, status: "active", cancel_at_period_end: true,
    start_date: 1_700_000_000, canceled_at: null, ended_at: null,
    items: { data: [{ quantity: 1, current_period_end: 1_700_086_400, price: price(7700, "month") }] },
  });
  assertEquals(row.customer_id, "cus_1");
  assertEquals(row.monthly_amount_cents, 7700);
  assertEquals(row.cancel_at_period_end, true);
  assertEquals(row.started_at, new Date(1_700_000_000_000).toISOString());
  assertEquals(row.current_period_end, new Date(1_700_086_400_000).toISOString());
  assertEquals(row.ended_at, null);
});

Deno.test("customer email is trimmed and lowercased", () => {
  assertEquals(customerRow({ id: "cus_1", email: "  Jane@Example.COM " }).email, "jane@example.com");
});

Deno.test("GHL contact: custom fields picked by id, Discord lowercased, blanks become null", () => {
  const row = contactRow({
    id: "c1", email: "A@B.com", firstName: "Jane", lastName: "Doe", tags: ["ies-team"],
    customFields: [
      { id: "I9YLZU6lRoH90ssY9WgH", value: "Jane_FX" },
      { id: "5Mo67ahsjjv7WnFq1TZE", value: "   " },
    ],
  }, "2026-09-29T00:00:00.000Z");
  assertEquals(row.email, "a@b.com");
  assertEquals(row.name, "Jane Doe");
  assertEquals(row.discord_username, "jane_fx");
  assertEquals(row.tradingview_username, null);
  assertEquals(row.tags, ["ies-team"]);
});

Deno.test("GHL contact keeps how it was created", () => {
  const row = contactRow({ id: "c3", source: "membership", attributionSource: { medium: "csv_import" } }, "x");
  assertEquals(row.source, "membership");
  assertEquals(row.attribution_medium, "csv_import");
  assertEquals(contactRow({ id: "c4" }, "x").source, null);
});

Deno.test("GHL contact with no name parts falls back to contactName", () => {
  assertEquals(contactRow({ id: "c2", contactName: "jane" }, "x").name, "jane");
});

Deno.test("Discord member: nickname wins, username lowercased, bots flagged", () => {
  const row = memberRow({ user: { id: "1", username: "Jane_FX", global_name: "Jane", bot: false }, nick: "Janey" }, "x");
  assertEquals(row.username, "jane_fx");
  assertEquals(row.display_name, "Janey");
  assertEquals(row.is_bot, false);
  assertEquals(memberRow({ user: { id: "2", username: "Bot", bot: true } }, "x").is_bot, true);
  // Role ids become names; ids the server doesn't know are dropped.
  const names = new Map([["10", "Member"], ["11", "Team"]]);
  assertEquals(memberRow({ user: { id: "3", username: "x" }, roles: ["10", "99"] }, "x", names).roles, ["Member"]);
  assertEquals(memberRow({ user: { id: "4", username: "y" } }, "x", names).roles, []);
});

Deno.test("refunded first payment matches the subscription that started with it", () => {
  const subs = [
    { subscription_id: "sub_old", customer_id: "cus_1", started_at: "2026-05-21T12:17:23Z" },
    { subscription_id: "sub_new", customer_id: "cus_1", started_at: "2026-10-21T14:24:08Z" },
    { subscription_id: "sub_other", customer_id: "cus_2", started_at: "2026-10-21T14:24:08Z" },
  ];
  const t = (iso: string) => Date.parse(iso) / 1000;
  const ids = refundedFirstPaymentSubs([
    { id: "ch_1", customer: "cus_1", created: t("2026-10-21T14:24:11Z"), refunded: true },
    // a renewal refund months later is not a first payment
    { id: "ch_2", customer: "cus_1", created: t("2026-08-21T12:17:30Z"), refunded: true },
    // partial or no refund never counts
    { id: "ch_3", customer: "cus_2", created: t("2026-10-21T14:24:10Z"), refunded: false },
  ], subs);
  assertEquals(ids, ["sub_new"]);
});

Deno.test("refund matches only the closest start when two signups are minutes apart", () => {
  const t = (iso: string) => Date.parse(iso) / 1000;
  const ids = refundedFirstPaymentSubs(
    [{ id: "ch_1", customer: "cus_1", created: t("2026-09-02T20:24:17Z"), refunded: true }],
    [
      { subscription_id: "sub_refunded", customer_id: "cus_1", started_at: "2026-09-02T20:24:15Z" },
      { subscription_id: "sub_real", customer_id: "cus_1", started_at: "2026-09-02T20:29:01Z" },
    ],
  );
  assertEquals(ids, ["sub_refunded"]);
});
