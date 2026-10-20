// ── Prospect Watch tab (inside Search Results) ────────────────────────────────
// Every recent-EV prospect's first Bowman auto, pooled from the two built-in searches (BIN hourly, Auctions nightly).
// Reads the same 7-day archives and uses the same card renderer and Mark Seen / Mark All Seen as any other search result.
const PW_KEYS = { bin: 'prospect_watch_bin_digest', auction: 'prospect_watch_auction_digest' };
let pw = { items: [], settings: { enabled: true, days: 30, dealPct: 40 }, tier: '', type: 'all', dealsOnly: false, sort: 'newest', text: '', showAll: false, showSettings: false };

const pwH = () => ({ 'Content-Type': 'application/json', 'X-App-Key': APP_KEY });
const pwEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

async function pwFetchItems() {
  const get = k => fetch(`${WORKER}/player-digest-json?key=${PW_KEYS[k]}_archive`).then(r => r.json()).catch(() => ({ items: [] }));
  const [b, a] = await Promise.all([get('bin'), get('auction')]);
  const tag = (d, k) => (d.items || []).map(i => ({ ...i, _k: PW_KEYS[k] }));
  return pwEnrich([...tag(b, 'bin'), ...tag(a, 'auction')]);
}
// Player, Buy Score and estimated value for each listing (the same lookups the other result pages use)
function pwEnrich(items) {
  for (const i of items) {
    const p = resolveItemPlayer(i.title);
    i._p = p || null;
    i._bs = p && p.buy_rating != null ? +p.buy_rating : null;
    i._est = listingEstInfo(i.title, i.price);
  }
  return items;
}
const pwIsDeal = i => i.type === 'BIN' && i._est && i._est.pct !== null && i._est.pct <= -pw.settings.dealPct;
const pwTierOk = (i, tier) => !tier || (i._bs !== null && i._bs >= (tier === '5' ? 5 : 4));

// The entry tile pinned at the top of Search Results
function pwEntryTileHtml() {
  return `<div class="sr-tile-card pw-entry"><div class="sr-tile-row"><div class="sr-tile-main" id="pw-entry-main"><div class="sr-tile-name">🎯 Prospect Watch</div></div><span id="pw-entry-badge" class="sr-count-badge"></span></div></div>`;
}
async function pwWireEntry() {
  const main = document.getElementById('pw-entry-main');
  if (main) main.onclick = () => { srUIState.scrollY = window.scrollY; showProspectWatch(); };
  try {
    const counts = await Promise.all(Object.values(PW_KEYS).map(k => fetch(`${WORKER}/player-digest-json?key=${k}_archive`).then(r => r.json()).then(d => (d.items || []).filter(i => !i.seen).length).catch(() => 0)));
    const n = counts[0] + counts[1], badge = document.getElementById('pw-entry-badge');
    if (badge && n > 0) { badge.textContent = n > 999 ? '1K+' : String(n); badge.style.display = 'inline-flex'; }
  } catch (e) {}
}

function pwView() {
  const ft = pw.text ? foldText(pw.text) : '';
  return pw.items.filter(i => pwTierOk(i, pw.tier)
    && (pw.type === 'all' || (pw.type === 'bin' ? i.type === 'BIN' : i.type === 'Auction'))
    && (!pw.dealsOnly || pwIsDeal(i))
    && (!ft || foldText(i.title).includes(ft) || (i._p && foldText(i._p.name).includes(ft))));
}

function pwTilesHtml() {
  const unseen = pw.items.filter(i => !i.seen);
  const tile = (tier, label) => {
    const set = unseen.filter(i => pwTierOk(i, tier));
    const deals = set.filter(pwIsDeal).sort((a, b) => a._est.pct - b._est.pct);
    const best = deals[0];
    return `<button class="pw-tile${pw.tier === tier ? ' on' : ''}" data-tier="${tier}">
      <div class="pw-tile-label">${label}</div>
      <div class="pw-tile-n">${set.length}<span> new</span></div>
      <div class="pw-tile-sub">${deals.length} BIN deal${deals.length === 1 ? '' : 's'} ${pw.settings.dealPct}%+ under</div>
      <div class="pw-tile-best">${best ? `${pwEsc(best._p.name)} ${best._est.pct}% · $${pwEsc(best.price)}` : '&nbsp;'}</div></button>`;
  };
  return tile('5', 'Buy Score 5') + tile('4', 'Buy Score 4+') + tile('', 'All players');
}

function pwRender() {
  const tiles = document.getElementById('pw-tiles');
  if (tiles) {
    tiles.innerHTML = pwTilesHtml();
    tiles.querySelectorAll('.pw-tile').forEach(b => b.onclick = () => { pw.tier = pw.tier === b.dataset.tier ? '' : b.dataset.tier; pwRender(); });
  }
  const view = pwView();
  updateDigestCount(view, pw.showAll);
  renderDigestItems(view, pw.sort, '', 'pw', pw.showAll);
  document.querySelectorAll('#pw-type-chips .sr-chip-btn').forEach(b => b.classList.toggle('on', b.dataset.val === pw.type));
  document.querySelectorAll('#pw-sort-chips .sr-chip-btn').forEach(b => b.classList.toggle('on', b.dataset.val === pw.sort));
  document.getElementById('pw-deals-btn')?.classList.toggle('on', pw.dealsOnly);
  const sa = document.getElementById('sr-show-all-btn');
  if (sa) { sa.classList.toggle('on', pw.showAll); sa.textContent = pw.showAll ? 'Unseen Only' : 'Show All'; }
}

// Mark listings seen: each one in its own search's archive and today's digest, like the other result pages
async function pwMark(items) {
  const byKey = {};
  items.forEach(i => (byKey[i._k] = byKey[i._k] || []).push(i.url));
  const posts = Object.entries(byKey).flatMap(([k, urls]) => [k + '_archive', k].map(key =>
    fetch(`${WORKER}/mark-seen-urls`, { method: 'POST', headers: pwH(), body: JSON.stringify({ key, urls }) })));
  const res = await Promise.all(posts);
  if (res.some(r => !r.ok)) throw new Error('mark-seen failed');
  const done = new Set(items.map(i => i.url));
  pw.items.forEach(i => { if (done.has(i.url)) i.seen = true; });
}

async function pwLoadSettings() {
  try { const d = await (await fetch(`${WORKER}/prospect-watch-settings`)).json(); if (d.settings) pw.settings = d.settings; } catch (e) {}
}

async function showProspectWatch() {
  if (srResumeCleanup) srResumeCleanup();
  srClearResume();
  srSeller = { sel: new Set(), text: '' };
  pw = { ...pw, items: [], tier: '', type: 'all', dealsOnly: false, sort: 'newest', text: '', showAll: false, showSettings: false };
  const root = document.getElementById('sr-root');
  root.innerHTML = `
    <div class="sr-wrap">
      <div class="sr-digest-header">
        <button class="sr-back-btn" id="sr-back-btn">← Back</button>
        <div class="sr-digest-title">🎯 Prospect Watch</div>
        <div class="sr-digest-actions">
          <button class="sr-mark-past-btn" id="sr-mark-past-btn" title="Mark everything you've scrolled past as seen">Mark Seen</button>
          <button class="sr-mark-seen-btn" id="sr-mark-seen-btn">Mark All Seen</button>
        </div>
      </div>
      <div class="pw-tiles" id="pw-tiles"></div>
      <div class="sr-digest-controls">
        <input class="sr-search-input" id="pw-search" placeholder="Search by player or title...">
        <div class="sr-chip-row" id="pw-type-chips">
          <button class="sr-chip-btn on" data-val="all">All</button>
          <button class="sr-chip-btn" data-val="bin">BIN</button>
          <button class="sr-chip-btn" data-val="auction">Auctions</button>
          <button class="sr-chip-btn" id="pw-deals-btn">Deals only</button>
        </div>
        <div class="sr-chip-row" id="pw-sort-chips">
          <button class="sr-chip-btn on" data-val="newest">Newest</button>
          <button class="sr-chip-btn" data-val="deal">Best deal</button>
          <button class="sr-chip-btn" data-val="ending">Ending soon</button>
        </div>
        <div class="sr-chip-row">
          <button class="sr-chip-btn" id="sr-show-all-btn">Show All</button>
          <button class="sr-chip-btn" id="pw-run-btn">Run now</button>
          <button class="sr-chip-btn" id="pw-settings-btn">⚙ Settings</button>
        </div>
        <div id="pw-settings" class="pw-settings" style="display:none"></div>
      </div>
      <div class="sr-digest-count" id="sr-digest-count">—</div>
      <div id="sr-digest-list"><div class="sr-loading">Loading...</div></div>
    </div>`;

  document.getElementById('sr-back-btn').onclick = async () => { await initSearchResults(); window.scrollTo(0, srUIState.scrollY); };
  document.getElementById('pw-search').oninput = e => { pw.text = e.target.value.trim(); pwRender(); };
  document.querySelectorAll('#pw-type-chips [data-val]').forEach(b => b.onclick = () => { pw.type = b.dataset.val; pwRender(); });
  document.getElementById('pw-deals-btn').onclick = () => { pw.dealsOnly = !pw.dealsOnly; pwRender(); };
  document.querySelectorAll('#pw-sort-chips .sr-chip-btn').forEach(b => b.onclick = () => { pw.sort = b.dataset.val; pwRender(); });
  document.getElementById('sr-show-all-btn').onclick = () => { pw.showAll = !pw.showAll; pwRender(); };

  document.getElementById('sr-mark-seen-btn').onclick = async (e) => {
    const btn = e.currentTarget, list = pwView().filter(i => !i.seen);
    if (!list.length) return;
    btn.disabled = true;
    try { await pwMark(list); pwRender(); } catch (err) { btn.textContent = 'Failed — try again'; setTimeout(() => { btn.textContent = 'Mark All Seen'; }, 1500); }
    btn.disabled = false;
  };
  document.getElementById('sr-mark-past-btn').onclick = async (e) => {
    const btn = e.currentTarget, flash = t => { btn.textContent = t; setTimeout(() => { btn.textContent = 'Mark Seen'; }, 1400); };
    const past = srGetScrolledPast();
    if (!past.length) { flash('Nothing above yet'); return; }
    const line = srScrolledPastLine();
    const anchorCard = [...document.querySelectorAll('#sr-digest-list .sr-listing-card')].find(c => c.getBoundingClientRect().bottom > line + 1);
    const anchorUrl = anchorCard ? srRenderedItems[+anchorCard.dataset.i]?.url : null;
    const anchorOffset = anchorCard ? anchorCard.getBoundingClientRect().top - line : 0;
    btn.disabled = true;
    try { await pwMark(past); } catch (err) { btn.disabled = false; flash('Failed — try again'); return; }
    btn.disabled = false;
    pwRender();
    if (!pw.showAll && anchorUrl) {
      const idx = srRenderedItems.findIndex(i => i.url === anchorUrl);
      const card = idx >= 0 ? document.querySelector(`#sr-digest-list .sr-listing-card[data-i="${idx}"]`) : null;
      if (card) window.scrollBy(0, card.getBoundingClientRect().top - srScrolledPastLine() - anchorOffset);
    }
    flash(`✓ ${past.length} marked seen`);
  };

  // Run now: pull everything live for both searches, then reload (first-time fill, or a refresh between cron runs)
  document.getElementById('pw-run-btn').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Running…';
    try {
      await Promise.all(Object.values(PW_KEYS).map(k => fetch(`${WORKER}/run-search`, { method: 'POST', headers: pwH(), body: JSON.stringify({ digestKey: k }) })));
      pw.items = await pwFetchItems(); pwRender();
    } catch (err) {}
    btn.disabled = false; btn.textContent = 'Run now';
  };

  const panel = document.getElementById('pw-settings');
  const drawSettings = () => {
    const s = pw.settings;
    panel.innerHTML = `
      <label class="pw-set-row"><input type="checkbox" id="pw-set-on" ${s.enabled ? 'checked' : ''}> Watch is on</label>
      <label class="pw-set-row">A player expires after <input class="sr-input" id="pw-set-days" type="number" min="1" max="365" value="${s.days}"> days with no new Expected Value</label>
      <label class="pw-set-row">A BIN is a deal when it is <input class="sr-input" id="pw-set-deal" type="number" min="1" max="95" value="${s.dealPct}"> % or more under its estimate</label>
      <button class="sr-chip-btn on" id="pw-set-save">Save</button> <span id="pw-set-msg" style="font-size:12px;color:var(--tx3)"></span>`;
    document.getElementById('pw-set-save').onclick = async () => {
      const msg = document.getElementById('pw-set-msg'); msg.textContent = 'Saving…';
      try {
        const r = await fetch(`${WORKER}/prospect-watch-settings`, { method: 'POST', headers: pwH(), body: JSON.stringify({
          enabled: document.getElementById('pw-set-on').checked, days: document.getElementById('pw-set-days').value, dealPct: document.getElementById('pw-set-deal').value }) });
        const d = await r.json(); if (!d.settings) throw new Error();
        pw.settings = d.settings; msg.textContent = 'Saved. The player list changes on the next run.'; pwRender();
      } catch (err) { msg.textContent = 'Could not save'; }
    };
  };
  document.getElementById('pw-settings-btn').onclick = () => { pw.showSettings = !pw.showSettings; panel.style.display = pw.showSettings ? '' : 'none'; if (pw.showSettings) drawSettings(); };

  if (typeof phLoad === 'function' && !phData) { try { await phLoad(); } catch (e) {} }
  await pwLoadSettings();
  try {
    pw.items = await pwFetchItems();
    pwRender();
    if (!pw.items.length) document.getElementById('sr-digest-list').innerHTML = '<div class="sr-empty">Nothing here yet. The BIN search runs every hour and auctions every night. Tap Run now to load what is live.</div>';
  } catch (e) { document.getElementById('sr-digest-list').innerHTML = '<div class="sr-empty">Failed to load listings.</div>'; }
}
