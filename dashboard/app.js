// Token Radar dashboard: a static page over window.RADAR (written by main.ts, no network).
//
// Views: the board (every rankable pre-token protocol, sortable and filterable), the live-token
// view (protocols that record a token, shown at the market's own value, never ranked), and the
// model view (the fitted value model and its held-out record). A row opens a detail drawer with
// the value breakdown and the farm plan. State lives in the URL hash, so a view can be linked:
// #view=board&q=&cat=&chain=&watchlist=1&min=&sort=rank&dir=asc&detail=<slug>.
(function () {
  'use strict';
  var R = window.RADAR;
  var main = document.getElementById('board');
  var detailEl = document.getElementById('detail');
  var footEl = document.getElementById('foot');
  var asofEl = document.getElementById('asof');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) {
    if (n == null) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function pct(n) {
    if (n == null) return '—';
    var v = (Math.round(n * 10) / 10).toFixed(1);
    return (n > 0 ? '+' : '') + v + '%';
  }
  function ageText(a) {
    if (a == null) return '—';
    if (a < 30) return a + 'd';
    if (a < 365) return Math.round(a / 30) + 'mo';
    return (a / 365).toFixed(1) + 'y';
  }
  function chainsText(c) {
    if (!c || !c.length) return '—';
    return c.length > 2 ? c.slice(0, 2).join(', ') + ' +' + (c.length - 2) : c.join(', ');
  }

  function parseHash() {
    var h = (location.hash || '').replace(/^#/, '');
    var out = { view: 'board', q: '', cat: '', chain: '', watchlist: false, min: 0, sort: 'rank', dir: 'asc', detail: '' };
    if (!h) return out;
    h.split('&').forEach(function (part) {
      var kv = part.split('=');
      var k = decodeURIComponent(kv[0] || '');
      var v = decodeURIComponent(kv[1] || '');
      if (k === 'view' && (v === 'board' || v === 'live' || v === 'model')) out.view = v;
      else if (k === 'q') out.q = v;
      else if (k === 'cat') out.cat = v;
      else if (k === 'chain') out.chain = v;
      else if (k === 'watchlist') out.watchlist = v === '1';
      else if (k === 'min') out.min = parseFloat(v) || 0;
      else if (k === 'sort') out.sort = v;
      else if (k === 'dir') out.dir = v === 'desc' ? 'desc' : 'asc';
      else if (k === 'detail') out.detail = v;
    });
    return out;
  }
  function writeHash(s) {
    var parts = [];
    if (s.view !== 'board') parts.push('view=' + s.view);
    if (s.q) parts.push('q=' + encodeURIComponent(s.q));
    if (s.cat) parts.push('cat=' + encodeURIComponent(s.cat));
    if (s.chain) parts.push('chain=' + encodeURIComponent(s.chain));
    if (s.watchlist) parts.push('watchlist=1');
    if (s.min) parts.push('min=' + s.min);
    if (s.sort !== 'rank') parts.push('sort=' + s.sort);
    if (s.dir !== 'asc') parts.push('dir=' + s.dir);
    if (s.detail) parts.push('detail=' + encodeURIComponent(s.detail));
    var next = parts.length ? '#' + parts.join('&') : '#';
    if (location.hash !== next) history.replaceState(null, '', next);
  }

  var watchlist = {};
  R.rows.forEach(function (r) { watchlist[r.slug] = !!r.on_watchlist; });

  function farmOneLiner(step) {
    var cut = step.indexOf(' Cost:');
    return cut > 0 ? step.slice(0, cut) : step;
  }

  function filteredRows(s) {
    var q = s.q.trim().toLowerCase();
    var rows = R.rows.filter(function (r) {
      if (s.watchlist && !watchlist[r.slug]) return false;
      if (s.cat && r.category !== s.cat) return false;
      if (s.chain && r.chains.indexOf(s.chain) < 0) return false;
      if (s.min && r.tvl_usd < s.min) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = s.sort;
    var dir = s.dir === 'desc' ? -1 : 1;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
      else if (key === 'implied') { va = a.implied_value_usd; vb = b.implied_value_usd; }
      else if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'change') { va = a.change_7d == null ? -9999 : a.change_7d; vb = b.change_7d == null ? -9999 : b.change_7d; }
      else if (key === 'age') { va = a.age_days == null ? -1 : a.age_days; vb = b.age_days == null ? -1 : b.age_days; }
      else { va = a.rank; vb = b.rank; }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.rank - b.rank;
    });
    return rows;
  }

  function sortArrow(s, key) {
    if (s.sort !== key) return '';
    return s.dir === 'asc' ? ' ▲' : ' ▼';
  }

  function signed(n) {
    return (n < 0 ? ' − ' : ' + ') + Math.abs(n);
  }

  function renderBoard(s) {
    var cats = [];
    var chains = [];
    R.rows.forEach(function (r) {
      if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
      r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
    });
    cats.sort();
    chains.sort();
    var rows = filteredRows(s);
    var html = '<div class="controls" role="search">'
      + '<input type="search" id="q" placeholder="Search a protocol…" value="' + esc(s.q) + '" aria-label="Search protocols">'
      + '<select id="cat" aria-label="Category"><option value="">All categories</option>'
      + cats.map(function (c) { return '<option' + (s.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('')
      + '</select>'
      + '<select id="chain" aria-label="Chain"><option value="">All chains</option>'
      + chains.map(function (c) { return '<option' + (s.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('')
      + '</select>'
      + '<select id="min" aria-label="Minimum TVL">'
      + [[0, 'Any TVL'], [5e7, 'TVL $50M+'], [1e8, 'TVL $100M+'], [1e9, 'TVL $1B+']].map(function (o) {
          return '<option value="' + o[0] + '"' + (s.min === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('')
      + '</select>'
      + '<label><input type="checkbox" id="watchlist"' + (s.watchlist ? ' checked' : '') + '> Watchlist only</label>'
      + '<span class="count">' + rows.length + ' of ' + R.rows.length + ' protocols</span>'
      + '</div>';
    if (!rows.length) {
      html += '<div class="empty">No protocol matches these filters. Clear the search or widen the category.</div>';
      main.innerHTML = html;
      bindControls(s);
      return;
    }
    html += '<table class="board"><thead><tr>'
      + '<th class="sortable num" data-sort="rank">Rank' + sortArrow(s, 'rank') + '</th>'
      + '<th class="sortable" data-sort="name">Protocol' + sortArrow(s, 'name') + '</th>'
      + '<th class="sortable num" data-sort="implied">Implied value' + sortArrow(s, 'implied') + '</th>'
      + '<th class="sortable num" data-sort="tvl">TVL' + sortArrow(s, 'tvl') + '</th>'
      + '<th class="sortable num" data-sort="change">7d' + sortArrow(s, 'change') + '</th>'
      + '<th class="sortable num" data-sort="age">Listed' + sortArrow(s, 'age') + '</th>'
      + '<th>Farm in one line</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var chg = r.change_7d == null ? '<span>—</span>' : '<span class="' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</span>';
      html += '<tr data-slug="' + esc(r.slug) + '"' + (s.detail === r.slug ? ' class="open"' : '') + '>'
        + '<td class="num rank">' + r.rank + '</td>'
        + '<td><span class="name">' + esc(r.name) + '</span>' + (watchlist[r.slug] ? '<span class="badge">WATCHLIST</span>' : '')
        + '<span class="sub">' + esc(r.category || 'No category') + ' · ' + esc(chainsText(r.chains)) + '</span></td>'
        + '<td class="num">' + money(r.implied_value_usd) + '</td>'
        + '<td class="num">' + money(r.tvl_usd) + '</td>'
        + '<td class="num">' + chg + '</td>'
        + '<td class="num">' + ageText(r.age_days) + '</td>'
        + '<td class="farm">' + esc(farmOneLiner(r.farm_steps[1] || '')) + '</td></tr>';
    });
    html += '</tbody></table>';
    main.innerHTML = html;
    bindControls(s);
    main.querySelectorAll('th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (s.sort === key) s.dir = s.dir === 'asc' ? 'desc' : 'asc';
        else { s.sort = key; s.dir = key === 'rank' ? 'asc' : 'desc'; }
        render(false, s);
      });
    });
    main.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.addEventListener('click', function () {
        s.detail = tr.getAttribute('data-slug');
        render(false, s);
      });
    });
  }

  function bindControls(s) {
    var q = document.getElementById('q');
    var cat = document.getElementById('cat');
    var chain = document.getElementById('chain');
    var min = document.getElementById('min');
    var wl = document.getElementById('watchlist');
    if (q) q.addEventListener('input', function () { s.q = q.value; s.detail = ''; render(true, s); });
    if (cat) cat.addEventListener('change', function () { s.cat = cat.value; s.detail = ''; render(false, s); });
    if (chain) chain.addEventListener('change', function () { s.chain = chain.value; s.detail = ''; render(false, s); });
    if (min) min.addEventListener('change', function () { s.min = parseFloat(min.value) || 0; s.detail = ''; render(false, s); });
    if (wl) wl.addEventListener('change', function () { s.watchlist = wl.checked; s.detail = ''; render(false, s); });
  }

  function renderLive() {
    var html = '<div class="note"><b>Already trading — not ranked.</b> These protocols record a token, so the '
      + 'board does not rank them. Their market caps are the market\u2019s own values, shown here for comparison: '
      + 'the fitted model was trained on protocols like these.</div>'
      + '<table class="board" style="margin-top:14px"><thead><tr><th>Protocol</th><th class="num">Market cap</th>'
      + '<th class="num">TVL</th><th class="num">7d</th></tr></thead><tbody>';
    R.live.forEach(function (p) {
      var chg = p.change_7d == null ? '—' : '<span class="' + (p.change_7d >= 0 ? 'up' : 'down') + '">' + pct(p.change_7d) + '</span>';
      html += '<tr><td><span class="name">' + esc(p.name) + '</span><span class="sub">' + esc(p.category || 'No category')
        + ' · ' + esc(chainsText(p.chains)) + '</span></td>'
        + '<td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + money(p.tvl_usd) + '</td>'
        + '<td class="num">' + chg + '</td></tr>';
    });
    html += '</tbody></table>';
    main.innerHTML = html;
    main.querySelectorAll('tbody tr').forEach(function (tr) { tr.style.cursor = 'default'; });
  }

  function renderModel() {
    var m = R.model;
    var v = R.validation;
    var html = '<div class="method"><h2>How the implied value is fitted</h2>'
      + '<p>Implied value is the entry\u2019s own claim, fitted from the snapshot itself — never a list of '
      + 'names, and never a prediction of whether or when a token is issued. The program fits this '
      + 'regression, every run, on the protocols whose tokens already trade:</p>'
      + '<p><code>log10(market cap) = ' + m.intercept + signed(m.tvl_coef) + ' × log10(TVL)' + signed(m.age_coef)
      + ' × log10(age in days + ' + m.age_offset_days + ')</code></p>'
      + '<p>Then a bounded momentum tilt: <code>× (1 + clamp(7-day TVL change, '
      + m.growth_floor + '%, ' + m.growth_cap + '%) / 100 × ' + m.growth_weight + ')</code>. '
      + 'A protocol whose listing date the snapshot does not carry is scored at the median age of the '
      + 'dated protocols (' + m.median_age_days + ' days).</p>'
      + '<h3>Fitted on</h3><p>' + m.train_n + ' live-token protocols with a positive market cap, excluding '
      + m.train_excluded_wrapped + ' wrapped, staked, bridged, versioned or exchange products; '
      + m.train_excluded_no_mcap + ' protocols that record a token carry no market cap in the snapshot and '
      + m.train_excluded_zero_mcap + ' record a zero market cap, so neither group can train the fit. '
      + 'Residual spread σ = ' + m.sigma_log10 + ' in log10. t-statistics: intercept ' + m.t_stats.intercept
      + ', TVL ' + m.t_stats.tvl + ', age ' + m.t_stats.age + '.</p>'
      + '<p>TVL is the only predictor with a clearly measurable link to market cap. The fitted age '
      + 'coefficient is small and not significant at the usual level, and a fit that also included '
      + '7-day growth found its coefficient indistinguishable from zero — so growth enters only as the '
      + 'bounded tilt above, and the board\u2019s implied values carry about threefold uncertainty. Read the '
      + 'rank, not the dollars.</p>'
      + '<h3>Held-out validation — the model refitted inside every fold</h3>'
      + '<table><thead><tr><th>Check</th><th class="num">Protocols</th><th class="num">Median error</th>'
      + '<th class="num">Within 2×</th><th class="num">Within 3×</th></tr></thead><tbody>'
      + '<tr><td>Leave-one-out</td><td class="num">' + v.leave_one_out.n + '</td><td class="num">×' + v.leave_one_out.median_factor
      + '</td><td class="num">' + Math.round(v.leave_one_out.within_2x * 100) + '%</td><td class="num">'
      + Math.round(v.leave_one_out.within_3x * 100) + '%</td></tr>'
      + '<tr><td>Walk-forward (train on the ' + v.walk_forward_train_n + ' listed earliest, test on the latest '
      + v.walk_forward.n + ')</td><td class="num">' + v.walk_forward.n + '</td><td class="num">×' + v.walk_forward.median_factor
      + '</td><td class="num">' + Math.round(v.walk_forward.within_2x * 100) + '%</td><td class="num">'
      + Math.round(v.walk_forward.within_3x * 100) + '%</td></tr>'
      + '</tbody></table>'
      + '<p>The walk-forward test set is small and its protocols are the newest listings, which run lower '
      + 'against the fitted line — the honest read is that a new listing\u2019s market cap is the hardest '
      + 'to call, and the leave-one-out figure is the steadier one.</p>'
      + '<h3>What the board covers, and what it sets aside</h3>'
      + '<p>' + R.board_size + ' rows: all ' + R.watchlist_size + ' watchlist protocols plus ' + R.early_size
      + ' more pre-token protocols below the watchlist floor that pass the same exclusion rule. '
      + R.excluded_pre_token + ' protocols that record no token were set aside as wrapped, staked, bridged, '
      + 'versioned or exchange products — a wrapped or staked product of a token that already trades is '
      + 'not a token that does not exist yet. ' + R.excluded_live + ' protocols record a token; the Live '
      + 'tokens view shows the ' + R.live_size + ' largest of them by market cap.</p>'
      + '<p>Every row says “records no token”, never “has no token”: the snapshot is DefiLlama\u2019s record, '
      + 'not proof, and a protocol on the board may still have a token its record does not carry.</p>'
      + '</div>';
    main.innerHTML = html;
  }

  function renderDetail(s) {
    var r = null;
    R.rows.forEach(function (row) { if (row.slug === s.detail) r = row; });
    if (!r) { detailEl.hidden = true; detailEl.innerHTML = ''; return; }
    var base = Math.pow(10, r.fitted_log10);
    var html = '<button type="button" class="close" id="closeDetail">Close ✕</button>'
      + '<h2>' + esc(r.name) + '</h2>'
      + '<p class="meta">Rank ' + r.rank + ' · ' + esc(r.category || 'No category') + ' · ' + esc(chainsText(r.chains))
      + (watchlist[r.slug] ? ' · <span class="badge">WATCHLIST</span>' : '') + '</p>'
      + '<dl class="kv">'
      + '<div><dt>Implied value</dt><dd>' + moneyFull(r.implied_value_usd) + '<small>fitted base ' + money(base) + ' × growth ' + r.growth_multiplier.toFixed(2) + '</small></dd></div>'
      + '<div><dt>TVL</dt><dd>' + moneyFull(r.tvl_usd) + '<small>7-day change ' + pct(r.change_7d) + '</small></dd></div>'
      + '<div><dt>Listed</dt><dd>' + (r.listed_at || 'not recorded') + '<small>' + (r.age_days == null ? 'age unknown — scored at the median age' : ageText(r.age_days) + ' on the snapshot') + '</small></dd></div>'
      + '<div><dt>Token</dt><dd>Records no token<small>DefiLlama carries no market cap, CoinGecko id or symbol</small></dd></div>'
      + '</dl>'
      + '<h3>How the value is built</h3>'
      + '<p class="note">log10(market cap) = ' + R.model.intercept + signed(R.model.tvl_coef) + ' × log10(TVL)'
      + signed(R.model.age_coef) + ' × log10(age + ' + R.model.age_offset_days + '). This protocol\u2019s fitted log10 is '
      + r.fitted_log10 + ', so its fitted base is ' + money(base) + '; the 7-day tilt of ×' + r.growth_multiplier.toFixed(2)
      + ' gives ' + moneyFull(r.implied_value_usd) + '. The model\u2019s leave-one-out median error is ×'
      + R.validation.leave_one_out.median_factor + ' — treat the dollars as an order of magnitude.</p>'
      + '<h3>Farm plan — six steps, costed</h3><ol class="steps">'
      + r.farm_steps.map(function (step) { return '<li>' + esc(step) + '</li>'; }).join('')
      + '</ol>'
      + '<h3>Before you farm</h3>'
      + '<p class="note">A board rank is not a promise of a token, a date, or an airdrop. Farm only with funds '
      + 'you can leave in place for weeks, never pay anyone to claim for you, and check the protocol\u2019s '
      + 'own pages before you deposit — the snapshot is a single day\u2019s record.</p>';
    detailEl.innerHTML = html;
    detailEl.hidden = false;
    document.getElementById('closeDetail').addEventListener('click', function () {
      s.detail = '';
      render(false, s);
    });
  }

  function render(keepFocus, state) {
    var s = state || parseHash();
    document.querySelectorAll('#views button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === s.view);
    });
    if (s.view === 'live') renderLive();
    else if (s.view === 'model') renderModel();
    else renderBoard(s);
    renderDetail(s);
    writeHash(s);
    if (keepFocus) {
      var q = document.getElementById('q');
      if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    }
  }

  asofEl.textContent = 'Snapshot ' + R.as_of + ' · ' + R.rows.length + ' protocols ranked · ' + R.live.length + ' live tokens set aside';
  footEl.innerHTML = '<p>Source: ' + esc(R.source) + '. Floor for the watchlist: ' + moneyFull(R.floor_usd) + ' of TVL.</p>'
    + '<p>Implied value is this entry\u2019s own claim, fitted from the snapshot. It does not predict whether or when a token is issued. '
    + 'Farm plans are starting points, not advice; every step names its cost and its time.</p>';
  document.querySelectorAll('#views button').forEach(function (b) {
    b.addEventListener('click', function () {
      var s = parseHash();
      s.view = b.getAttribute('data-view');
      s.detail = '';
      history.replaceState(null, '', '#view=' + s.view);
      render();
    });
  });
  window.addEventListener('hashchange', function () { render(); });
  render();
})();
