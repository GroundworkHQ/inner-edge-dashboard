// Auth + data loading. Magic link only; accounts are never created from here
// (shouldCreateUser: false), and what a signed-in user can read is decided by
// RLS against ies_viewers, not by this file.
(function () {
  const $ = (id) => document.getElementById(id);
  const show = (id) => ['login', 'denied', 'dash', 'setpw'].forEach((s) => ($(s).hidden = s !== id));

  // ?demo=1 renders invented data with no login, for reviewing the layout.
  if (new URLSearchParams(location.search).has('demo')) {
    $('demo-flag').hidden = false;
    show('dash');
    renderDashboard(demoData());
    return;
  }

  const { supabaseUrl, supabaseKey } = window.IES_CONFIG;
  const sb = supabase.createClient(supabaseUrl, supabaseKey);

  // Email + password only. This page never makes Supabase send an email (the
  // project's auth emails go out under IBS branding, which Inner Edge must not
  // see). Accounts and password resets are done by Miguel in the Supabase
  // dashboard; people change their own password with Set Password.
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({
      email: $('email').value.trim().toLowerCase(),
      password: $('password').value,
    });
    btn.disabled = false;
    $('password').value = '';
    if (error) {
      $('login-msg').textContent = error.status >= 500
        ? 'Something went wrong. Try again in a minute.'
        : 'That email and password didn\'t match.';
    }
  });

  $('setpw-open').addEventListener('click', () => { $('setpw-msg').textContent = ''; show('setpw'); });
  $('setpw-cancel').addEventListener('click', () => show('dash'));
  $('setpw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = $('newpw').value, b = $('newpw2').value;
    if (a !== b) { $('setpw-msg').textContent = 'Those two passwords don\'t match.'; return; }
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const { error } = await sb.auth.updateUser({ password: a });
    btn.disabled = false;
    $('newpw').value = ''; $('newpw2').value = '';
    if (error) { $('setpw-msg').textContent = error.message; return; }
    $('setpw-msg').textContent = '';
    show('dash');
  });

  $('signout').addEventListener('click', async () => {
    await sb.auth.signOut();
    location.reload();
  });

  // Pulls fresh data from GHL, Stripe and Discord (ies-sync-now runs the same
  // syncs as the hourly crons, server-side), then re-reads the tables. If the
  // sync call fails the page still reloads what's already there.
  $('refresh').addEventListener('click', async () => {
    const btn = $('refresh');
    btn.disabled = true; btn.textContent = 'Syncing...';
    try {
      const { error } = await sb.functions.invoke('ies-sync-now');
      if (error) console.error(error);
      btn.textContent = 'Refreshing...';
      const { data: { session } } = await sb.auth.getSession();
      await load(session);
      if (error) $('sync').prepend('Could not sync just now, showing the last hourly sync. ');
    } catch (err) {
      console.error(err);
      $('sync').textContent = 'Could not load the data. Try Refresh again.';
    } finally {
      btn.disabled = false; btn.textContent = 'Refresh';
    }
  });

  async function load(session) {
    if (!session) { ['signout', 'setpw-open', 'refresh'].forEach((id) => ($(id).hidden = true)); show('login'); return; }
    ['signout', 'setpw-open', 'refresh'].forEach((id) => ($(id).hidden = false));

    const { data: viewer } = await sb.from('ies_viewers').select('email').maybeSingle();
    if (!viewer) { $('refresh').hidden = true; $('denied-email').textContent = session.user.email; show('denied'); return; }

    const [metrics, members, trend, people, discord, runs, gaps, portal] = await Promise.all([
      sb.from('ies_v_metrics').select('*').single(),
      sb.from('ies_v_members').select('customer_id, name, email, started_at, ended_at, current_period_end, is_paying, is_new, is_churned, is_past_due, is_cancelling'),
      sb.from('ies_mrr_daily').select('day, mrr_cents, taken_at').order('day'),
      sb.from('ies_v_people').select('name, email, discord_username, is_staff, is_comp, is_paying, ever_subscribed, date_added, is_skool_migrant, is_signup, is_ignored'),
      sb.from('ies_v_discord').select('username, display_name, contact_name, status').in('status', ['not_paying', 'unmatched']).eq('has_any_role', true).order('status'),
      sb.from('ies_sync_runs').select('source, ok, detail, ran_at').order('ran_at', { ascending: false }).limit(60),
      sb.from('ies_v_access_gaps').select('name, email, kind, issue'),
      sb.from('ies_v_portal_gaps').select('name, email, kind, issue'),
    ]);
    const failed = [metrics, members, trend, people, discord, runs, gaps, portal].find((r) => r.error);
    if (failed) throw failed.error;

    const p = people.data;
    renderDashboard({
      metrics: metrics.data,
      members: memberLists(members.data),
      trend: trend.data,
      comps: p.filter((x) => x.is_comp && !x.is_staff && !x.is_paying),
      staff: p.filter((x) => x.is_staff && !x.is_paying),
      // Only real member-site signups count as "never paid"; imports, email-synced
      // contacts, tests and ignored (internal) contacts never do.
      never: neverPaid(p.filter((x) => !x.is_skool_migrant && x.is_signup && !x.is_ignored)),
      skool: neverPaid(p.filter((x) => x.is_skool_migrant && !x.is_ignored)),
      discord: discord.data,
      missingDiscord: missingDiscord(members.data, p),
      runs: runs.data,
      accessGaps: gaps.data,
      portalGaps: portal.data,
    });
    show('dash');
  }

  // One row per person per list (a customer can hold more than one subscription),
  // matching the distinct-customer counts in ies_v_metrics.
  function memberLists(rows) {
    const pick = (flag, sortKey, desc) => {
      const seen = new Map();
      for (const r of rows) if (r[flag] && !seen.has(r.customer_id)) seen.set(r.customer_id, r);
      return [...seen.values()].sort((a, b) => {
        const x = a[sortKey] || '', y = b[sortKey] || '';
        return desc ? y.localeCompare(x) : x.localeCompare(y);
      });
    };
    return {
      paid: pick('is_paying', 'started_at', true),
      new: pick('is_new', 'started_at', true),
      churned: pick('is_churned', 'ended_at', true),
      pastdue: pick('is_past_due', 'current_period_end', false),
      cancelled: cancelledList(rows),
    };
  }

  // GHL contacts with an email who have never had a real subscription and aren't
  // staff or comps, newest first.
  function neverPaid(people) {
    return people.filter((x) => x.email && !x.ever_subscribed && !x.is_staff && !x.is_comp)
      .sort((a, b) => (b.date_added || '').localeCompare(a.date_added || ''));
  }

  // Running list of everyone who has left: ended subscriptions, minus anyone who
  // has since come back and is paying again. People who have cancelled but still
  // have paid time left are included too, marked as ending.
  function cancelledList(rows) {
    const payingNow = new Set(rows.filter((r) => r.is_paying && !r.is_cancelling).map((r) => r.customer_id));
    const out = new Map();
    for (const r of rows) {
      if (payingNow.has(r.customer_id)) continue;
      // Customer deleted in Stripe: nothing left to show, so leave them off.
      if (!r.name && !r.email) continue;
      let entry = null;
      if (r.is_cancelling) entry = { ...r, ending: true, when: r.current_period_end };
      else if (r.ended_at) entry = { ...r, ending: false, when: r.ended_at };
      if (!entry) continue;
      const prev = out.get(r.customer_id);
      if (!prev || (entry.ending && !prev.ending) || (!prev.ending && (entry.when || '') > (prev.when || ''))) out.set(r.customer_id, entry);
    }
    // The same person can leave behind two Stripe customers (a second email at
    // checkout), e.g. "Steve" and "Steven" with the same surname. Collapse on first initial +
    // surname, keeping the most recent.
    const byPerson = new Map();
    for (const r of out.values()) {
      const parts = (r.name || r.email || '').toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/);
      const key = parts.length > 1 ? parts[0][0] + ' ' + parts[parts.length - 1] : (r.email || r.customer_id);
      const prev = byPerson.get(key);
      if (!prev || (r.ending && !prev.ending) || (!prev.ending && (r.when || '') > (prev.when || ''))) byPerson.set(key, r);
    }
    return [...byPerson.values()].sort((a, b) => (b.ending - a.ending) || (b.when || '').localeCompare(a.when || ''));
  }

  // Members who joined 1 to 14 days ago and are paying, but whose GHL contact
  // still has no Discord username. Either they never submitted one (Pending in
  // the Zapier table, so they may not have Discord access) or the "Add Discord
  // Name" Zap failed to copy it. Both need a human to look.
  function missingDiscord(rows, people) {
    const named = new Set(people.filter((x) => x.discord_username).map((x) => (x.email || '').toLowerCase()));
    const now = Date.now(), day = 86400000;
    const seen = new Set();
    return rows.filter((r) => {
      const age = now - new Date(r.started_at).getTime();
      if (!r.is_paying || age < day || age > 14 * day || seen.has(r.customer_id)) return false;
      seen.add(r.customer_id);
      return !named.has((r.email || '').toLowerCase());
    });
  }

  // Only (re)load on sign-in state changes. USER_UPDATED (a password save) and
  // TOKEN_REFRESHED would otherwise re-run load() and bounce the page around.
  sb.auth.onAuthStateChange((event, session) => {
    if (!['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT'].includes(event)) return;
    load(session).catch((err) => {
      console.error(err);
      show('dash');
      $('sync').textContent = 'Could not load the data. Refresh to try again.';
    });
  });
})();
