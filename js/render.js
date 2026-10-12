// Draws the dashboard from one plain data object, whether it came from
// Supabase (app.js) or from the demo generator (demo.js):
//   { metrics, members: {paid, new, churned, pastdue, cancelled}, trend: [{day, mrr_cents}],
//     comps: [...], discord: [...], never: [...], runs: [...] }
// All text goes in through textContent, never innerHTML, so names from the
// CRM can't inject markup.
(function () {
  const $ = (id) => document.getElementById(id);

  function money(cents, currency) {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency', currency: (currency || 'usd').toUpperCase(), currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0,
    }).format((cents || 0) / 100);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function ago(iso) {
    if (!iso) return 'never';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const h = Math.round(mins / 60);
    return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  }

  function drawTrend(points, currency) {
    const svg = $('trend');
    const NS = 'http://www.w3.org/2000/svg';
    svg.replaceChildren();
    if (points.length < 2) {
      $('trend-caption').textContent = 'The trend line fills in as daily snapshots build up.';
      return;
    }
    const W = 600, H = 160, pad = 8;
    const vals = points.map((p) => p.mrr_cents);
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = max - min || 1;
    const x = (i) => (i / (points.length - 1)) * W;
    const y = (v) => H - pad - ((v - min) / span) * (H - pad * 2);

    const defs = document.createElementNS(NS, 'defs');
    defs.innerHTML = '<linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0" stop-color="#1e9bff" stop-opacity=".35"/>'
      + '<stop offset="1" stop-color="#1e9bff" stop-opacity="0"/></linearGradient>';
    svg.appendChild(defs);
    for (const g of [0.25, 0.5, 0.75]) {
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('class', 'grid');
      l.setAttribute('x1', 0); l.setAttribute('x2', W);
      l.setAttribute('y1', H * g); l.setAttribute('y2', H * g);
      svg.appendChild(l);
    }
    const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.mrr_cents).toFixed(1)}`).join(' ');
    const area = document.createElementNS(NS, 'polygon');
    area.setAttribute('class', 'area');
    area.setAttribute('points', `0,${H} ${line} ${W},${H}`);
    const poly = document.createElementNS(NS, 'polyline');
    poly.setAttribute('class', 'line');
    poly.setAttribute('points', line);
    svg.append(area, poly);

    const first = points[0].day, last = points[points.length - 1].day;
    $('trend-caption').textContent = `${first} to ${last} · low ${money(min, currency)} · high ${money(max, currency)}`;
  }

  function fillList(id, rows, toItem) {
    const box = $(id);
    box.querySelector('[data-count]').textContent = rows.length;
    const ul = box.querySelector('ul');
    ul.replaceChildren();
    if (!rows.length) { ul.appendChild(el('li', 'empty', 'Nobody here')); return; }
    for (const r of rows) ul.appendChild(toItem(r));
  }

  function item(who, meta, tag) {
    const li = el('li');
    const left = el('span', 'who', who);
    if (tag) left.appendChild(el('span', `tag ${tag.cls}`, tag.text));
    li.append(left, el('span', 'meta', meta || ''));
    return li;
  }

  // 30D / 90D / All buttons. The chart and the green change line both follow
  // the chosen range; the pick is remembered per browser.
  const RANGE_KEY = 'ies-mrr-range';
  let range = '30';
  try { range = localStorage.getItem(RANGE_KEY) || '30'; } catch (e) { /* storage blocked */ }
  let lastTrend = null;
  const ALL_FROM = '2026-02-28'; // Inner Edge launch

  function drawRange() {
    if (!lastTrend) return;
    const { t, m } = lastTrend;
    for (const b of document.querySelectorAll('#mrr-range button')) b.classList.toggle('on', b.dataset.range === range);
    const from = range === 'all' ? ALL_FROM : new Date(Date.now() - Number(range) * 86400000).toISOString().slice(0, 10);
    const pts = t.filter((p) => p.day >= from);
    // All starts at launch; days before the first Stripe subscription are $0.
    // One point per day, since the chart spaces points evenly.
    if (range === 'all') {
      const pad = [];
      for (let d = new Date(from); pts.length && d.toISOString().slice(0, 10) < pts[0].day; d = new Date(d.getTime() + 86400000)) {
        pad.push({ day: d.toISOString().slice(0, 10), mrr_cents: 0 });
      }
      pts.unshift(...pad);
    }
    if (pts.length > 1) {
      const diff = m.mrr_cents - pts[0].mrr_cents;
      $('mrr-delta').textContent = `${diff >= 0 ? '+' : '−'}${money(Math.abs(diff), m.currency)} since ${pts[0].day}`;
      $('mrr-delta').style.color = diff >= 0 ? 'var(--up)' : 'var(--down)';
    } else {
      $('mrr-delta').textContent = '';
    }
    drawTrend(pts, m.currency);
  }

  document.getElementById('mrr-range').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-range]');
    if (!b) return;
    range = b.dataset.range;
    try { localStorage.setItem(RANGE_KEY, range); } catch (err) { /* storage blocked */ }
    drawRange();
  });

  window.renderDashboard = function (d) {
    const m = d.metrics;
    $('mrr').textContent = money(m.mrr_cents, m.currency);

    // The chart ends on the live figure, so a churn today shows as a drop
    // straight away instead of waiting for tonight's snapshot.
    const today = new Date().toISOString().slice(0, 10);
    const t = d.trend.filter((p) => p.day < today).concat({ day: today, mrr_cents: m.mrr_cents });

    // Change vs the last snapshot taken before today (UTC).
    const before = d.trend.filter((p) => (p.taken_at || p.day) < today);
    const yday = before.reduce((a, b) => (!a || (b.taken_at || b.day) > (a.taken_at || a.day) ? b : a), null);
    if (yday) {
      const diff = m.mrr_cents - yday.mrr_cents;
      $('mrr-day').textContent = `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${money(Math.abs(diff), m.currency)} since yesterday`;
      $('mrr-day').style.color = diff > 0 ? 'var(--up)' : diff < 0 ? 'var(--down)' : '';
    } else {
      $('mrr-day').textContent = '';
    }

    lastTrend = { t, m };
    drawRange();

    const who = (p) => p.name || p.email || 'Unnamed';
    const day = (iso) => (iso ? iso.slice(0, 10) : '');
    const ml = d.members;
    fillList('list-paid', ml.paid, (p) => item(who(p), `Since ${day(p.started_at)}`));
    fillList('list-new', ml.new, (p) => item(who(p), `Joined ${day(p.started_at)}`));
    fillList('list-churned', ml.churned, (p) => item(who(p), `Left ${day(p.ended_at)}`));
    fillList('list-pastdue', ml.pastdue, (p) => item(who(p), p.email || ''));
    fillList('list-cancelled', ml.cancelled, (p) =>
      item(who(p), p.ending ? `Ends ${day(p.when)}` : `Left ${day(p.when)}`, p.ending ? { cls: 'unmatched', text: 'Ending' } : null));

    fillList('list-comps', d.comps, (p) => item(p.name || p.email || 'Unnamed', p.email));
    fillList('list-staff', d.staff || [], (p) => item(p.name || p.email || 'Unnamed', p.email));
    fillList('list-discord', d.discord, (x) =>
      item(x.contact_name || x.display_name || x.username, '@' + x.username,
        x.status === 'unmatched' ? { cls: 'unmatched', text: 'Unmatched' } : null));
    // People who should have access but don't, per card: Discord (ies_v_access_gaps)
    // and the member portal (ies_v_portal_gaps). Flag the card and name them.
    const nameOf = (g) => g.name || g.email;
    const gapNote = (cardId, warnId, kind) => {
      const notes = [
        ...(d.accessGaps || []).filter((g) => g.kind === kind).map((g) =>
          `${nameOf(g)} ${g.issue === 'not_in_discord' ? 'is not in the Discord server' : 'has no Member role in Discord'}.`),
        ...(d.portalGaps || []).filter((g) => g.kind === kind && g.issue === 'no_portal_access').map((g) =>
          `${nameOf(g)} has no member portal access.`),
      ];
      const box = $(warnId);
      $(cardId).classList.toggle('alert', notes.length > 0);
      box.hidden = !notes.length;
      box.textContent = notes.join(' ');
    };
    gapNote('list-paid', 'paid-warn', 'paying');
    gapNote('list-comps', 'comps-warn', 'comp');
    gapNote('list-staff', 'staff-warn', 'staff');

    // Portal access without a reason to have it.
    const free = (d.portalGaps || []).filter((g) => g.issue === 'unpaid_portal_access');
    fillList('list-freeportal', free, (g) => item(nameOf(g), g.email || ''));
    $('list-freeportal').classList.toggle('alert', free.length > 0);

    // Zap health check: see missingDiscord() in app.js.
    const warn = $('discord-warn');
    const miss = d.missingDiscord || [];
    $('list-discord').classList.toggle('alert', miss.length > 0);
    warn.hidden = !miss.length;
    warn.textContent = miss.length
      ? `${miss.length} paying member${miss.length > 1 ? 's' : ''} from the last 2 weeks ${miss.length > 1 ? 'have' : 'has'} no Discord name yet: ${miss.map((p) => p.name || p.email).join(', ')}. Either they never gave one (still Pending in the Zapier table) or the "Add Discord Name" Zap missed them.`
      : '';

    fillList('list-never', d.never, (p) =>
      item(p.name || p.email || 'Unnamed', p.date_added ? p.date_added.slice(0, 10) : ''));
    fillList('list-skool', d.skool || [], (p) =>
      item(p.name || p.email || 'Unnamed', p.date_added ? p.date_added.slice(0, 10) : ''));

    // Latest run per source. A failed last run shows in red, so a broken sync is obvious.
    const sync = $('sync');
    sync.replaceChildren(el('span', null, 'Last Synced:'));
    const labels = { stripe: 'Stripe', ghl: 'GoHighLevel', discord: 'Discord', snapshot: 'Daily Snapshot' };
    for (const src of Object.keys(labels)) {
      const r = d.runs.find((x) => x.source === src || (src === 'stripe' && x.source === 'stripe-backfill'));
      const s = el('span', r && !r.ok ? 'bad' : null, `${labels[src]} ${r ? ago(r.ran_at) : 'never'}${r && !r.ok ? ' (failed)' : ''}`);
      if (r && r.detail) s.title = r.detail;
      sync.appendChild(s);
    }
  };
})();
