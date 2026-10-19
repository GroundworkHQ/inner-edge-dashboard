// Draws the dashboard from one plain data object, whether it came from
// Supabase (app.js) or from the demo generator (demo.js):
//   { metrics, members: {paid, new, churned, pastdue, cancelled}, trend: [{day, mrr_cents}],
//     comps: [...], discord: [...], never: [...], runs: [...] }
// All text goes in through textContent, never innerHTML, so names from the
// CRM can't inject markup.
(function () {
  const $ = (id) => document.getElementById(id);

  // $ / £ toggle. Stripe bills in USD; pounds are converted at today's rate
  // (ECB reference rate via frankfurter.dev, cached per day per browser). The
  // pick is remembered per browser; if the rate can't load, it stays in dollars.
  const CUR_KEY = 'ies-currency', RATE_KEY = 'ies-usd-gbp';
  let showCur = 'usd';
  let gbpRate = null;
  try {
    showCur = localStorage.getItem(CUR_KEY) || 'usd';
    const cached = JSON.parse(localStorage.getItem(RATE_KEY) || 'null');
    if (cached && cached.day === new Date().toISOString().slice(0, 10)) gbpRate = cached.rate;
  } catch (e) { /* storage blocked */ }
  const inGbp = () => showCur === 'gbp' && gbpRate;

  function money(cents, currency) {
    let cur = (currency || 'usd').toLowerCase();
    let amount = (cents || 0) / 100;
    if (inGbp() && cur === 'usd') { amount *= gbpRate; cur = 'gbp'; }
    return new Intl.NumberFormat('en-GB', {
      style: 'currency', currency: cur.toUpperCase(), currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0,
    }).format(amount);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // "12 Sep", or "12 Sep 2025" outside the current year. UK time, like the business.
  function fmtDay(iso) {
    if (!iso) return '';
    const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
    const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'Europe/London' });
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
    $('trend-caption').textContent = `${fmtDay(first)} to ${fmtDay(last)} · low ${money(min, currency)} · high ${money(max, currency)}`
      + (inGbp() ? ` · in £ at today's rate ($1 = £${gbpRate.toFixed(2)})` : '');
  }

  function fillList(id, rows, toItem) {
    const box = $(id);
    box.querySelector('[data-count]').textContent = rows.length;
    box.classList.toggle('clear', !rows.length && box.hasAttribute('data-zero-ok'));
    const ul = box.querySelector('ul');
    ul.replaceChildren();
    const records = [];
    for (const r of rows) {
      const li = toItem(r);
      ul.appendChild(li);
      // One CSV row per list row: what the card shows, plus the email when we have it.
      const meta = li.querySelector('.meta')?.textContent || '';
      records.push({
        Name: li.querySelector('.who')?.firstChild?.textContent || '',
        Email: r.email || r.contact_email || (meta.includes('@') && !meta.startsWith('@') ? meta : ''),
        Discord: meta.startsWith('@') ? meta.slice(1) : '',
        Detail: meta.includes('@') ? '' : meta,
        Flag: li.querySelector('.tag')?.textContent || '',
      });
    }
    if (!rows.length) ul.appendChild(el('li', 'empty', 'Nobody here'));
    // "Download CSV" sits just above the list, only when there's something to download.
    let dl = box.querySelector('.dl');
    if (!dl) {
      dl = el('button', 'link dl', 'Download CSV');
      dl.type = 'button';
      dl.addEventListener('click', () => downloadCsv(box, dl.records));
      ul.before(dl);
    }
    dl.records = records;
    dl.hidden = !records.length;
  }

  // Spreadsheet apps run cells starting with = + - @ as formulas, and names come
  // from the CRM, so those get a leading apostrophe.
  function csvCell(v) {
    let t = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }

  function downloadCsv(box, records) {
    const cols = ['Name', 'Email', 'Discord', 'Detail', 'Flag'].filter((c) => records.some((r) => r[c]));
    const csv = [cols, ...records.map((r) => cols.map((c) => r[c]))].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const label = box.querySelector('summary .label')?.textContent.trim() || 'list';
    const name = `inner-edge-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${new Date().toISOString().slice(0, 10)}.csv`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Names display Title Cased whatever Stripe/GHL/Discord hold ("david henry"
  // shows as "David Henry", "gRIMES" as "Grimes"). Words that start with a capital
  // and mix case on purpose (McCrindle, DeBry) are left alone; emails pass
  // through untouched. Display only, data is unchanged.
  function properName(s) {
    if (!s || s.includes('@')) return s;
    return s.split(' ').map((w) => (/[a-z]/i.test(w) && (w === w.toLowerCase() || w === w.toUpperCase() || /^[a-z]/.test(w))
      ? w.toLowerCase().replace(/(^|[-'’])([a-z])/g, (_, sep, c) => sep + c.toUpperCase())
      : w)).join(' ');
  }

  function item(who, meta, tag) {
    const li = el('li');
    const left = el('span', 'who', properName(who));
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
      $('mrr-delta').textContent = `${diff >= 0 ? '+' : '−'}${money(Math.abs(diff), m.currency)} since ${fmtDay(pts[0].day)}`;
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

  let lastData = null;
  const paintCur = () => {
    for (const b of document.querySelectorAll('#cur-toggle button')) b.classList.toggle('on', b.dataset.cur === (inGbp() ? 'gbp' : 'usd'));
  };
  async function loadRate() {
    if (gbpRate) return true;
    try {
      const r = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=GBP');
      const j = await r.json();
      if (!j?.rates?.GBP) return false;
      gbpRate = j.rates.GBP;
      try { localStorage.setItem(RATE_KEY, JSON.stringify({ day: new Date().toISOString().slice(0, 10), rate: gbpRate })); } catch (e) { /* storage blocked */ }
      return true;
    } catch (e) { return false; }
  }
  document.getElementById('cur-toggle').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-cur]');
    if (!b) return;
    if (b.dataset.cur === 'gbp' && !(await loadRate())) {
      b.title = "Couldn't load today's exchange rate. Try again in a moment.";
      return;
    }
    showCur = b.dataset.cur;
    try { localStorage.setItem(CUR_KEY, showCur); } catch (err) { /* storage blocked */ }
    if (lastData) window.renderDashboard(lastData);
    paintCur();
  });
  // A saved £ choice needs today's rate before the first paint looks right.
  if (showCur === 'gbp' && !gbpRate) loadRate().then((ok) => { if (ok && lastData) window.renderDashboard(lastData); paintCur(); });
  paintCur();

  // Find a Member: type part of a name or email, every word must match. Stripe
  // customers get a link straight to their Stripe profile (opens a new tab), so
  // a cancel is search, click, cancel.
  let searchRows = [];
  const STATUS_CLS = { Paying: 'paying', 'Past Due': 'unmatched', Ending: 'unmatched', Cancelled: 'gone', Staff: 'staff', Comp: 'staff', 'No Membership': 'gone' };
  function drawSearch() {
    const box = $('find-results');
    const words = $('find').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    box.replaceChildren();
    box.hidden = !words.length;
    if (!words.length) return;
    const hits = searchRows
      .filter((r) => { const hay = `${r.name || ''} ${r.email || ''}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
      .sort((a, b) => (a.customer_id ? 0 : 1) - (b.customer_id ? 0 : 1) || (a.name || a.email || '').localeCompare(b.name || b.email || ''));
    for (const r of hits.slice(0, 8)) {
      const li = el('li');
      const left = el('span', 'who', properName(r.name || r.email || 'Unnamed'));
      left.appendChild(el('span', `tag ${STATUS_CLS[r.status] || 'gone'}`, r.status));
      const meta = el('span', 'meta', [r.email, r.when ? `${r.verb} ${fmtDay(r.when)}` : ''].filter(Boolean).join(' · '));
      const info = el('span', 'info');
      info.append(left, meta);
      li.appendChild(info);
      if (/^cus_[A-Za-z0-9]+$/.test(r.customer_id || '')) {
        const a = el('a', 'stripe-link', 'Open in Stripe ↗');
        a.href = `https://dashboard.stripe.com/customers/${r.customer_id}`;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        li.appendChild(a);
      } else {
        li.appendChild(el('span', 'meta', 'Not in Stripe'));
      }
      box.appendChild(li);
    }
    if (!hits.length) box.appendChild(el('li', 'empty', 'No matches'));
    else if (hits.length > 8) box.appendChild(el('li', 'empty', `${hits.length - 8} more, keep typing to narrow it down`));
  }
  // Results drop down under the header box: Escape clears it, a click elsewhere
  // closes it (focusing the box again reopens it), and "/" jumps to it from
  // anywhere on the page.
  $('find').addEventListener('input', drawSearch);
  $('find').addEventListener('focus', drawSearch);
  $('find').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; drawSearch(); e.target.blur(); } });
  document.addEventListener('click', (e) => { if (!e.target.closest('#find-wrap')) $('find-results').hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || $('find-wrap').hidden || e.target.closest?.('input, textarea')) return;
    e.preventDefault();
    $('find').focus();
  });

  window.renderDashboard = function (d) {
    lastData = d;
    searchRows = d.search || [];
    drawSearch();
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
    const day = fmtDay;
    const ml = d.members;
    // Access gaps per person (Discord: ies_v_access_gaps, member portal:
    // ies_v_portal_gaps), keyed by lower-cased email. Gaps marked expected in
    // ies_gap_exceptions never reach the page.
    const gapLabel = { not_in_discord: 'Not in Discord', no_member_role: 'No Discord Role', no_portal_access: 'No Course Access' };
    const gapsFor = new Map();
    for (const g of [...(d.accessGaps || []), ...(d.portalGaps || []).filter((x) => x.issue === 'no_portal_access')]) {
      const k = (g.email || g.name || '').toLowerCase();
      if (!gapsFor.has(k)) gapsFor.set(k, []);
      gapsFor.get(k).push(g);
    }
    const gapTag = (p) => {
      const gs = gapsFor.get((p.email || p.name || '').toLowerCase());
      return gs ? { cls: 'unmatched', text: gs.map((g) => gapLabel[g.issue]).join(' · ') } : null;
    };
    fillList('list-paid', ml.paid, (p) => item(who(p), `Since ${day(p.started_at)}`, gapTag(p)));
    fillList('list-new', ml.new, (p) => item(who(p), `Joined ${day(p.started_at)}`));
    fillList('list-churned', ml.churned, (p) => item(who(p), `Left ${day(p.ended_at)}`));
    fillList('list-pastdue', ml.pastdue, (p) => item(who(p), p.email || ''));
    // Past due has a deadline (Stripe cancels after about a week), so it gets the
    // orange warning treatment while anyone is on it.
    $('list-pastdue').classList.toggle('alert', ml.pastdue.length > 0);
    fillList('list-cancelled', ml.cancelled, (p) =>
      item(who(p), p.ending ? `Ends ${day(p.when)}` : `Left ${day(p.when)}`, p.ending ? { cls: 'unmatched', text: 'Ending' } : null));

    fillList('list-comps', d.comps, (p) => item(p.name || p.email || 'Unnamed', p.email, gapTag(p)));
    fillList('list-staff', d.staff || [], (p) => item(p.name || p.email || 'Unnamed', p.email, gapTag(p)));
    fillList('list-discord', d.discord, (x) =>
      item(x.contact_name || x.display_name || x.username, '@' + x.username,
        x.status === 'unmatched' ? { cls: 'unmatched', text: 'Unmatched' } : null));
    // People who should have access but don't, per card. The card face shows a
    // count; the full notes sit at the top of the dropdown, and each name in the
    // list carries a tag.
    const nameOf = (g) => properName(g.name || g.email);
    const gapNote = (cardId, warnId, detailId, kind) => {
      const gs = [...(d.accessGaps || []), ...(d.portalGaps || []).filter((g) => g.issue === 'no_portal_access')]
        .filter((g) => g.kind === kind);
      const notes = gs.map((g) => `${nameOf(g)} ${{
        not_in_discord: 'is not in the Discord server',
        no_member_role: 'has no Member role in Discord',
        no_portal_access: 'has no course access',
      }[g.issue]}.`);
      const people = new Set(gs.map((g) => (g.email || g.name || '').toLowerCase())).size;
      $(cardId).classList.toggle('alert', people > 0);
      $(warnId).hidden = !people;
      $(warnId).textContent = people ? `⚠ ${people} to check` : '';
      $(detailId).hidden = !people;
      $(detailId).textContent = notes.join(' ');
    };
    gapNote('list-paid', 'paid-warn', 'paid-detail', 'paying');
    gapNote('list-comps', 'comps-warn', 'comps-detail', 'comp');
    gapNote('list-staff', 'staff-warn', 'staff-detail', 'staff');

    // Course access without a reason to have it.
    const free = (d.portalGaps || []).filter((g) => g.issue === 'unpaid_portal_access');
    fillList('list-freeportal', free, (g) => item(nameOf(g), g.email || ''));
    $('list-freeportal').classList.toggle('alert', free.length > 0);

    // Zap health check: see missingDiscord() in app.js.
    const warn = $('discord-warn');
    const miss = d.missingDiscord || [];
    $('list-discord').classList.toggle('alert', miss.length > 0);
    warn.hidden = !miss.length;
    warn.textContent = miss.length ? `⚠ ${miss.length} missing a Discord name` : '';
    $('discord-detail').hidden = !miss.length;
    $('discord-detail').textContent = miss.length
      ? `${miss.length} paying member${miss.length > 1 ? 's' : ''} from the last 2 weeks ${miss.length > 1 ? 'have' : 'has'} no Discord name yet: ${miss.map((p) => properName(p.name || p.email)).join(', ')}. Either they never gave one (still Pending in the Zapier table) or the "Add Discord Name" Zap missed them.`
      : '';

    fillList('list-never', d.never, (p) =>
      item(p.name || p.email || 'Unnamed', fmtDay(p.date_added)));
    fillList('list-skool', d.skool || [], (p) =>
      item(p.name || p.email || 'Unnamed', fmtDay(p.date_added)));

    // Status of every source we track, each with a dot: green = fine, amber =
    // late (hourly sync over 2h old, daily snapshot over 26h), red = last run failed.
    const sync = $('sync');
    sync.replaceChildren(el('span', 'sync-title', 'Last Synced:'));
    const labels = { stripe: 'Stripe', ghl: 'GoHighLevel', discord: 'Discord', snapshot: 'Daily Snapshot' };
    for (const src of Object.keys(labels)) {
      const r = d.runs.find((x) => x.source === src || (src === 'stripe' && x.source === 'stripe-backfill'));
      const age = r ? Date.now() - new Date(r.ran_at).getTime() : Infinity;
      const late = age > (src === 'snapshot' ? 26 : 2) * 3600000;
      const state = r && !r.ok ? 'bad' : late ? 'late' : 'good';
      const s = el('span', `src ${state}`, `${labels[src]} ${r ? ago(r.ran_at) : 'never'}${state === 'bad' ? ' (failed)' : ''}`);
      if (r && r.detail) s.title = r.detail;
      sync.appendChild(s);
    }
  };

  // Info tooltips (the "i" on each card). Hover on desktop, tap on phones. The
  // button sits inside <summary>, so a tap must not also open the card.
  const pop = document.createElement('div');
  pop.id = 'tip-pop';
  pop.hidden = true;
  document.body.appendChild(pop);
  let current = null;
  const hideTip = () => { pop.hidden = true; current?.classList.remove('on'); current = null; };
  const showTip = (btn) => {
    if (current && current !== btn) current.classList.remove('on');
    current = btn;
    btn.classList.add('on');
    pop.textContent = btn.dataset.tip;
    pop.hidden = false;
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
    const top = r.bottom + 8 + h > window.innerHeight ? r.top - h - 8 : r.bottom + 8;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  };
  const hoverable = matchMedia('(hover: hover)').matches;
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.tip');
    if (!btn) { hideTip(); return; }
    e.preventDefault();
    e.stopPropagation();
    current === btn && !hoverable ? hideTip() : showTip(btn);
  }, true);
  if (hoverable) {
    document.addEventListener('mouseover', (e) => { const b = e.target.closest('.tip'); if (b) showTip(b); });
    document.addEventListener('mouseout', (e) => { if (e.target.closest('.tip')) hideTip(); });
  }
  window.addEventListener('scroll', hideTip, { passive: true });
})();
