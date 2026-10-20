// ── Sort chips ────────────────────────────────────────────────────────────────
function renderSortChips() {
  const opts = SORT_OPTS[tab];
  const el = document.getElementById('sortchips');
  if(!opts){ el.innerHTML=''; return; }
  el.innerHTML = opts.map(o=>
    `<button class="schip${sortBy===o.k||(!opts.find(x=>x.k===sortBy)&&o.k==='default')?' on':''}" data-s="${o.k}">${o.l}</button>`
  ).join('');
}

// ── Main render ───────────────────────────────────────────────────────────────
function render() {
  if(section==='searchbuilder') return;
  const isInbox=tab==='inbox', isPosts=tab==='posts';
  document.getElementById('hdr').style.display = isInbox ? 'none' : '';   // no search on the Inbox
  document.getElementById('search').placeholder = isPosts ? 'Search posts or players...' : tab==='port' ? 'Search your players...' : 'Search player or team...';
  if(isInbox){ renderProspectInbox(); return; }
  if(isPosts){ renderSortChips(); renderPostsView(); return; }
  if(tab==='port'){
    renderSortChips();
    // estimated card values need the Parallel Multiplier sheet (a small, quick fetch)
    loadParallelMultipliers().then(()=>{ if(section==='prospects' && tab==='port') renderProspectPortfolio(); });
    return;
  }
  renderSortChips(); renderProspectHome();
}

// ── History charts ────────────────────────────────────────────────────────────
// ── Modal sections ────────────────────────────────────────────────────────────
function modalCards(name) {
  const cs = getCardStats(name);
  const {owned, sold, totalInvested, totalNetProfit, totalSoldFor} = cs;
  if(!owned.length && !sold.length) return '';

  const roi = totalSoldFor>0 ? ((totalNetProfit/totalSoldFor)*100) : null;

  const summary = `<div class="srow" style="margin-bottom:9px">
    <div class="srow-t">My Cards</div>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;text-align:center;margin-bottom:10px">
      <div><div class="sc-l">Owned</div><div class="sc-v">${owned.length}</div></div>
      <div><div class="sc-l">Invested</div><div class="sc-v">$${totalInvested.toFixed(0)}</div></div>
      <div><div class="sc-l">Sold</div><div class="sc-v">${sold.length}</div></div>
      <div><div class="sc-l">Net Profit</div><div class="sc-v"><span class="${totalNetProfit>=0?'up':'dn'}">${totalNetProfit>=0?'+':''}$${Math.abs(totalNetProfit).toFixed(2)}</span></div></div>
      <div><div class="sc-l">ROI on Sold</div><div class="sc-v">${roi!==null?`<span class="${roi>=0?'up':'dn'}">${roi>=0?'+':''}${roi.toFixed(1)}%</span>`:'—'}</div></div>
    </div>
    <div style="display:flex;gap:8px">
      ${owned.length?`<button onclick="showCardsSubview('owned','${name}')" style="flex:1;padding:8px;border:.5px solid var(--bdr2);border-radius:8px;background:var(--acc-bg);color:var(--acc);font-size:13px;font-weight:500;cursor:pointer;font-family:inherit">Owned (${owned.length})</button>`:''}
      ${sold.length?`<button onclick="showCardsSubview('sold','${name}')" style="flex:1;padding:8px;border:.5px solid var(--bdr2);border-radius:8px;background:var(--b4-bg);color:var(--b4-tx);font-size:13px;font-weight:500;cursor:pointer;font-family:inherit">Sold (${sold.length})</button>`:''}
    </div>
  </div>`;

  return summary;
}

async function showCardsSubview(type, name) {
  const cs = getCardStats(name);
  const {owned, sold} = cs;
  const prow = (typeof phData !== 'undefined' && phData || []).find(p => normName(p.name) === normName(name));
  const currentPrice = prow && prow.price_cents ? prow.price_cents / 100 : 0;
  if (prow && !phHist[prow.prospect_id]) { phHistAsked.delete(prow.prospect_id); await phLoadHist([prow.prospect_id]); }
  const histPts = prow ? (phHist[prow.prospect_id] || []).map(([d, c]) => ({ ts: parseDate(d), price: c / 100 })).filter(x => x.ts && x.price) : [];
  const items = type==='owned' ? owned : sold;

  const rows = items.map(c=>{
    if(type==='owned'){
      const cardTs = parseDate(c.datePurchased||c.transactionDate);
      const cardPriceHistory = histPts;
      const mult = getParallelMultiplier(c.fullCard, c.player);
      let pctHtml='';
      let evHtml='';
      if(mult!==null){
        const cost = safeNum(c.purchasePrice);
        if(currentPrice>0){
          const ev = currentPrice*mult;
          evHtml=`<div class="ct-stat"><div class="ct-l">Expected Value</div><div class="ct-v">${fmtMoney(ev)}</div></div>`;
          if(cost>0){
            const pct=(ev-cost)/cost*100;
            pctHtml=`<div class="ct-stat"><div class="ct-l">Since buy</div><div class="ct-v"><span class="${pct>=0?'up':'dn'}">${pct>=0?'+':''}${pct.toFixed(0)}%</span></div></div>`;
          }
        }
      } else if(currentPrice>0 && cardTs && cardPriceHistory.length){
        const closest=cardPriceHistory.reduce((a,b)=>Math.abs(b.ts-cardTs)<Math.abs(a.ts-cardTs)?b:a);
        if(closest.price){
          const pct=(currentPrice-closest.price)/closest.price*100;
          pctHtml=`<div class="ct-stat"><div class="ct-l">Since buy</div><div class="ct-v"><span class="${pct>=0?'up':'dn'}">${pct>=0?'+':''}${pct.toFixed(0)}%</span></div></div>`;
          const cost = safeNum(c.purchasePrice);
          if(cost>0){
            const ev = cost*(1+pct/100);
            evHtml=`<div class="ct-stat"><div class="ct-l">Expected Value</div><div class="ct-v">${fmtMoney(ev)}</div></div>`;
          }
        }
      }
      return `<div class="ct-entry owned" style="cursor:pointer" onclick="ctOpenOwned('${String(c.itemId||'').replace(/'/g,"\\'")}')">
        <div class="ct-name">${c.fullCard||'—'}</div>
        <div class="ct-row">
          <div class="ct-stat"><div class="ct-l">Purchased</div><div class="ct-v">${fmtShortDate(c.datePurchased||c.transactionDate)}</div></div>
          <div class="ct-stat"><div class="ct-l">Cost</div><div class="ct-v">${fmtMoney(c.purchasePrice)}</div></div>
          ${pctHtml}
          ${evHtml}
        </div>
        ${c.serialNo?`<div class="ct-serial">/${c.serialNo}</div>`:''}
      </div>`;
    } else {
      const p=safeNum(c.netProfit,true);
      return `<div class="ct-entry sold">
        <div class="ct-name">${c.fullCard||'—'}</div>
        <div class="ct-row">
          <div class="ct-stat"><div class="ct-l">Sold</div><div class="ct-v">${fmtShortDate(c.transactionDate)}</div></div>
          <div class="ct-stat"><div class="ct-l">Cost</div><div class="ct-v">${fmtMoney(c.purchasePrice)}</div></div>
          <div class="ct-stat"><div class="ct-l">Sold for</div><div class="ct-v">${fmtMoney(c.salePrice)}</div></div>
          <div class="ct-stat"><div class="ct-l">Net</div><div class="ct-v"><span class="${p>=0?'up':'dn'}">${p>=0?'+':''}$${Math.abs(p).toFixed(2)}</span></div></div>
        </div>
        ${c.serialNo?`<div class="ct-serial">/${c.serialNo}</div>`:''}
      </div>`;
    }
  }).join('');

  document.getElementById('mcontent').innerHTML=`
    <div style="position:sticky;top:0;background:var(--bg);padding:10px 0 8px;z-index:10;margin-bottom:6px">
      <button onclick="document.getElementById('mcontent').innerHTML=_modalMainHtml"
        style="display:flex;align-items:center;gap:6px;background:none;border:none;color:var(--acc);font-size:14px;font-weight:500;cursor:pointer;font-family:inherit;padding:0">
        ← Back
      </button>
    </div>
    <div class="section-hdr">Hot Sheet History — ${name}</div>
    ${rows}`;
}
// ── Detail modal ──────────────────────────────────────────────────────────────
let _modalMainHtml = '';
let _modalCurrentPlayer = '';

function attachModalEvents() {
  document.getElementById('closebtn').onclick = () => document.getElementById('mwrap').classList.remove('on');
}

// ── Player notes (loaded when the modal opens; the startup data carries no text) ──
const PN_PAGE = 3;
let _pn = { name: '', total: 0, shown: 0 };
const pnDate = d => d ? fmtShortDate(d.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, (m, y, mo, da) => `${+mo}/${+da}/${y}`)) : '';
function pnToggleRow(label, text, dated, sub) {
  return `<div class="srow" style="padding:0;overflow:hidden;margin-bottom:9px">
    <button class="notes-toggle" onclick="const b=this.nextElementSibling;b.style.display=b.style.display==='none'?'block':'none';this.querySelector('.arr').textContent=b.style.display==='none'?'▼':'▲'">
      <span class="lbl">${label}</span><span style="font-size:10px;color:var(--tx3);margin-left:6px">${pnDate(dated)}</span><span class="arr">▼</span>
    </button>
    <div class="notes-body" style="display:none">${sub ? `<div style="font-size:10px;color:var(--tx3);margin-bottom:6px">${pibEsc(sub)}</div>` : ''}<p style="white-space:pre-wrap">${pibEsc(text)}</p></div>
  </div>`;
}
function pnItemHtml(t) {
  const stance = t.stance && t.stance !== 'none' ? ` <span class="pib-badge stance">${pibEsc(t.stance)}</span>` : '';
  return `<details style="padding:8px 0;border-top:.5px solid var(--bdr2)"><summary style="cursor:pointer;font-size:12px"><b>${pnDate(t.dated)}</b> <span style="color:var(--tx3)">${pibEsc(t.title || '')}</span>${stance}</summary>
    ${t.summary ? `<div style="font-size:13px;line-height:1.5;margin-top:6px;white-space:pre-wrap"><b>Summary</b><br>${pibEsc(t.summary)}</div>` : ''}
    ${t.analysis ? `<div style="font-size:13px;line-height:1.55;margin-top:6px;white-space:pre-wrap"><b>Note</b><br>${pibEsc(t.analysis)}</div>` : ''}</details>`;
}
async function pnFetch(name, offset) {
  const res = await fetch(`${API_BASE}/prospect-takes?name=${encodeURIComponent(name)}&offset=${offset}&limit=${PN_PAGE}`, { headers: { 'X-App-Key': APP_KEY } });
  if (!res.ok) throw new Error('notes ' + res.status);
  return res.json();
}
// keeps the Back button's saved copy of the modal in step with what is on screen
function pnSync() { const mc = document.getElementById('mcontent'); if (mc && document.getElementById('pn-box')) _modalMainHtml = mc.innerHTML; }
async function loadModalNotes(name) {
  _pn = { name, total: 0, shown: 0 };
  try {
    const d = await pnFetch(name, 0);
    const box = document.getElementById('pn-box'); if (!box || _modalCurrentPlayer !== name) return;
    _pn.total = d.total;
    const n = d.latest && d.latest.note, s = d.latest && d.latest.summary;
    box.innerHTML = (n ? pnToggleRow('Most Recent Note', n.analysis, n.dated, n.title) : '') + (s ? pnToggleRow('Most Recent Summary', s.summary, s.dated, s.title) : '') +
      (d.total ? `<button class="notes-toggle" id="pn-all" style="width:100%;padding:10px;border:.5px solid var(--bdr2);border-radius:8px;background:var(--surf);margin-bottom:9px" onclick="pnShowAll()"><span class="lbl">All notes</span><span style="float:right;color:var(--tx3)">${d.total} →</span></button><div id="pn-list"></div>` : '');
    pnSync();
  } catch (e) { const box = document.getElementById('pn-box'); if (box) { box.innerHTML = ''; pnSync(); } }
}
async function pnShowAll() {
  const btn = document.getElementById('pn-all'), list = document.getElementById('pn-list'); if (!list) return;
  if (btn) btn.disabled = true;
  try {
    const d = await pnFetch(_pn.name, _pn.shown);
    list.insertAdjacentHTML('beforeend', d.takes.map(pnItemHtml).join(''));
    _pn.shown += d.takes.length;
    const left = _pn.total - _pn.shown;
    if (btn) { btn.disabled = false; btn.innerHTML = left > 0 ? `<span class="lbl">Show ${Math.min(PN_PAGE, left)} more</span><span style="float:right;color:var(--tx3)">${left} left →</span>` : `<span class="lbl">All ${_pn.total} notes shown</span>`; if (left <= 0) btn.onclick = null; }
    pnSync();
  } catch (e) { if (btn) btn.disabled = false; }
}

// Every player tap (Prospects home, Hot Sheet, Portfolio) opens the new modal; the old one is kept below until the rest is retired.
function showDetail(p, tp) { return phShowModal(p.name); }
// ── Snipe ─────────────────────────────────────────────────────────────────────
// No confirmation popup: copy the Item ID, then go straight to Gixen.
function openSnipeModal(itemId) {
  try { navigator.clipboard.writeText(String(itemId)).catch(() => {}); } catch (e) {}
  // Same as the Card Ladder/COMC searches: from the iOS Home Screen app this leaves the in-app viewer
  // (no saved logins) for real Safari. Named tab 'gixen': a Gixen tab this app opened earlier is
  // switched to (not reloaded) instead of opening a new one.
  ctOpenExternal('https://www.gixen.com/main/home_2.php', 'gixen', true);
}

// ── Edit Name modal ────────────────────────────────────────────────────────────
function openEditNameModal(itemId, i) {
  const existing = document.getElementById('editname-modal');
  if (existing) existing.remove();

  const item = watchlistItems[i];
  const rawTitle = item.savedTitle || item.title || '';
  const safeTitle = rawTitle.replace(/&amp;/g,'&').replace(/&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');

  const modal = document.createElement('div');
  modal.id = 'editname-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div style="background:var(--surf);border-radius:14px;padding:20px;width:100%;max-width:360px">
      <div style="font-size:15px;font-weight:600;margin-bottom:10px">Edit Name</div>
      <textarea class="wl-title" id="wlt-modal-${i}" rows="4" style="width:100%;margin-bottom:12px">${safeTitle}</textarea>
      <div style="display:flex;gap:8px">
        <button onclick="copyText(document.getElementById('wlt-modal-${i}').value, this)"
          style="flex:1;padding:10px;border-radius:8px;border:.5px solid var(--bdr2);background:none;color:var(--tx2);font-size:14px;cursor:pointer;font-family:inherit">Copy</button>
        <button onclick="saveTitle('${itemId}', document.getElementById('wlt-modal-${i}').value, this)"
          style="flex:1;padding:10px;border-radius:8px;border:none;background:var(--acc);color:#fff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}


// ── Search Options modal ───────────────────────────────────────────────────────
let wlSearchCtx = null; // { text, key } for the watchlist item whose Search Options are open

function wlOpenSearch(platform) {
  if (!wlSearchCtx) return;
  document.getElementById('searchopts-modal')?.remove();
  openSearchEditor({ platform, text: wlSearchCtx.text, key: wlSearchCtx.key });
}

// Copy Name: copies the same name the searches start from, then closes the menu
function wlCopyName(btn) {
  if (!wlSearchCtx || !navigator.clipboard) return;
  navigator.clipboard.writeText(wlSearchCtx.text).then(() => {
    btn.textContent = 'Copied!';
    btn.style.background = 'var(--b5-bg)';
    btn.style.color = 'var(--b5-tx)';
    setTimeout(() => document.getElementById('searchopts-modal')?.remove(), 700);
  }).catch(() => { btn.textContent = 'Copy failed'; });
}

function openSearchOptionsModal(itemId, i) {
  const item = watchlistItems[i];
  const rawTitle = item.savedTitle || item.title || '';
  const safeTitle = rawTitle.replace(/&amp;/g,'&').replace(/&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  showSearchOptionsModal(safeTitle, 'wl:' + item.itemId);
}

// Shared by the Watchlist and Search Results cards. `key` is where the edited search text is remembered
// ('wl:<itemId>' on both pages, so an edit made on one shows up on the other).
function showSearchOptionsModal(text, key) {
  const existing = document.getElementById('searchopts-modal');
  if (existing) existing.remove();

  wlSearchCtx = { text, key };

  const modal = document.createElement('div');
  modal.id = 'searchopts-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div style="background:var(--surf);border-radius:14px;padding:20px;width:100%;max-width:320px">
      <div style="font-size:15px;font-weight:600;margin-bottom:14px">Search Options</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button onclick="wlOpenSearch('cardladder')"
          style="padding:12px;border-radius:8px;border:.5px solid var(--bdr2);background:none;color:var(--tx);font-size:14px;cursor:pointer;font-family:inherit;text-align:left">Card Ladder</button>
        <button onclick="wlOpenSearch('comc')"
          style="padding:12px;border-radius:8px;border:.5px solid var(--bdr2);background:none;color:var(--tx);font-size:14px;cursor:pointer;font-family:inherit;text-align:left">COMC</button>
        <button onclick="wlOpenSearch('ebay')"
          style="padding:12px;border-radius:8px;border:.5px solid var(--bdr2);background:none;color:var(--tx);font-size:14px;cursor:pointer;font-family:inherit;text-align:left">eBay Search</button>
        <button onclick="wlCopyName(this)"
          style="padding:12px;border-radius:8px;border:.5px solid var(--acc-bdr);background:var(--acc-bg);color:var(--acc);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;text-align:left">Copy Name</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

// ── Multi-select controls ──────────────────────────────────────────────────────
function toggleWatchlistSelectMode() {
  watchlistSelectMode = !watchlistSelectMode;
  watchlistSelected.clear();
  renderWatchlist();
}

function toggleWatchlistItemSelected(itemId, cardEl) {
  if (watchlistSelected.has(itemId)) {
    watchlistSelected.delete(itemId);
    cardEl.classList.remove('wl-selected');
  } else {
    watchlistSelected.add(itemId);
    cardEl.classList.add('wl-selected');
  }
  updateWatchlistActionBar();
}

function updateWatchlistActionBar() {
  const bar = document.getElementById('wl-action-bar');
  if (!bar) return;
  const n = watchlistSelected.size;
  bar.style.display = n > 0 ? 'flex' : 'none';
  const countEl = document.getElementById('wl-selected-count');
  if (countEl) countEl.textContent = `${n} selected`;
}

async function removeSingleFromWatchlist(itemId, btn) {
  if (!confirm('Remove this item from your watchlist?')) return;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const data = await removeFromWatch([itemId]);
    if (data.ok) {
      watchlistItems = watchlistItems.filter(item => item.itemId !== itemId);
      renderWatchlist();
    } else {
      alert(`Failed: ${data.ack || data.error || 'unknown error'}`);
      btn.disabled = false;
      btn.textContent = '✕';
    }
  } catch(e) {
    alert(`Error: ${e.message}`);
    btn.disabled = false;
    btn.textContent = '✕';
  }
}

async function removeSelectedFromWatchlist() {
  if (watchlistSelected.size === 0) return;
  const ids = Array.from(watchlistSelected);
  if (!confirm(`Remove ${ids.length} item${ids.length===1?'':'s'} from your watchlist?`)) return;

  const btn = document.getElementById('wl-remove-btn');
  btn.disabled = true;
  btn.textContent = 'Removing...';

  try {
    const data = await removeFromWatch(ids);
    if (data.ok) {
      watchlistItems = watchlistItems.filter(item => !watchlistSelected.has(item.itemId));
      watchlistSelected.clear();
      watchlistSelectMode = false;
      renderWatchlist();
    } else {
      alert(`Failed: ${data.ack || data.error || 'unknown error'}`);
      btn.disabled = false;
      btn.textContent = 'Remove Selected';
    }
  } catch(e) {
    alert(`Error: ${e.message}`);
    btn.disabled = false;
    btn.textContent = 'Remove Selected';
  }
}

// ── Watchlist render ──────────────────────────────────────────────────────────
// ── Watchlist filters (client-side only; no extra API calls) ──────────────────
let wlFilter = { auctionsOnly: false, seller: '', q: '' };

function wlDecode(s) {
  return (s || '').replace(/&amp;/g,'&').replace(/&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}
function wlEsc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function wlHasFilters() {
  return wlFilter.auctionsOnly || !!wlFilter.seller || !!wlFilter.q.trim();
}

// eBay's watchlist reports auctions as 'Auction' (older/other calls use 'Chinese' or 'AuctionWithBIN').
// Fixed-price listings ('FixedPriceItem', 'StoreInventory') are not auctions.
const WL_AUCTION_TYPES = new Set(['Auction', 'Chinese', 'AuctionWithBIN']);
function wlIsAuction(item) {
  return WL_AUCTION_TYPES.has(item.listingType);
}

// Returns [{ item, i }] where i is the item's index in watchlistItems (modals use that index).
function wlVisibleItems() {
  const words = wlFilter.q.toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  watchlistItems.forEach((item, i) => {
    if (wlFilter.auctionsOnly && !wlIsAuction(item)) return;
    if (wlFilter.seller && item.seller !== wlFilter.seller) return;
    if (words.length) {
      const hay = wlDecode(`${item.savedTitle || ''} ${item.title || ''}`).toLowerCase();
      if (!words.every(w => hay.includes(w))) return;
    }
    out.push({ item, i });
  });
  return out;
}

function wlBuildFilterBar() {
  // Items cached before the backend added these fields have no listingType key at all.
  const hasMeta = watchlistItems.some(it => 'listingType' in it);
  const counts = {};
  watchlistItems.forEach(it => { if (it.seller) counts[it.seller] = (counts[it.seller] || 0) + 1; });
  // Only sellers with 2+ saved listings, most listings first (ties alphabetical).
  const sellers = Object.keys(counts)
    .filter(s => counts[s] > 1)
    .sort((a, b) => counts[b] - counts[a] || a.toLowerCase().localeCompare(b.toLowerCase()));
  if (wlFilter.seller && !sellers.includes(wlFilter.seller)) wlFilter.seller = '';

  const bar = document.createElement('div');
  bar.id = 'wl-filters';
  bar.className = 'wl-filter-bar';
  bar.innerHTML = `
    <input id="wl-search" class="wl-search" type="search" placeholder="Search titles..." value="${wlEsc(wlFilter.q)}"
      oninput="wlSetFilter('q', this.value)" autocomplete="off" autocapitalize="off" spellcheck="false">
    ${hasMeta ? `
    <div class="wl-filter-row">
      <button class="wl-chip${wlFilter.auctionsOnly ? ' on' : ''}" onclick="wlToggleAuctions(this)">Auctions only</button>
      ${sellers.length ? `<select class="wl-select${wlFilter.seller ? ' on' : ''}" onchange="this.classList.toggle('on', !!this.value);wlSetFilter('seller', this.value)">
        <option value="">All sellers</option>
        ${sellers.map(s => `<option value="${wlEsc(s)}"${s === wlFilter.seller ? ' selected' : ''}>${wlEsc(s)} (${counts[s]})</option>`).join('')}
      </select>` : ''}
      <button id="wl-clear" class="wl-chip" onclick="wlClearFilters()"${wlHasFilters() ? '' : ' hidden'}>Clear</button>
    </div>` : `<div class="wl-filter-hint">Tap refresh to enable auction and seller filters.</div>`}
  `;
  return bar;
}

function wlSetFilter(key, val) {
  wlFilter[key] = val;
  wlRenderCards();
}
function wlToggleAuctions(btn) {
  wlFilter.auctionsOnly = !wlFilter.auctionsOnly;
  btn.classList.toggle('on', wlFilter.auctionsOnly);
  wlRenderCards();
}
function wlClearFilters() {
  wlFilter = { auctionsOnly: false, seller: '', q: '' };
  renderWatchlist();
}

// Keeps the select-mode label and action bar in step after the visible set changes.
function wlSyncSelectionUI() {
  const lbl = document.querySelector('#wl-toolbar .wl-toolbar-label');
  if (lbl && watchlistSelectMode) lbl.textContent = `${watchlistSelected.size} selected`;
  updateWatchlistActionBar();
}

// Full render: toolbar + filter bar + cards. Used on load, refresh, select-mode toggle, removals.
function renderWatchlist() {
  const list = document.getElementById('list');
  const cnt  = document.getElementById('cntlbl');

  if (!watchlistItems.length) {
    document.getElementById('wl-filters')?.remove();
    list.innerHTML = '<div class="empty-msg">No active watchlist items</div>';
    cnt.textContent = '0 items';
    return;
  }

  document.getElementById('wl-toolbar')?.remove();
  const toolbar = document.createElement('div');
  toolbar.id = 'wl-toolbar';
  toolbar.className = 'wl-toolbar-bar';
  toolbar.innerHTML = `
    <span class="wl-toolbar-label">${watchlistSelectMode ? `${watchlistSelected.size} selected` : 'Manage items'}</span>
    <button class="wl-toolbar-btn" onclick="toggleWatchlistSelectMode()">${watchlistSelectMode ? 'Cancel' : 'Select'}</button>
  `;
  list.parentNode.insertBefore(toolbar, list);

  document.getElementById('wl-filters')?.remove();
  list.parentNode.insertBefore(wlBuildFilterBar(), list);

  list.classList.add('wl-grid');
  wlRenderCards();
}

// Cards only: used while typing/filtering so the search box keeps focus.
function wlRenderCards() {
  const list = document.getElementById('list');
  const cnt  = document.getElementById('cntlbl');
  const visible = wlVisibleItems();
  const total = watchlistItems.length;

  cnt.textContent = visible.length === total
    ? `${total} item${total===1?'':'s'}`
    : `${visible.length} of ${total} items`;
  document.getElementById('wl-clear')?.toggleAttribute('hidden', !wlHasFilters());

  // Never leave hidden items selected: "Remove Selected" must only act on what's on screen.
  const visIds = new Set(visible.map(v => v.item.itemId));
  for (const id of [...watchlistSelected]) if (!visIds.has(id)) watchlistSelected.delete(id);

  if (!visible.length) {
    list.innerHTML = '<div class="empty-msg" style="grid-column:1/-1">No watchlist items match your filters</div>';
    wlSyncSelectionUI();
    return;
  }

  const cardsHtml = visible.map(({ item, i }) => {
    const { text: cdText, cls: cdCls } = getCountdown(item.endTime);
    const price = item.currentPrice ? `$${parseFloat(item.currentPrice).toFixed(2)}` : '';
    const isSelected = watchlistSelected.has(item.itemId);
    const cardClickAttr = watchlistSelectMode
      ? `onclick="toggleWatchlistItemSelected('${item.itemId}', this)"`
      : '';

    const rawTitle = item.savedTitle || item.title || '';
    const safeTitle = rawTitle.replace(/&amp;/g,'&').replace(/&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
    const ebayUrl = `https://www.ebay.com/itm/${item.itemId}`;
    const est = listingEstInfo(safeTitle, item.currentPrice);

    return `<div class="wl-card${isSelected ? ' wl-selected' : ''}" ${cardClickAttr}>
      ${item.image ? (watchlistSelectMode
        ? `<img class="wl-img" src="${item.image}" alt="">`  /* Select mode: tapping the photo selects the card, like the rest of it */
        : `<img class="wl-img wl-img-link" src="${item.image}" alt="" onclick="window.open('${ebayUrl}','_blank')">`) : ''}
      <div class="wl-top">
        <span class="wl-countdown ${cdCls}" data-end="${item.endTime||''}">${cdText}</span>
        ${price ? `<span class="wl-price">${price}</span>` : ''}
        <button class="wl-remove-btn" onclick="event.stopPropagation();removeSingleFromWatchlist('${item.itemId}', this)">Remove</button>
      </div>
      <div class="wl-title-display" onclick="event.stopPropagation();window.open('${ebayUrl}','_blank')">${safeTitle}</div>
      ${est ? `<div class="wl-est" style="color:${est.color}">${est.text}</div>` : ''}
      <div class="wl-btns">
        <button class="wl-btn" onclick="event.stopPropagation();openEditNameModal('${item.itemId}', ${i})">Edit Name</button>
        <button class="wl-btn" onclick="event.stopPropagation();openSearchOptionsModal('${item.itemId}', ${i})">Search Options</button>
        <button class="wl-btn wl-id" onclick="event.stopPropagation();copyText('${item.itemId}', this)">Copy ID</button>
        <button class="wl-btn wl-snipe" onclick="event.stopPropagation();openSnipeModal('${item.itemId}')">Snipe</button>
      </div>
    </div>`;
  }).join('');

  const actionBarHtml = `
    <div id="wl-action-bar" style="display:none;position:sticky;bottom:0;background:var(--surf);border-top:.5px solid var(--bdr2);padding:12px;align-items:center;justify-content:space-between;gap:10px;margin-top:10px">
      <span id="wl-selected-count" style="font-size:13px;color:var(--tx2)">0 selected</span>
      <button id="wl-remove-btn" onclick="removeSelectedFromWatchlist()"
        style="padding:10px 16px;border-radius:8px;border:none;background:#dc2626;color:#fff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Remove Selected</button>
    </div>`;

  list.innerHTML = cardsHtml + actionBarHtml;

  wlSyncSelectionUI();
  startCountdownTick();
}

