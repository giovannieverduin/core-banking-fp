export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Core Banking - Dashboard</title>
  <style>
    :root {
      --bg: #0f1419;
      --panel: #1a2028;
      --border: #2a3340;
      --text: #d6e1ee;
      --muted: #7a8a99;
      --ok: #4ade80;
      --bad: #f87171;
      --accent: #60a5fa;
      --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); color: var(--text); }
    header { padding: 12px 20px; border-bottom: 1px solid var(--border); display: flex; gap: 16px; align-items: center; }
    h1 { font-size: 18px; margin: 0; font-weight: 600; }
    .badge { padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
    .ok { background: rgba(74,222,128,0.15); color: var(--ok); }
    .bad { background: rgba(248,113,113,0.15); color: var(--bad); }
    main { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 20px; }
    .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
    .panel h2 { margin: 0 0 12px; font-size: 14px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
    table { width: 100%; border-collapse: collapse; font-family: var(--mono); font-size: 12px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 500; }
    td { color: var(--text); }
    td.num { text-align: right; }
    .feed { max-height: 400px; overflow-y: auto; font-family: var(--mono); font-size: 12px; }
    .event { padding: 6px 0; border-bottom: 1px solid var(--border); }
    .event .type { color: var(--accent); font-weight: 500; }
    .event .meta { color: var(--muted); font-size: 11px; }
    .full { grid-column: 1 / -1; }
    .empty { color: var(--muted); font-style: italic; padding: 12px; }
  </style>
</head>
<body>
  <header>
    <h1>Core Banking</h1>
    <span id="integrityBadge" class="badge">loading...</span>
    <span id="balanceBadge" class="badge">loading...</span>
    <span style="margin-left:auto;color:var(--muted);font-size:12px;" id="generatedAt">-</span>
  </header>
  <main>
    <section class="panel">
      <h2>Customer Accounts</h2>
      <table id="customerTable"><thead><tr><th>Account</th><th>Owner</th><th>Currency</th><th class="num">Balance</th><th class="num">Version</th></tr></thead><tbody></tbody></table>
    </section>
    <section class="panel">
      <h2>Trial Balance</h2>
      <table id="trialTable"><thead><tr><th>Currency</th><th class="num">Debits</th><th class="num">Credits</th><th class="num">Difference</th></tr></thead><tbody></tbody></table>
    </section>
    <section class="panel">
      <h2>System Accounts</h2>
      <table id="systemTable"><thead><tr><th>Account</th><th class="num">Balance</th></tr></thead><tbody></tbody></table>
    </section>
    <section class="panel">
      <h2>External Rails</h2>
      <table id="externalTable"><thead><tr><th>Rail</th><th class="num">Balance</th></tr></thead><tbody></tbody></table>
    </section>
    <section class="panel full">
      <h2>Live Event Feed</h2>
      <div id="feed" class="feed"><div class="empty">Waiting for events...</div></div>
    </section>
  </main>
  <script>
    const params = new URLSearchParams(location.search);
    const adminKey = params.get('key');
    if (!adminKey) {
      document.body.innerHTML = '<div style="padding:24px;color:#f87171;font-family:ui-monospace,monospace;">Missing admin key. Append ?key=YOUR_ADMIN_KEY to the URL.</div>';
      throw new Error('no key');
    }
    const authHeader = { 'Authorization': 'Bearer ' + adminKey };
    function fmt(money) { return money.amount + ' ' + money.currency; }
    function render(snap) {
      document.getElementById('generatedAt').textContent = snap.generatedAt;
      const ib = document.getElementById('integrityBadge');
      ib.className = 'badge ' + (snap.integrity.ok ? 'ok' : 'bad');
      ib.textContent = snap.integrity.ok ? 'Chain Intact' : 'Tamper Detected';
      const trialOk = snap.trialBalance.every(r => r.difference === '0');
      const bb = document.getElementById('balanceBadge');
      bb.className = 'badge ' + (trialOk ? 'ok' : 'bad');
      bb.textContent = trialOk ? 'Books Balanced' : 'Books Unbalanced';

      const ct = document.querySelector('#customerTable tbody');
      ct.innerHTML = snap.customerAccounts.map(a =>
        '<tr><td>' + a.accountId.slice(0,8) + '...</td><td>' + a.owner + '</td><td>' + a.currency + '</td><td class="num">' + a.balance.amount + '</td><td class="num">' + a.version + '</td></tr>'
      ).join('') || '<tr><td colspan="5" class="empty">No accounts</td></tr>';

      const tt = document.querySelector('#trialTable tbody');
      tt.innerHTML = snap.trialBalance.map(r =>
        '<tr><td>' + r.currency + '</td><td class="num">' + r.debit + '</td><td class="num">' + r.credit + '</td><td class="num">' + r.difference + '</td></tr>'
      ).join('') || '<tr><td colspan="4" class="empty">No activity</td></tr>';

      const st = document.querySelector('#systemTable tbody');
      st.innerHTML = snap.systemAccounts.map(s =>
        '<tr><td>' + s.key + '</td><td class="num">' + fmt(s.balance) + '</td></tr>'
      ).join('') || '<tr><td colspan="2" class="empty">No system balances</td></tr>';

      const xt = document.querySelector('#externalTable tbody');
      xt.innerHTML = snap.externalAccounts.map(s =>
        '<tr><td>' + s.key + '</td><td class="num">' + fmt(s.balance) + '</td></tr>'
      ).join('') || '<tr><td colspan="2" class="empty">No external balances</td></tr>';

      const feed = document.getElementById('feed');
      feed.innerHTML = snap.recentEvents.slice().reverse().map(renderEvent).join('') || '<div class="empty">No events</div>';
    }
    function renderEvent(e) {
      return '<div class="event"><span class="type">' + e.payload.type + '</span> <span class="meta">v' + e.metadata.version + ' &middot; ' + e.metadata.aggregateId.slice(0,8) + '...</span><div class="meta">' + e.metadata.occurredAt + '</div></div>';
    }
    function prependEvent(e) {
      const feed = document.getElementById('feed');
      const div = document.createElement('div');
      div.innerHTML = renderEvent(e);
      const empty = feed.querySelector('.empty');
      if (empty) feed.innerHTML = '';
      feed.insertBefore(div.firstChild, feed.firstChild);
      while (feed.children.length > 50) feed.removeChild(feed.lastChild);
    }
    async function refresh() {
      const res = await fetch('/admin/snapshot', { headers: authHeader });
      if (!res.ok) { console.error('snapshot failed', res.status); return; }
      render(await res.json());
    }
    refresh();
    setInterval(refresh, 5000);
    const es = new EventSource('/admin/events/stream?key=' + encodeURIComponent(adminKey));
    es.addEventListener('event', (msg) => {
      try { prependEvent(JSON.parse(msg.data)); } catch (err) { console.error(err); }
      // Refresh aggregates lazily on new events
      refresh();
    });
    es.onerror = (err) => console.error('SSE error', err);
  </script>
</body>
</html>`;
