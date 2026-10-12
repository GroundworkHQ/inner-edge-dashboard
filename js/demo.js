// Fake data for ?demo=1, so the layout can be reviewed before any real data
// exists. Every name here is invented. Numbers are round-ish on purpose.
(function () {
  const first = ['Alex', 'Sam', 'Jordan', 'Chris', 'Taylor', 'Morgan', 'Jamie', 'Robin', 'Casey', 'Drew', 'Riley', 'Quinn'];
  const last = ['Walker', 'Hughes', 'Patel', 'Evans', 'Green', 'Ward', 'Price', 'Bell', 'Cole', 'Shaw', 'Lane', 'Ford'];
  const pick = (i) => `${first[i % first.length]} ${last[(i * 7) % last.length]}`;
  const email = (i) => `${first[i % first.length].toLowerCase()}.${last[(i * 7) % last.length].toLowerCase()}@example.com`;

  window.demoData = function () {
    const trend = [];
    let mrr = 398_600;
    for (let i = 89; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      mrr += Math.round((Math.sin(i / 6) + 0.35) * 1500);
      trend.push({ day: d.toISOString().slice(0, 10), mrr_cents: Math.round(mrr / 7700) * 7700 });
    }
    const current = trend[trend.length - 1].mrr_cents;
    const now = new Date().toISOString();
    return {
      metrics: {
        mrr_cents: current, currency: 'usd', paid_members: Math.round(current / 7700),
        new_this_month: 6, churned_this_month: 3, past_due: 2, cancelling: 4,
      },
      members: (() => {
        const person = (i, extra) => ({ customer_id: `cus_${i}`, name: pick(i), email: email(i), ...extra });
        const ago = (n) => new Date(Date.now() - n * 86400000).toISOString();
        const ahead = (n) => new Date(Date.now() + n * 86400000).toISOString();
        return {
          paid: Array.from({ length: Math.round(current / 7700) }, (_, i) => person(i, { started_at: ago(5 + i * 3) })),
          new: [0, 1, 2, 3, 4, 5].map((i) => person(i, { started_at: ago(1 + i) })),
          churned: [6, 7, 8].map((i) => person(i, { ended_at: ago(2 + i) })),
          pastdue: [9, 10].map((i) => person(i, { current_period_end: ago(i - 6) })),
          cancelled: [
            ...[11, 12].map((i) => person(i, { ending: true, when: ahead(i) })),
            ...[13, 14, 15, 16, 17].map((i) => person(i, { ending: false, when: ago(i * 6) })),
          ],
        };
      })(),
      trend,
      comps: [7, 8, 9].map((i) => ({ name: pick(i), email: email(i) })),
      staff: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ name: pick(i), email: email(i) })),
      discord: Array.from({ length: 13 }, (_, i) => ({
        username: `trader_${1000 + i * 37}`, display_name: pick(i + 3),
        contact_name: i % 3 ? pick(i + 3) : null, status: i % 3 ? 'not_paying' : 'unmatched',
      })),
      missingDiscord: [],
      // One of each warning, so the card counts, dropdown notes and name tags show.
      accessGaps: [
        { name: pick(8), email: email(8), kind: 'comp', issue: 'no_member_role' },
        { name: pick(3), email: email(3), kind: 'paying', issue: 'not_in_discord' },
      ],
      portalGaps: [
        { name: pick(8), email: email(8), kind: 'comp', issue: 'no_portal_access' },
        { name: pick(5), email: email(5), kind: 'staff', issue: 'no_portal_access' },
      ],
      skool: Array.from({ length: 10 }, (_, i) => ({ name: pick(i + 2), email: email(i + 2), date_added: trend[0].day })),
      never: Array.from({ length: 21 }, (_, i) => ({ name: pick(i + 5), email: email(i + 5), date_added: trend[i * 4].day })),
      runs: [
        { source: 'stripe', ok: true, ran_at: new Date(Date.now() - 4 * 60000).toISOString() },
        { source: 'ghl', ok: true, ran_at: new Date(Date.now() - 22 * 60000).toISOString(), detail: '128 contacts' },
        { source: 'discord', ok: true, ran_at: new Date(Date.now() - 17 * 60000).toISOString(), detail: '96 members' },
        { source: 'snapshot', ok: true, ran_at: now },
      ],
    };
  };
})();
