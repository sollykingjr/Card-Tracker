// ── ebay-my-listings.js — eBay Listings tab: every live/scheduled listing, editable ──
// Works for listings made by this app (Inventory API) and ones made in Seller Hub / CSV.
// The worker picks the right eBay API per listing; this page doesn't need to know.

let emlListings = [];
let emlLoaded = false;
let emlLoading = false;
let emlError = '';
let emlFetchedAt = null;
let emlFilter = 'all';     // 'all' | 'active' | 'scheduled'
let emlQuery = '';
let emlBanner = '';
let emlDetail = null;      // listing being edited (from /ebay-listing-detail)
let emlLoadPromise = null;

function emlEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function emlFmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function emlTimeLeft(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (!(ms > 0)) return '';
  const h = Math.floor(ms / 3600000);
  if (h >= 48) return `${Math.floor(h / 24)}d left`;
  if (h >= 1) return `${h}h left`;
  return `${Math.max(1, Math.floor(ms / 60000))}m left`;
}

function emlLoad() {
  if (emlLoading && emlLoadPromise) return emlLoadPromise;
  emlLoadPromise = emlLoadNow();
  return emlLoadPromise;
}

async function emlLoadNow() {
  emlLoading = true;
  emlBanner = '';
  emlError = '';
  renderEbayListings();
  try {
    const res = await fetch(`${WORKER_URL}/ebay-my-listings`, { headers: { 'X-App-Key': APP_KEY } });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      const err = data.error;
      throw new Error(err === 'not_authenticated' ? 'eBay sign-in needed' : (err && err.message) || err || `HTTP ${res.status}`);
    }
    emlListings = data.listings || [];
    emlFetchedAt = data.fetchedAt || new Date().toISOString();
    emlLoaded = true;
  } catch (e) {
    emlError = e.message;
  } finally {
    emlLoading = false;
    renderEbayListings();
  }
}

function emlMatches(l) {
  if (emlFilter !== 'all' && l.status !== emlFilter) return false;
  if (!emlQuery) return true;
  const qf = foldText(emlQuery);
  return foldText(l.title).includes(qf) || String(l.sku || '').toLowerCase().includes(qf.toLowerCase()) || String(l.listingId).includes(emlQuery);
}

function renderEbayListings() {
  const root = document.getElementById('ebaylistings-root');
  if (!root) return;
  if (!emlLoaded && !emlLoading && !emlError) { emlLoad(); return; }

  const counts = { all: emlListings.length, active: 0, scheduled: 0 };
  for (const l of emlListings) counts[l.status] = (counts[l.status] || 0) + 1;
  const seg = (key, label) => `<button onclick="emlSetFilter('${key}')" style="flex:1;height:34px;border:1px solid ${emlFilter === key ? 'var(--acc-bdr)' : 'var(--bdr2)'};border-radius:9px;background:${emlFilter === key ? 'var(--acc-bg)' : 'var(--surf2)'};color:${emlFilter === key ? 'var(--acc)' : 'var(--tx2)'};font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">${label} ${counts[key] || 0}</button>`;

  const shown = emlListings.filter(emlMatches);
  let body;
  if (emlLoading && !emlLoaded) body = '<div class="spin"><div class="spin-ring"></div>Loading your eBay listings…</div>';
  else if (emlError && !emlLoaded) body = `<div style="padding:24px 0;text-align:center;color:var(--dn);font-size:14px">Couldn't load listings: ${emlEsc(emlError)}</div>`;
  else if (!shown.length) body = `<div style="padding:24px 0;text-align:center;color:var(--tx3);font-size:14px">${emlListings.length ? 'No listings match' : 'No live or scheduled listings'}</div>`;
  else body = shown.map(emlRowHtml).join('');

  const searchVal = emlEsc(emlQuery);
  root.innerHTML = `
    <div style="max-width:760px;margin:0 auto;padding:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px">
        <div class="mname" style="font-size:20px">eBay Listings</div>
        <button onclick="emlLoad()" ${emlLoading ? 'disabled' : ''} style="height:34px;padding:0 14px;border:1px solid var(--bdr2);border-radius:9px;background:var(--surf2);color:var(--tx2);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;opacity:${emlLoading ? '.6' : '1'}">${emlLoading ? 'Loading…' : 'Refresh'}</button>
      </div>
      ${emlBanner ? `<div style="padding:10px 12px;border-radius:10px;background:var(--surf2);border:1px solid var(--bdr2);color:var(--up);font-size:13px;font-weight:600;margin-bottom:10px">${emlEsc(emlBanner)}</div>` : ''}
      ${emlError && emlLoaded ? `<div style="font-size:12px;color:var(--dn);margin-bottom:8px">Refresh failed: ${emlEsc(emlError)}</div>` : ''}
      <input id="eml-search" type="search" placeholder="Search title, Item ID or listing #" value="${searchVal}" oninput="emlOnSearch(this.value)"
        style="width:100%;box-sizing:border-box;height:40px;padding:0 12px;border:1px solid var(--bdr2);border-radius:10px;background:var(--surf2);color:var(--tx);font-size:16px;font-family:inherit;margin-bottom:10px">
      <div style="display:flex;gap:6px;margin-bottom:6px">${seg('all', 'All')}${seg('active', 'Live')}${seg('scheduled', 'Scheduled')}</div>
      ${emlFetchedAt ? `<div style="font-size:11px;color:var(--tx3);margin-bottom:10px">Updated ${emlFmtTime(emlFetchedAt)}</div>` : ''}
      <div id="eml-list">${body}</div>
    </div>`;
}

function emlRowHtml(l) {
  const fmt = l.format === 'auction'
    ? `Auction · ${l.bidCount} bid${l.bidCount === 1 ? '' : 's'}`
    : 'Buy It Now';
  const when = l.status === 'scheduled'
    ? `<span style="color:var(--acc);font-weight:700">Starts ${emlFmtTime(l.startTime)}</span>`
    : (l.format === 'auction' && l.endTime ? emlTimeLeft(l.endTime) : '');
  const img = l.image
    ? `<img src="${emlEsc(l.image)}" loading="lazy" style="width:52px;height:52px;object-fit:cover;border-radius:8px;flex-shrink:0;background:var(--surf2)">`
    : `<div style="width:52px;height:52px;border-radius:8px;flex-shrink:0;background:var(--surf2)"></div>`;
  return `
    <div onclick="emlOpenEdit('${emlEsc(l.listingId)}')" style="display:flex;gap:10px;align-items:center;padding:10px;border:1px solid var(--bdr2);border-radius:12px;background:var(--bg2);margin-bottom:8px;cursor:pointer">
      ${img}
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600;color:var(--tx);line-height:1.3;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${emlEsc(l.title)}</div>
        <div style="font-size:12px;color:var(--tx3);margin-top:3px">${fmt}${when ? ' · ' + when : ''}${l.watchCount ? ` · ${l.watchCount} watching` : ''}</div>
        ${l.sku ? `<div style="font-size:11px;color:var(--tx3);margin-top:2px">${emlEsc(l.sku)}</div>` : ''}
      </div>
      <div style="font-size:15px;font-weight:700;color:var(--tx);flex-shrink:0">$${(l.price || 0).toFixed(2)}</div>
    </div>`;
}

function emlSetFilter(f) {
  emlFilter = f;
  renderEbayListings();
}

const emlOnSearch = debounce(v => {
  emlQuery = v.trim();
  const list = document.getElementById('eml-list');
  if (!list) return;
  const shown = emlListings.filter(emlMatches);
  list.innerHTML = shown.length ? shown.map(emlRowHtml).join('') : `<div style="padding:24px 0;text-align:center;color:var(--tx3);font-size:14px">No listings match</div>`;
}, 150);

// From the card modal: jump here and open the listing for this card.
async function emlOpenForCard(itemId) {
  document.getElementById('mwrap')?.classList.remove('on');
  setSection('ebaylistings');
  if (!emlLoaded) await emlLoad();
  const l = emlListings.find(x => x.sku === itemId);
  if (l) emlOpenEdit(l.listingId);
  else { emlBanner = ''; emlQuery = itemId; renderEbayListings(); }
}

// ── Edit sheet ──
function emlSheet(inner) {
  let wrap = document.getElementById('eml-sheet');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'eml-sheet';
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1050;display:flex;align-items:flex-end;justify-content:center';
    wrap.addEventListener('click', e => { if (e.target === wrap) emlCloseEdit(); });
    document.body.appendChild(wrap);
  }
  wrap.innerHTML = `
    <div id="eml-sheet-box" style="background:var(--bg2);width:100%;max-width:640px;max-height:90vh;overflow-y:auto;-webkit-overflow-scrolling:touch;border-radius:20px 20px 0 0;padding:18px 18px 32px;border:1px solid var(--bdr2);border-bottom:none;box-sizing:border-box">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:16px;font-weight:700;color:var(--tx)">Edit eBay Listing</div>
        <button onclick="emlCloseEdit()" style="background:none;border:none;color:var(--tx3);font-size:22px;line-height:1;cursor:pointer;padding:0 4px">×</button>
      </div>
      ${inner}
    </div>`;
}

function emlCloseEdit() {
  document.getElementById('eml-sheet')?.remove();
  emlDetail = null;
}

async function emlOpenEdit(listingId) {
  emlDetail = null;
  emlSheet('<div class="spin"><div class="spin-ring"></div>Loading listing…</div>');
  try {
    const res = await fetch(`${WORKER_URL}/ebay-listing-detail?listingId=${encodeURIComponent(listingId)}`, { headers: { 'X-App-Key': APP_KEY } });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error((data.error && data.error.message) || data.error || `HTTP ${res.status}`);
    if (!document.getElementById('eml-sheet')) return; // closed while loading
    emlDetail = data.listing;
    emlRenderEdit();
  } catch (e) {
    emlSheet(`<div style="color:var(--dn);font-size:14px;padding:12px 0">Couldn't load this listing: ${emlEsc(e.message)}</div>`);
  }
}

function emlRenderEdit() {
  const d = emlDetail;
  if (!d) return;
  const locked = d.locked;
  const dis = locked ? 'disabled' : '';
  const lbl = t => `<div style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin:12px 0 5px">${t}</div>`;
  const inp = 'width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--bdr2);border-radius:10px;background:var(--surf2);color:var(--tx);font-size:16px;font-family:inherit';
  const known = EBAY_SHIPPING_OPTIONS.some(o => o.id === d.shippingPolicyId);
  const shipOpts = EBAY_SHIPPING_OPTIONS.map(o => `<option value="${o.id}" ${o.id === d.shippingPolicyId ? 'selected' : ''}>${emlEsc(o.label)}</option>`).join('')
    + (!known ? `<option value="" selected>${d.shippingPolicyId ? `Other policy (${emlEsc(d.shippingPolicyId)})` : 'Not using a shipping policy'}</option>` : '');
  const isFixed = d.format !== 'auction';
  const status = d.scheduled
    ? `Scheduled · starts ${emlFmtTime(d.startTime)}`
    : (d.format === 'auction' ? `Auction · ${d.bidCount} bid${d.bidCount === 1 ? '' : 's'}${d.endTime ? ' · ' + emlTimeLeft(d.endTime) : ''}` : 'Live · Buy It Now');
  const card = (typeof cards !== 'undefined' && d.sku) ? cards.find(c => c.itemId === d.sku) : null;

  emlSheet(`
    <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:4px">
      ${d.images && d.images[0] ? `<img src="${emlEsc(d.images[0])}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;flex-shrink:0">` : ''}
      <div style="min-width:0">
        <div style="font-size:13px;color:var(--tx2);font-weight:600">${emlEsc(status)}</div>
        <div style="font-size:12px;color:var(--tx3);margin-top:2px">#${emlEsc(d.listingId)}${d.sku ? ' · ' + emlEsc(d.sku) : ''}${d.watchCount ? ` · ${d.watchCount} watching` : ''}</div>
        ${d.url ? `<a href="${emlEsc(d.url)}" target="_blank" rel="noopener" style="font-size:12px;color:var(--acc);font-weight:700;text-decoration:none">View on eBay ↗</a>` : ''}
      </div>
    </div>
    ${locked ? `<div style="padding:10px 12px;border-radius:10px;background:var(--surf2);border:1px solid var(--bdr2);color:var(--tx2);font-size:13px;margin-top:10px">This auction has bids, so eBay only allows limited changes. Edit it on eBay if needed.</div>` : ''}

    <div style="display:flex;justify-content:space-between;align-items:flex-end">
      ${lbl('Title')}
      ${!locked ? `<button type="button" onclick="emlSuggestTitle()" style="background:none;border:none;color:var(--acc);font-size:12px;font-weight:700;cursor:pointer;padding:0 0 5px;font-family:inherit">Suggest title</button>` : ''}
    </div>
    <textarea id="eml-title" rows="2" ${dis} oninput="emlCount()" style="${inp};resize:vertical">${emlEsc(d.title)}</textarea>
    <div id="eml-count" style="font-size:12px;color:var(--tx3);text-align:right;margin-top:3px"></div>

    ${lbl(isFixed ? 'Price' : 'Starting bid')}
    <input id="eml-price" type="number" inputmode="decimal" step="0.01" min="0.01" ${dis} value="${d.price ? d.price.toFixed(2) : ''}" oninput="emlShipCheck()" style="${inp}">

    ${isFixed ? `
      <label style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:14px;color:var(--tx);cursor:pointer">
        <input id="eml-offers" type="checkbox" ${d.allowOffers ? 'checked' : ''} ${dis} onchange="emlToggleOffers()" style="width:18px;height:18px"> Allow offers
      </label>
      <div id="eml-offer-fields" style="display:${d.allowOffers ? 'flex' : 'none'};gap:8px;margin-top:8px">
        <div style="flex:1"><div style="font-size:11px;color:var(--tx3);margin-bottom:4px">Auto-accept at</div><input id="eml-offer-auto" type="number" inputmode="decimal" step="0.01" ${dis} value="${d.offerAuto ? d.offerAuto.toFixed(2) : ''}" placeholder="optional" style="${inp}"></div>
        <div style="flex:1"><div style="font-size:11px;color:var(--tx3);margin-bottom:4px">Auto-decline below</div><input id="eml-offer-min" type="number" inputmode="decimal" step="0.01" ${dis} value="${d.offerMin ? d.offerMin.toFixed(2) : ''}" placeholder="optional" style="${inp}"></div>
      </div>` : ''}

    ${lbl('Shipping')}
    <select id="eml-ship" ${dis} onchange="emlShipCheck()" style="${inp}">${shipOpts}</select>
    <div id="eml-ship-warn" style="font-size:12px;color:var(--dn);margin-top:4px"></div>
    ${d.source === 'trading' ? `<div style="font-size:11px;color:var(--tx3);margin-top:4px">Listed outside the app — changing shipping keeps the package weight/size set on eBay.</div>` : ''}

    ${lbl('Description')}
    <textarea id="eml-desc" rows="5" ${dis} style="${inp};resize:vertical;font-size:14px">${emlEsc(d.description)}</textarea>

    <div id="eml-status" style="font-size:13px;margin-top:12px;min-height:18px"></div>
    ${!locked ? `
      <button id="eml-save" onclick="emlSave()" style="width:100%;height:46px;border:none;border-radius:10px;background:var(--acc);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:6px">Save changes</button>
      <button id="eml-end" onclick="emlEnd()" style="width:100%;height:42px;border:1px solid var(--dn);border-radius:10px;background:none;color:var(--dn);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:10px">End listing</button>` : ''}
  `);
  emlCount();
  emlShipCheck();
  if (card) emlDetail.card = card;
}

function emlCount() {
  const t = document.getElementById('eml-title');
  const c = document.getElementById('eml-count');
  if (!t || !c) return;
  const n = t.value.replace(/\s+/g, ' ').trim().length;
  c.textContent = `${n}/80 characters`;
  c.style.color = n > 80 ? 'var(--dn)' : 'var(--tx3)';
}

function emlToggleOffers() {
  const on = document.getElementById('eml-offers')?.checked;
  const f = document.getElementById('eml-offer-fields');
  if (f) f.style.display = on ? 'flex' : 'none';
}

// Same rule as the listing Review page: under $20 should ship PWE, $20+ shouldn't.
function emlShipCheck() {
  const w = document.getElementById('eml-ship-warn');
  if (!w) return;
  const price = parseFloat(document.getElementById('eml-price')?.value);
  const ship = document.getElementById('eml-ship')?.value;
  const isPwe = ['254806132017', '251924633017'].includes(ship);
  w.textContent = !ship || !(price > 0) ? ''
    : price < 20 && !isPwe ? 'Under $20 — usually ships PWE'
    : price >= 20 && isPwe ? '$20 or more — PWE has no tracking'
    : '';
}

function emlSuggestTitle() {
  const input = document.getElementById('eml-title');
  if (!input || !emlDetail) return;
  const card = emlDetail.card;
  openSearchEditor({
    text: (card && (card.fullCard || card.playerDisplay)) || emlDetail.title,
    startText: input.value,
    playerHint: (card && card.playerDisplay) || '',
    heading: 'Edit Title',
    applyLabel: 'Use as Title',
    fullLabel: card ? 'Original' : 'Current title',
    maxLen: 80,
    onApply: t => { const el = document.getElementById('eml-title'); if (el) { el.value = t; emlCount(); } }
  });
}

function emlSetStatus(msg, color) {
  const s = document.getElementById('eml-status');
  if (s) { s.textContent = msg; s.style.color = color || 'var(--tx2)'; }
}

function emlBusy(on, label) {
  for (const id of ['eml-save', 'eml-end']) {
    const b = document.getElementById(id);
    if (b) { b.disabled = on; b.style.opacity = on ? '.6' : '1'; }
  }
  const s = document.getElementById('eml-save');
  if (s) s.textContent = on && label ? label : 'Save changes';
}

// Only what actually changed is sent to eBay.
function emlCollectChanges() {
  const d = emlDetail;
  const ch = {};
  const title = document.getElementById('eml-title').value.replace(/\s+/g, ' ').trim();
  if (title !== String(d.title || '').replace(/\s+/g, ' ').trim()) ch.title = title;
  const price = parseFloat(document.getElementById('eml-price').value);
  if (!(price > 0)) return { error: 'Enter a price' };
  if (Math.round(price * 100) !== Math.round((d.price || 0) * 100)) ch.price = price.toFixed(2);
  const offers = document.getElementById('eml-offers');
  if (offers) {
    const on = offers.checked;
    const auto = on ? parseFloat(document.getElementById('eml-offer-auto').value) || null : null;
    const min = on ? parseFloat(document.getElementById('eml-offer-min').value) || null : null;
    const p = price;
    if (on && auto && auto >= p) return { error: 'Auto-accept must be below the price' };
    if (on && min && min >= p) return { error: 'Auto-decline must be below the price' };
    if (on && auto && min && min >= auto) return { error: 'Auto-decline must be below auto-accept' };
    const same = (a, b) => Math.round((a || 0) * 100) === Math.round((b || 0) * 100);
    if (on !== !!d.allowOffers || !same(auto, d.offerAuto) || !same(min, d.offerMin)) {
      ch.allowOffers = on; ch.offerAuto = auto ? auto.toFixed(2) : ''; ch.offerMin = min ? min.toFixed(2) : '';
    }
  }
  const ship = document.getElementById('eml-ship').value;
  if (ship && ship !== d.shippingPolicyId) ch.shippingPolicyId = ship;
  const desc = document.getElementById('eml-desc').value;
  const norm = s => String(s || '').replace(/\r\n?/g, '\n').replace(/^\n/, '');
  if (norm(desc) !== norm(d.description)) ch.description = desc;
  if (!title) return { error: 'Title can\'t be empty' };
  if (title.length > 80) return { error: 'Title is over 80 characters' };
  return { changes: ch };
}

async function emlSave() {
  if (!emlDetail) return;
  const c = emlCollectChanges();
  if (c.error) { emlSetStatus(c.error, 'var(--dn)'); return; }
  if (!Object.keys(c.changes).length) { emlSetStatus('Nothing changed', 'var(--tx3)'); return; }
  emlBusy(true, 'Saving to eBay…');
  emlSetStatus('');
  const listingId = emlDetail.listingId;
  try {
    const res = await fetch(`${WORKER_URL}/ebay-listing-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Key': APP_KEY },
      body: JSON.stringify({ listingId, changes: c.changes })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error((data.error && data.error.message) || data.error || `HTTP ${res.status}`);
    // Reflect the change locally.
    const ch = c.changes;
    Object.assign(emlDetail, {
      ...(ch.title !== undefined ? { title: ch.title } : {}),
      ...(ch.price !== undefined ? { price: parseFloat(ch.price) } : {}),
      ...(ch.description !== undefined ? { description: ch.description } : {}),
      ...(ch.shippingPolicyId !== undefined ? { shippingPolicyId: ch.shippingPolicyId } : {}),
      ...(ch.allowOffers !== undefined ? { allowOffers: ch.allowOffers, offerAuto: parseFloat(ch.offerAuto) || null, offerMin: parseFloat(ch.offerMin) || null } : {}),
    });
    const row = emlListings.find(x => x.listingId === listingId);
    if (row) {
      if (ch.title !== undefined) row.title = ch.title;
      if (ch.price !== undefined) row.price = parseFloat(ch.price);
    }
    renderEbayListings();
    emlBusy(false);
    const warn = (data.warnings || []).filter(Boolean);
    emlSetStatus(`✓ Saved on eBay${warn.length ? ' — note: ' + warn.join(' ') : ''}`, 'var(--up)');
  } catch (e) {
    emlBusy(false);
    emlSetStatus(`Couldn't save: ${e.message}`, 'var(--dn)');
  }
}

async function emlEnd() {
  if (!emlDetail) return;
  const d = emlDetail;
  if (!confirm(`End this listing on eBay?\n\n${d.title}\n\nThis can't be undone (you can relist the card later).`)) return;
  emlBusy(true);
  emlSetStatus('Ending listing…');
  try {
    const res = await fetch(`${WORKER_URL}/ebay-listing-end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Key': APP_KEY },
      body: JSON.stringify({ listingId: d.listingId })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error((data.error && data.error.message) || data.error || `HTTP ${res.status}`);
    emlListings = emlListings.filter(x => x.listingId !== d.listingId);
    emlBanner = `✓ Ended: ${d.title}. The Listed tag clears on the next sync (within 15 min).`;
    emlCloseEdit();
    renderEbayListings();
  } catch (e) {
    emlBusy(false);
    emlSetStatus(`Couldn't end listing: ${e.message}`, 'var(--dn)');
  }
}
