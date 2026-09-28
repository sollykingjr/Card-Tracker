// ── Card Tracker ──────────────────────────────────────────────────────────────
let ctQuery = '';
let ctSearchActive = true;
let ctSort = 'default';
let ctSortDir = 'desc';
let ctPage = 1;
const CT_PAGE_SIZE = 50;

let ctFilterSold = 'all';        // 'all' | 'exclude' | 'only'
let ctFilterTags = [];           // AND within category
let ctFilterSports = [];         // OR within category
let ctFilterYears = [];          // OR within category
let ctFilterSets = [];           // OR within category
let ctFilterSerial = false;      // checked = only serial-numbered
let ctFilterGraded = false;      // checked = only graded
let ctFilterInHand = false;      // checked = only in-hand
let ctFilterListed = 'all';      // 'all' | 'exclude' | 'only' (tagged Listed)
let ctFilterTagsAny = [];        // OR within category (set by the Ready to List shortcut)

// ── Filter shortcuts ── one preset of filters per tile. To add one, add an entry here.
// Fields a shortcut doesn't list stay at their defaults ('all' / off / none).
const CT_SHORTCUTS = [
  { key: 'ready', label: 'Ready to List', sold: 'exclude', inHand: true, listed: 'exclude', tagsAny: ['To Sell', 'PC Bench'] },
  { key: 'pc',    label: 'PC',            tagsAny: ['PC'] },
];
let ctShortcutsOpen = false; // mobile dropdown

function ctShortcutState(sc) {
  return { sold: sc.sold || 'all', inHand: !!sc.inHand, listed: sc.listed || 'all', tagsAny: sc.tagsAny || [] };
}
function ctActiveShortcut() {
  return CT_SHORTCUTS.find(sc => {
    const st = ctShortcutState(sc);
    return ctFilterSold === st.sold && ctFilterInHand === st.inHand && ctFilterListed === st.listed
      && ctFilterTagsAny.length === st.tagsAny.length && st.tagsAny.every(t => ctFilterTagsAny.includes(t));
  }) || null;
}
function ctApplyShortcutFields(st) {
  ctFilterSold = st.sold; ctFilterInHand = st.inHand; ctFilterListed = st.listed; ctFilterTagsAny = st.tagsAny.slice();
}
// Tapping the active shortcut clears it; tapping another replaces it. Other filters are kept.
function ctToggleShortcut(key) {
  const sc = CT_SHORTCUTS.find(x => x.key === key);
  const active = ctActiveShortcut();
  if (!sc || (active && active.key === key)) ctApplyShortcutFields(ctShortcutState({}));
  else ctApplyShortcutFields(ctShortcutState(sc));
  ctShortcutsOpen = false;
  ctPage = 1;
  ctRenderFilterContent();
  ctRenderBody();
}
function ctClearShortcut() {
  ctApplyShortcutFields(ctShortcutState({}));
  ctShortcutsOpen = false;
  ctPage = 1;
  ctRenderFilterContent();
  ctRenderBody();
}
function ctToggleShortcutsMenu() {
  ctShortcutsOpen = !ctShortcutsOpen;
  ctRenderBody();
}
function ctClearTagsAny() {
  ctFilterTagsAny = [];
  ctPage = 1;
  ctRenderFilterContent();
  ctRenderBody();
}
function ctShortcutTilesHTML(includeClear) {
  const active = ctActiveShortcut();
  const tiles = CT_SHORTCUTS.map(sc =>
    `<button class="schip${active && active.key === sc.key ? ' on' : ''}" onclick="ctToggleShortcut('${sc.key}')" style="padding:10px 8px;font-size:12px">${sc.label}</button>`);
  if (includeClear && active) tiles.push(`<button class="schip" onclick="ctClearShortcut()" style="padding:10px 8px;font-size:12px;color:var(--tx3)">Clear</button>`);
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${tiles.join('')}</div>`;
}
// Mobile bubble: shows the active shortcut's name when one is on.
function ctShortcutsButtonHTML() {
  const active = ctActiveShortcut();
  return `<button class="schip ct-filter-mobile-btn${active || ctShortcutsOpen ? ' on' : ''}" onclick="ctToggleShortcutsMenu()">${active ? active.label : 'Shortcuts'} ${ctShortcutsOpen ? '▴' : '▾'}</button>`;
}
function ctShortcutsDropdownHTML() {
  if (!ctShortcutsOpen) return '';
  return `<div class="ct-filter-mobile-btn" style="margin-top:10px">${ctShortcutTilesHTML(true)}</div>`;
}

function ctOpenSearch(query) {
  ctQuery = query;
  ctSearchActive = true;
  ctPage = 1;
}

function ctSetSort(key) {
  if (ctSort !== key) {
    ctSort = key;
    ctSortDir = 'desc';
  } else if (ctSortDir === 'desc') {
    ctSortDir = 'asc';
  } else {
    ctSort = 'default';
    ctSortDir = 'desc';
  }
  ctPage = 1;
  ctRenderBody();
}

function ctSetPage(p) {
  ctPage = p;
  ctRenderBody();
  document.getElementById('ct-body')?.scrollIntoView({ block: 'start' });
}

let ctScanCache = {};
let ctScanRetryAt = {}; // itemId -> timestamp of last "not found" live recheck
let ctTagCache = {};
let ctTagsLoaded = false;
let ctPendingCache = {};
let ctPendingLoaded = false;
let ctInHandCache = {};
let ctInHandLoaded = false;

const CT_OVERRIDE_FIELD_MAP = {
  Sport: 'sport', Year: 'year', Set: 'set', Variation: 'variation', Version: 'version',
  'Card No': 'cardNo', 'Player Name': 'playerDisplay', 'Serial No': 'serialNo',
  'Qty Manufactured': 'qtyManufactured', 'Purchased From': 'purchasedFrom', Grade: 'grade'
};

async function ctLoadTags() {
  if (ctTagsLoaded) return;
  ctTagsLoaded = true;
  try {
    const res = await fetch(`${WORKER_URL}/card-meta-all`);
    ctTagCache = await res.json() || {};
  } catch (e) {
    ctTagCache = {};
  }
  ctRenderBody();
  if (ctOpenCardIdx !== null) ctRenderTags(ctOpenCardIdx);
}

async function ctLoadInHand() {
  if (ctInHandLoaded) return;
  ctInHandLoaded = true;
  try {
    const res = await fetch(`${WORKER_URL}/card-meta-inhand-all`);
    ctInHandCache = await res.json() || {};
  } catch (e) {
    ctInHandCache = {};
  }
  ctRenderBody();
  if (ctOpenCardIdx !== null) ctRenderTags(ctOpenCardIdx);
}

async function ctLoadPendingOverrides() {
  if (ctPendingLoaded) return;
  ctPendingLoaded = true;
  try {
    const res = await fetch(`${WORKER_URL}/card-override-pending-all`);
    ctPendingCache = await res.json() || {};
  } catch (e) {
    ctPendingCache = {};
  }
  if (ctOpenCardIdx !== null) ctRenderPendingBadge(ctOpenCardIdx);
}

function ctCheckPendingResolved(c) {
  const pending = c.itemId ? ctPendingCache[c.itemId] : null;
  if (!pending || !pending.fields) return null;
  const stillPending = Object.keys(pending.fields).some(f => {
    const prop = CT_OVERRIDE_FIELD_MAP[f];
    if (!prop) return false;
    return String(c[prop] ?? '').trim() !== String(pending.fields[f] ?? '').trim();
  });
  if (stillPending) return true;
  delete ctPendingCache[c.itemId];
  fetch(`${WORKER_URL}/card-override-pending-clear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-App-Key': APP_KEY },
    body: JSON.stringify({ itemId: c.itemId })
  }).catch(() => {});
  return false;
}

function ctRenderPendingBadge(idx) {
  const box = document.getElementById('ct-pending-badge');
  const c = cards[idx];
  if (!box || !c) return;
  const isPending = ctCheckPendingResolved(c);
  box.innerHTML = isPending
    ? `<div style="display:inline-block;padding:4px 10px;border-radius:20px;background:var(--acc-bg);color:var(--acc);font-size:11px;font-weight:700;margin-top:6px">Pending update</div>`
    : '';
}

function ctIsInHand(c) {
  if (!c || !c.itemId) return false;
  if (c.salePrice) return false;
  return !!ctInHandCache[c.itemId];
}

function ctTargetPrice(cost, platform) {
  cost = safeNum(cost);
  if (!cost) return null;
  if (platform === 'comc') {
    return cost / (1 - 0.05);
  }
  if (platform === 'paypal') {
    return (cost + 0.49) / (1 - 0.0349);
  }
  if (platform === 'ebay') {
    const highFee = (cost + 0.40) / (1 - 0.1325);
    if (highFee <= 10) {
      return (cost + 0.30) / (1 - 0.1325);
    }
    return highFee;
  }
  return null;
}

function ctRenderInHand(idx) {
  const box = document.getElementById('ct-inhand');
  const c = cards[idx];
  if (!box || !c || !c.itemId) { if (box) box.innerHTML = ''; return; }
  if (c.salePrice) {
    box.innerHTML = `<div style="font-size:11px;color:var(--tx3);text-align:center;padding:8px 0">Sold — In Hand not applicable</div>`;
    return;
  }
  const isIn = ctIsInHand(c);
  box.innerHTML = `
    <button onclick="ctToggleInHand(${idx})" style="width:100%;height:40px;border:1px solid ${isIn ? 'var(--acc-bdr)' : 'var(--bdr2)'};border-radius:10px;background:${isIn ? 'var(--acc-bg)' : 'var(--surf2)'};color:${isIn ? 'var(--acc)' : 'var(--tx2)'};font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">
      ${isIn ? '✓ In Hand' : 'Mark In Hand'}
    </button>
  `;
}

async function ctToggleInHand(idx) {
  const c = cards[idx];
  if (!c || !c.itemId) return;
  const newVal = !ctInHandCache[c.itemId];
  ctInHandCache[c.itemId] = newVal;
  ctRenderInHand(idx);
  try {
    await fetch(`${WORKER_URL}/card-meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Key': APP_KEY },
      body: JSON.stringify({ itemId: c.itemId, inHand: newVal })
    });
  } catch (e) {}
}

function ctGetTags(c) {
  const stored = c.itemId ? (ctTagCache[c.itemId] || []) : [];
  return c.salePrice ? [...new Set([...stored, 'Sold'])] : stored;
}

function ctRenderTags(idx) {
  const box = document.getElementById('ct-tags');
  const c = cards[idx];
  if (!box || !c) return;
  const tags = ctGetTags(c);
  box.innerHTML = `
    <div style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Tags</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:${c.itemId ? '8px' : '0'}">
      ${tags.length ? tags.map(t => t === 'Sold'
        ? `<div style="padding:5px 11px;border-radius:20px;background:var(--acc-bg);color:var(--acc);font-size:11px;font-weight:700">Sold</div>`
        : t === 'Listed'
        ? `<div style="padding:5px 11px;border-radius:20px;background:var(--b3-bg);color:var(--b3-tx);font-size:11px;font-weight:700">Listed</div>`
        : `<div style="display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border-radius:20px;background:var(--surf2);border:1px solid var(--bdr2);color:var(--tx2);font-size:11px;font-weight:700">
             ${t}
             <button onclick="ctRemoveTag(${idx}, '${t.replace(/'/g,"\\'")}')" style="background:none;border:none;color:var(--tx3);font-size:13px;cursor:pointer;padding:0;line-height:1;font-family:inherit">×</button>
           </div>`
      ).join('') : '<div style="font-size:11px;color:var(--tx3)">No tags yet</div>'}
    </div>
    ${c.itemId ? `
      <div style="display:flex;gap:6px">
        <div style="position:relative;flex:1">
          <input id="ct-tag-input" placeholder="Add a tag..." autocomplete="off" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--bdr2);border-radius:8px;background:var(--surf2);color:var(--tx);font-size:12px;font-family:inherit" oninput="ctFilterTagSuggestions(${idx})" onfocus="ctFilterTagSuggestions(${idx})" onkeydown="if(event.key==='Enter'){event.preventDefault();ctAddTag(${idx})}">
          <div id="ct-tag-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;margin-top:4px;background:var(--surf2);border:1px solid var(--bdr2);border-radius:8px;max-height:160px;overflow-y:auto;z-index:60;box-shadow:var(--shadow-lg)"></div>
        </div>
        <button onclick="ctAddTag(${idx})" style="padding:8px 14px;border:1px solid var(--acc-bdr);border-radius:8px;background:var(--acc-bg);color:var(--acc);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0">Add</button>
      </div>
    ` : ''}
  `;
}

function ctAllTags() {
  const set = new Set();
  Object.values(ctTagCache).forEach(tags => (tags || []).forEach(t => set.add(t)));
  return [...set].sort((a, b) => a.localeCompare(b));
}

function ctHideTagDropdown() {
  const dd = document.getElementById('ct-tag-dropdown');
  if (dd) { dd.style.display = 'none'; dd.innerHTML = ''; }
}

function ctFilterTagSuggestions(idx) {
  const input = document.getElementById('ct-tag-input');
  const dd = document.getElementById('ct-tag-dropdown');
  const c = cards[idx];
  if (!input || !dd || !c) return;
  const raw = input.value.trim();
  const val = raw.toLowerCase();

  const already = new Set((ctTagCache[c.itemId] || []).map(t => t.toLowerCase()));
  const available = ctAllTags().filter(t => !already.has(t.toLowerCase()));
  const matches = val ? available.filter(t => t.toLowerCase().includes(val)) : available;
  const exactExists = available.some(t => t.toLowerCase() === val);

  let html = matches.map(t => `
    <div onclick="ctSelectTagSuggestion(${idx}, '${t.replace(/'/g,"\\'")}')" style="padding:8px 10px;cursor:pointer;font-size:12px;color:var(--tx)">${t}</div>
  `).join('');

  if (val && !exactExists) {
    html += `<div onclick="ctSelectTagSuggestion(${idx}, '${raw.replace(/'/g,"\\'")}')" style="padding:8px 10px;cursor:pointer;font-size:12px;color:var(--acc);border-top:${matches.length ? '1px solid var(--bdr)' : 'none'}">+ Create "${raw}"</div>`;
  }

  if (!html) { ctHideTagDropdown(); return; }
  dd.innerHTML = html;
  dd.style.display = 'block';
}

function ctSelectTagSuggestion(idx, tag) {
  const input = document.getElementById('ct-tag-input');
  if (input) input.value = tag;
  ctHideTagDropdown();
  ctAddTag(idx);
}

function ctAllTags() {
  const set = new Set();
  Object.values(ctTagCache).forEach(tags => (tags || []).forEach(t => set.add(t)));
  return [...set].sort((a, b) => a.localeCompare(b));
}

function ctHideTagDropdown() {
  const dd = document.getElementById('ct-tag-dropdown');
  if (dd) { dd.style.display = 'none'; dd.innerHTML = ''; }
}

function ctFilterTagSuggestions(idx) {
  const input = document.getElementById('ct-tag-input');
  const dd = document.getElementById('ct-tag-dropdown');
  const c = cards[idx];
  if (!input || !dd || !c) return;
  const raw = input.value.trim();
  const val = raw.toLowerCase();

  const already = new Set((ctTagCache[c.itemId] || []).map(t => t.toLowerCase()));
  const available = ctAllTags().filter(t => !already.has(t.toLowerCase()));
  const matches = val ? available.filter(t => t.toLowerCase().includes(val)) : available;
  const exactExists = available.some(t => t.toLowerCase() === val);

  let html = matches.map(t => `
    <div onclick="ctSelectTagSuggestion(${idx}, '${t.replace(/'/g,"\\'")}')" style="padding:8px 10px;cursor:pointer;font-size:12px;color:var(--tx)">${t}</div>
  `).join('');

  if (val && !exactExists) {
    html += `<div onclick="ctSelectTagSuggestion(${idx}, '${raw.replace(/'/g,"\\'")}')" style="padding:8px 10px;cursor:pointer;font-size:12px;color:var(--acc);border-top:${matches.length ? '1px solid var(--bdr)' : 'none'}">+ Create "${raw}"</div>`;
  }

  if (!html) { ctHideTagDropdown(); return; }
  dd.innerHTML = html;
  dd.style.display = 'block';
}

function ctSelectTagSuggestion(idx, tag) {
  const input = document.getElementById('ct-tag-input');
  if (input) input.value = tag;
  ctHideTagDropdown();
  ctAddTag(idx);
}

async function ctAddTag(idx) {
  const c = cards[idx];
  if (!c || !c.itemId) return;
  const input = document.getElementById('ct-tag-input');
  const val = (input?.value || '').trim();
  if (!val) return;
  const current = ctTagCache[c.itemId] || [];
  if (current.some(t => t.toLowerCase() === val.toLowerCase())) {
    input.value = '';
    ctHideTagDropdown();
    return;
  }
  const updated = [...current, val];
  ctTagCache[c.itemId] = updated;
  ctRenderTags(idx);
  try {
    await fetch(`${WORKER_URL}/card-meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Key': APP_KEY },
      body: JSON.stringify({ itemId: c.itemId, tags: updated })
    });
  } catch (e) {}
}

async function ctRemoveTag(idx, tag) {
  const c = cards[idx];
  if (!c || !c.itemId) return;
  const current = ctTagCache[c.itemId] || [];
  const updated = current.filter(t => t !== tag);
  ctTagCache[c.itemId] = updated;
  ctRenderTags(idx);
  try {
    await fetch(`${WORKER_URL}/card-meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Key': APP_KEY },
      body: JSON.stringify({ itemId: c.itemId, tags: updated })
    });
  } catch (e) {}
}

const CT_SCAN_RETRY_COOLDOWN_MS = 120000; // don't live-recheck the same empty scan more than once per 2 min

async function ctFetchScansForPage(itemIds) {
  const ids = [...new Set(itemIds.filter(Boolean))];
  const now = Date.now();

  // Never seen this session — ask normally, so the backend can serve its own
  // (fast) cache for cards that already have a known scan.
  const firstTime = ids.filter(id => !(id in ctScanCache));

  // Seen before and came back empty — only these get a live Drive recheck,
  // throttled so it isn't refired on every render.
  const retry = ids.filter(id => {
    const cached = ctScanCache[id];
    if (!cached || cached.front || cached.back) return false;
    const last = ctScanRetryAt[id] || 0;
    return now - last >= CT_SCAN_RETRY_COOLDOWN_MS;
  });

  if (!firstTime.length && !retry.length) return;

  let foundNew = false;

  async function runBatch(batchIds, fresh) {
    if (!batchIds.length) return;
    try {
      const res = await fetch(`${WORKER_URL}/scan-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-App-Key': APP_KEY },
        body: JSON.stringify({ itemIds: batchIds, fresh })
      });
      if (!res.ok) throw new Error(`scan-batch: HTTP ${res.status}`);
      const data = await res.json();
      batchIds.forEach(id => {
        const wasCached = id in ctScanCache;
        const result = data[id];
        if (!wasCached || (result && (result.front || result.back))) foundNew = true;
        if (fresh) ctScanRetryAt[id] = now;
      });
      Object.assign(ctScanCache, data);
    } catch (e) {
      batchIds.forEach(id => {
        if (!(id in ctScanCache)) { ctScanCache[id] = { front: null, back: null }; foundNew = true; }
        if (fresh) ctScanRetryAt[id] = now;
      });
    }
  }

  await Promise.all([
    runBatch(firstTime, false),
    runBatch(retry, true)
  ]);

  // Only repaint when something actually changed — otherwise this would
  // re-trigger itself via ctRenderBody() every time, in a tight fetch loop.
  if (foundNew) ctRenderBody();
}

function ctThumbHTML(itemId) {
  const scan = itemId ? ctScanCache[itemId] : null;
  const src = scan?.front?.thumbSm || scan?.front?.thumb;
  if (src) {
    return `<img src="${src}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--bdr2);flex-shrink:0" loading="lazy">`;
  }
  return `<div style="width:64px;height:64px;border-radius:8px;background:var(--surf2);border:1px solid var(--bdr);flex-shrink:0"></div>`;
}
let ctViewMode = 'list';

function ctSetViewMode(mode) {
  ctViewMode = mode;
  ctRenderBody();
}

function ctViewToggleHTML() {
  return `
    <div style="display:flex;gap:6px">
      <button class="schip${ctViewMode==='list'?' on':''}" onclick="ctSetViewMode('list')">List</button>
      <button class="schip${ctViewMode==='card'?' on':''}" onclick="ctSetViewMode('card')">Card</button>
    </div>
  `;
}

function ctFiltersActiveCount() {
  let n = 0;
  if (ctFilterSold !== 'all') n++;
  if (ctFilterInHand) n++;
  if (ctFilterListed !== 'all') n++;
  if (ctFilterSerial) n++;
  if (ctFilterGraded) n++;
  if (ctFilterTags.length) n++;
  if (ctFilterTagsAny.length) n++;
  if (ctFilterSports.length) n++;
  if (ctFilterYears.length) n++;
  if (ctFilterSets.length) n++;
  return n;
}

function ctFilterButtonHTML() {
  const n = ctFiltersActiveCount();
  return `<button class="schip ct-filter-mobile-btn${n ? ' on' : ''}" onclick="ctOpenFilters()">Filters${n ? ` (${n})` : ''}</button>`;
}

function ctFilterPanelHTML(scope) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div class="mname" style="font-size:18px;margin-bottom:0">Filters</div>
      <button onclick="ctResetFilters()" style="padding:6px 12px;border:1px solid var(--bdr2);border-radius:8px;background:var(--surf2);color:var(--tx2);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Reset</button>
    </div>

    <div style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Shortcuts</div>
    <div style="margin-bottom:${ctFilterTagsAny.length ? '8px' : '20px'}">${ctShortcutTilesHTML(false)}</div>
    ${ctFilterTagsAny.length ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:var(--tx2);margin-bottom:20px"><span>Tagged any of: ${ctFilterTagsAny.join(', ')}</span><button onclick="ctClearTagsAny()" style="background:none;border:none;color:var(--tx3);font-size:16px;cursor:pointer;padding:0 4px">×</button></div>` : ''}

    <div style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Sold</div>
    <div style="display:flex;gap:6px;margin-bottom:20px">
      <button class="schip${ctFilterSold==='all'?' on':''}" onclick="ctSetFilterSold('all')" style="flex:1;padding:8px;font-size:11px">All</button>
      <button class="schip${ctFilterSold==='exclude'?' on':''}" onclick="ctSetFilterSold('exclude')" style="flex:1;padding:8px;font-size:11px">Exclude Sold</button>
      <button class="schip${ctFilterSold==='only'?' on':''}" onclick="ctSetFilterSold('only')" style="flex:1;padding:8px;font-size:11px">Sold Only</button>
    </div>

    <div style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">In Hand / eBay</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:20px">
      <button class="schip${ctFilterListed==='all'?' on':''}" onclick="ctSetFilterListed('all')" style="padding:8px;font-size:11px">All</button>
      <button class="schip${ctFilterInHand?' on':''}" onclick="ctToggleFilterInHand()" style="padding:8px;font-size:11px">In Hand Only</button>
      <button class="schip${ctFilterListed==='exclude'?' on':''}" onclick="ctSetFilterListed('exclude')" style="padding:8px;font-size:11px">Exclude eBay Listings</button>
      <button class="schip${ctFilterListed==='only'?' on':''}" onclick="ctSetFilterListed('only')" style="padding:8px;font-size:11px">eBay Listings Only</button>
    </div>

    <div style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Card Attributes</div>
    <label style="display:flex;align-items:center;gap:10px;padding:10px 0;cursor:pointer;border-bottom:1px solid var(--bdr)">
      <input type="checkbox" ${ctFilterSerial ? 'checked' : ''} onchange="ctToggleFilterSerial()" style="width:18px;height:18px;accent-color:var(--acc)">
      <span style="font-size:14px;color:var(--tx)">Serial Numbered</span>
    </label>
    <label style="display:flex;align-items:center;gap:10px;padding:10px 0;cursor:pointer">
      <input type="checkbox" ${ctFilterGraded ? 'checked' : ''} onchange="ctToggleFilterGraded()" style="width:18px;height:18px;accent-color:var(--acc)">
      <span style="font-size:14px;color:var(--tx)">Graded</span>
    </label>

    ${ctPickerHTML('tags', scope)}
    ${ctPickerHTML('sports', scope)}
    ${ctPickerHTML('years', scope)}
    ${ctPickerHTML('sets', scope)}
  `;
}

function ctRenderFilterContent() {
  const sheetBox = document.getElementById('ct-filter-content');
  if (sheetBox) sheetBox.innerHTML = ctFilterPanelHTML('sheet');
  const sidebarBox = document.getElementById('ct-filter-sidebar-content');
  if (sidebarBox) sidebarBox.innerHTML = ctFilterPanelHTML('sidebar');
}

function ctOpenFilters() {
  ctRenderFilterContent();
  document.getElementById('ct-filter-wrap').classList.add('on');
}

function ctCloseFilters() {
  document.getElementById('ct-filter-wrap').classList.remove('on');
}

function ctResetFilters() {
  ctFilterSold = 'all';
  ctFilterInHand = false;
  ctFilterListed = 'all';
  ctFilterSerial = false;
  ctFilterGraded = false;
  ctFilterTags = [];
  ctFilterTagsAny = [];
  ctFilterSports = [];
  ctFilterYears = [];
  ctFilterSets = [];
  ctPage = 1;
  ctRenderFilterContent();
  ctRenderBody();
}

function ctToggleFilterInHand() {
  ctFilterInHand = !ctFilterInHand;
  ctPage = 1;
  ctRenderFilterContent();
  ctRenderBody();
}

function ctSetFilterListed(val) {
  ctFilterListed = val;
  ctPage = 1;
  ctRenderFilterContent();
  ctRenderBody();
}

function ctSetFilterSold(val) {
  ctFilterSold = val;
  ctPage = 1;
  ctRenderFilterContent();
  ctRenderBody();
}

function ctToggleFilterSerial() {
  ctFilterSerial = !ctFilterSerial;
  ctPage = 1;
  ctRenderFilterContent();
  ctRenderBody();
}

function ctToggleFilterGraded() {
  ctFilterGraded = !ctFilterGraded;
  ctPage = 1;
  ctRenderFilterContent();
  ctRenderBody();
}

function ctDistinctValues(field) {
  const set = new Set();
  cards.forEach(c => { if (c[field]) set.add(String(c[field])); });
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

const CT_FILTER_PICKERS = {
  sports: { label: 'Sport', getOptions: () => ctDistinctValues('sport'), getSelected: () => ctFilterSports, setSelected: arr => ctFilterSports = arr },
  tags:   { label: 'Tags',  getOptions: () => ctAllTags(),               getSelected: () => ctFilterTags,   setSelected: arr => ctFilterTags = arr },
  years:  { label: 'Year',  getOptions: () => ctDistinctValues('year'),  getSelected: () => ctFilterYears,  setSelected: arr => ctFilterYears = arr },
  sets:   { label: 'Set',   getOptions: () => ctDistinctValues('set'),  getSelected: () => ctFilterSets,   setSelected: arr => ctFilterSets = arr }
};

function ctPickerToggle(key, value) {
  const p = CT_FILTER_PICKERS[key];
  const current = p.getSelected();
  p.setSelected(current.includes(value) ? current.filter(v => v !== value) : [...current, value]);
  ctPage = 1;
  ctRenderFilterContent();
  ctRenderBody();
}

function ctPickerSelect(key, value) {
  ctPickerToggle(key, value);
}

function ctPickerFilterSuggestions(key, scope) {
  const input = document.getElementById(`ct-picker-input-${scope}-${key}`);
  const dd = document.getElementById(`ct-picker-dropdown-${scope}-${key}`);
  if (!input || !dd) return;
  const p = CT_FILTER_PICKERS[key];
  const val = input.value.trim().toLowerCase();
  const selected = p.getSelected();
  const available = p.getOptions().filter(v => !selected.includes(v));
  const matches = val ? available.filter(v => v.toLowerCase().includes(val)) : available;

  if (!matches.length) {
    dd.style.display = 'none';
    dd.innerHTML = '';
    return;
  }
  dd.innerHTML = matches.map(v => `
    <div onclick="ctPickerToggle('${key}', '${v.replace(/'/g,"\\'")}')" style="padding:8px 10px;cursor:pointer;font-size:12px;color:var(--tx)">${v}</div>
  `).join('');
  dd.style.display = 'block';
}

function ctPickerHTML(key, scope) {
  const p = CT_FILTER_PICKERS[key];
  const selected = p.getSelected();
  return `
    <div style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin:20px 0 8px">${p.label}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:${selected.length ? '10px' : '0'}">
      ${selected.map(v => `
        <div style="display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border-radius:20px;background:var(--acc-bg);border:1px solid var(--acc-bdr);color:var(--acc);font-size:11px;font-weight:700">
          ${v}
          <button onclick="ctPickerToggle('${key}', '${v.replace(/'/g,"\\'")}')" style="background:none;border:none;color:var(--acc);font-size:13px;cursor:pointer;padding:0;line-height:1;font-family:inherit">×</button>
        </div>
      `).join('')}
    </div>
    <div style="position:relative">
      <input id="ct-picker-input-${scope}-${key}" placeholder="Search ${p.label.toLowerCase()}..." autocomplete="off" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--bdr2);border-radius:8px;background:var(--surf2);color:var(--tx);font-size:12px;font-family:inherit" oninput="ctPickerFilterSuggestions('${key}','${scope}')" onfocus="ctPickerFilterSuggestions('${key}','${scope}')">
      <div id="ct-picker-dropdown-${scope}-${key}" style="display:none;position:absolute;top:100%;left:0;right:0;margin-top:4px;background:var(--surf2);border:1px solid var(--bdr2);border-radius:8px;max-height:160px;overflow-y:auto;z-index:60;box-shadow:var(--shadow-lg)"></div>
    </div>
  `;
}

function ctDateLine(c) {
  const pDate = fmtShortDate(c.datePurchased);
  const sDate = c.salePrice ? fmtShortDate(c.transactionDate) : null;
  return [
    c.itemId ? 'ID: ' + c.itemId : 'No item ID',
    pDate !== '—' ? 'Purchased ' + pDate : null,
    sDate && sDate !== '—' ? 'Sold ' + sDate : null
  ].filter(Boolean).join(' · ');
}

function ctListRowHTML(c) {
  const dateLine = ctDateLine(c);
  const inHand = ctIsInHand(c);
  const listed = ctGetTags(c).includes('Listed');
  const tags = ctGetTags(c).filter(t => t !== 'Sold' && t !== 'Listed');
  return `
    <div class="cs-row" onclick="ctOpenCard(${cards.indexOf(c)})">
      <div class="cs-row-top">
        ${ctThumbHTML(c.itemId)}
        <div class="recent-info">
          <div style="font-size:16px;font-weight:700">${c.fullCard || '—'}</div>
          <div style="font-size:14px;color:var(--tx2);font-weight:500;margin-top:3px">${dateLine}</div>
        </div>
      </div>
      <div class="cs-row-prices">
        <div style="text-align:right">
          <div style="font-size:12px;color:var(--tx3);font-weight:600">Purchase Price</div>
          <div style="font-size:16px;color:var(--tx);font-weight:700">$${safeNum(c.purchasePrice).toFixed(2)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:12px;color:var(--tx3);font-weight:600">Sale Price</div>
          <div style="font-size:16px;color:var(--tx);font-weight:700">${c.salePrice ? '$' + safeNum(c.salePrice).toFixed(2) : 'Not sold'}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <div style="display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px">
            ${inHand ? '<span class="badge b5">In Hand</span>' : ''}
            ${listed ? '<span class="badge b3">Listed</span>' : ''}
            ${c.salePrice ? '<span class="badge" style="background:rgba(248,113,113,.15);color:var(--dn)">Sold</span>' : ''}
          </div>
          ${tags.length ? `<div style="display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px">${tags.map(t => `<span style="padding:2px 8px;border-radius:20px;background:var(--surf2);border:1px solid var(--bdr2);color:var(--tx2);font-size:10px;font-weight:600">${t}</span>`).join('')}</div>` : ''}
        </div>
      </div>
    </div>`;
}

function ctCardBoxHTML(c) {
  const dateLine = ctDateLine(c);
  const scan = c.itemId ? ctScanCache[c.itemId] : null;
  const src = scan?.front?.thumbSm || scan?.front?.thumb;
  return `
    <div style="cursor:pointer;border:1px solid var(--bdr);border-radius:12px;overflow:hidden;background:var(--surf)" onclick="ctOpenCard(${cards.indexOf(c)})">
      ${src
        ? `<img src="${src}" style="width:100%;aspect-ratio:2.5/3.5;object-fit:cover;display:block;border-radius:6px" loading="lazy">`
        : `<div style="width:100%;aspect-ratio:2.5/3.5;background:var(--surf2);border-radius:6px"></div>`
      }
      <div style="padding:7px">
        <div style="font-size:11px;font-weight:700;line-height:1.25">${c.fullCard || '—'}</div>
        <div style="font-size:9px;color:var(--tx2);font-weight:500;margin-top:3px">${dateLine}</div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;gap:6px">
          <div>
            <div style="font-size:8px;color:var(--tx3);font-weight:600">Purchase</div>
            <div style="font-size:11px;color:var(--tx);font-weight:700">$${safeNum(c.purchasePrice).toFixed(2)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:8px;color:var(--tx3);font-weight:600">Sale</div>
            <div style="font-size:11px;color:var(--tx);font-weight:700">${c.salePrice ? '$' + safeNum(c.salePrice).toFixed(2) : 'Not sold'}</div>
          </div>
        </div>
      </div>
    </div>`;
}

function ctPaginationHTML(page, totalPages) {
  if (totalPages <= 1) return '';
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0;gap:8px">
      <button onclick="ctSetPage(${page - 1})" ${page <= 1 ? 'disabled' : ''} style="padding:8px 16px;border:1px solid var(--bdr2);border-radius:8px;background:var(--surf2);color:var(--tx);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;opacity:${page <= 1 ? '0.4' : '1'}">← Prev</button>
      <div style="font-size:12px;color:var(--tx3)">Page ${page} of ${totalPages}</div>
      <button onclick="ctSetPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''} style="padding:8px 16px;border:1px solid var(--bdr2);border-radius:8px;background:var(--surf2);color:var(--tx);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;opacity:${page >= totalPages ? '0.4' : '1'}">Next →</button>
    </div>
  `;
}

const CT_SORT_OPTS = [
  { k: 'purchaseDate', l: 'Purchase Date' },
  { k: 'saleDate', l: 'Sale Date' },
  { k: 'purchasePrice', l: 'Purchase Price' },
  { k: 'salePrice', l: 'Sale Price' }
];

function ctSortMatches(matches) {
  if (ctSort === 'default') return matches;
  const arr = matches.slice();
  const dir = ctSortDir === 'asc' ? 1 : -1;
  if (ctSort === 'purchaseDate') arr.sort((a, b) => dir * (new Date(a.datePurchased || 0) - new Date(b.datePurchased || 0)));
  else if (ctSort === 'saleDate') arr.sort((a, b) => dir * (new Date(a.transactionDate || 0) - new Date(b.transactionDate || 0)));
  else if (ctSort === 'purchasePrice') arr.sort((a, b) => dir * (safeNum(a.purchasePrice) - safeNum(b.purchasePrice)));
  else if (ctSort === 'salePrice') arr.sort((a, b) => dir * (safeNum(a.salePrice) - safeNum(b.salePrice)));
  return arr;
}

function ctParseQueryGroups(q) {
  const groups = [];
  const groupRe = /\(([^)]*)\)/g;
  let m;
  while ((m = groupRe.exec(q)) !== null) {
    const terms = m[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (terms.length) groups.push(terms);
  }
  const remaining = q.replace(groupRe, ' ');
  remaining.split(/\s+/).map(s => s.trim().toLowerCase()).filter(Boolean).forEach(s => groups.push([s]));
  return groups;
}

function ctMatches(c, q) {
  const hay = [c.playerDisplay, c.fullCard, c.itemId, c.serialNo, c.sport, c.year, c.set, c.variation, c.version, c.cardNo, c.grade]
    .filter(Boolean).join(' ').toLowerCase();
  const groups = ctParseQueryGroups(q);
  if (!groups.length) return true;
  return groups.every(orGroup => orGroup.some(term => hay.includes(term)));
}

function ctFilterCategoryMatch(c) {
  if (ctFilterSold === 'exclude' && c.salePrice) return false;
  if (ctFilterSold === 'only' && !c.salePrice) return false;

  if (ctFilterSerial && !c.serialNo) return false;
  if (ctFilterGraded && !c.grade) return false;
  if (ctFilterInHand && !ctIsInHand(c)) return false;
  if (ctFilterListed === 'exclude' && ctGetTags(c).includes('Listed')) return false;
  if (ctFilterListed === 'only' && !ctGetTags(c).includes('Listed')) return false;

  if (ctFilterSports.length && !ctFilterSports.includes(c.sport)) return false;
  if (ctFilterYears.length && !ctFilterYears.includes(String(c.year))) return false;
  if (ctFilterSets.length && !ctFilterSets.includes(c.set)) return false;

  if (ctFilterTags.length) {
    const cardTags = ctGetTags(c);
    if (!ctFilterTags.every(t => cardTags.includes(t))) return false;
  }
  if (ctFilterTagsAny.length) {
    const cardTags = ctGetTags(c);
    if (!ctFilterTagsAny.some(t => cardTags.includes(t))) return false;
  }

  return true;
}
function ctCopyId(id, btn) {
  if (!id) return;
  navigator.clipboard.writeText(id).then(() => {
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1200);
    }
  }).catch(()=>{});
}

// Copies the card's full name (same text as the modal title), e.g. for a Card Ladder search.
function ctCopyName(idx, btn) {
  const c = cards[idx];
  if (!c) return;
  ctCopyId(c.fullCard || c.playerDisplay || '', btn);
}

// Opens a URL outside the app. On an iPhone/iPad Home Screen web app, links normally open
// in iOS's in-app viewer (separate login, can't hand off to apps), so use the x-safari-
// scheme to open real Safari instead. Everywhere else, a normal new tab.
function ctOpenExternal(url) {
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  if (isIOS && standalone && /^https:\/\//.test(url)) {
    window.location.href = 'x-safari-' + url;
  } else {
    window.open(url, '_blank');
  }
}

// Opens the search editor (chips + Suggested) for Card Ladder, COMC, or eBay.
function ctSearchOn(idx, platform) {
  const c = cards[idx];
  if (!c) return;
  openSearchEditor({
    platform,
    text: c.fullCard || c.playerDisplay || '',
    key: 'card:' + (c.itemId || idx),
    playerHint: c.playerDisplay || ''
  });
}

function ctToggleMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('ct-menu');
  if (!menu) return;
  const opening = !menu.classList.contains('on');
  menu.classList.toggle('on', opening);
  if (opening) {
    setTimeout(() => {
      document.addEventListener('click', function closeMenu() {
        const m = document.getElementById('ct-menu');
        if (m) m.classList.remove('on');
        document.removeEventListener('click', closeMenu);
      }, { once: true });
    }, 0);
  }
}

let ctOpenCardIdx = null;

function ctOpenCard(idx) {
  const c = cards[idx];
  if (!c) return;
  ctOpenCardIdx = idx;
  const ctModalHtml = `
    <button class="ct-menu-btn" onclick="ctToggleMenu(event)">⋮</button>
    <div class="ct-menu" id="ct-menu">
      <div class="ct-menu-item" onclick="ctRefreshScans()">Refresh Scans</div>
      <div class="ct-menu-item" onclick="ctShowEditMetadata(${idx})">Edit Metadata</div>
      <div class="ct-menu-item" onclick="ebayOpenListingForm('${(c.itemId||'').replace(/'/g,"\\'")}')">List on eBay</div>
    </div>
    <div class="mname">${c.fullCard || c.playerDisplay || '—'}</div>
    <div class="mitemid">${c.itemId || '—'}</div>
    <div id="ct-pending-badge"></div>
        <div class="sgrid">
      <div class="scard"><div class="slbl">Serial No</div><div class="sval">${c.serialNo || '—'}</div></div>
      <div class="scard"><div class="slbl">Purchase price</div><div class="sval">$${safeNum(c.purchasePrice).toFixed(2)}</div></div>
      ${(() => {
        if (c.salePrice) {
          return `<div class="scard"><div class="slbl">Sale price</div><div class="sval">$${safeNum(c.salePrice).toFixed(2)}</div></div>`;
        }
        if (ctIsInHand(c)) {
          const ep = ctTargetPrice(c.purchasePrice, 'ebay');
          return `<div class="scard sc-target"><div class="slbl">eBay Target Price</div><div class="sval">${ep ? '$'+ep.toFixed(2) : '—'}</div></div>`;
        }
        const cp = ctTargetPrice(c.purchasePrice, 'comc');
        return `<div class="scard"><div class="slbl">COMC Target Price</div><div class="sval">${cp ? '$'+cp.toFixed(2) : '—'}</div></div>`;
      })()}
      <div class="scard"><div class="slbl">Net profit</div><div class="sval"><span class="${safeNum(c.netProfit,true)>=0?'up':'dn'}">${safeNum(c.netProfit,true)>=0?'+':''}$${safeNum(c.netProfit,true).toFixed(2)}</span></div></div>
      <div class="scard"><div class="slbl">Purchase Date</div><div class="sval">${fmtShortDate(c.datePurchased)}</div></div>
      ${(() => {
        if (c.salePrice) {
          return `<div class="scard"><div class="slbl">Sale Date</div><div class="sval">${fmtShortDate(c.transactionDate)}</div></div>`;
        }
        if (ctIsInHand(c)) {
          const pp = ctTargetPrice(c.purchasePrice, 'paypal');
          return `<div class="scard sc-target"><div class="slbl">PayPal Target Price</div><div class="sval">${pp ? '$'+pp.toFixed(2) : '—'}</div></div>`;
        }
        return `<div class="scard"><div class="slbl">Sale Date</div><div class="sval">—</div></div>`;
      })()}
    </div>
     <div style="display:flex;gap:8px;margin-top:4px">
       <button onclick="ctCopyId('${(c.itemId||'').replace(/'/g,"\\'")}', this)" style="flex:1;height:40px;border:1px solid var(--acc-bdr);border-radius:10px;background:var(--acc-bg);color:var(--acc);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Copy Item ID</button>
       <button onclick="ctCopyName(${idx}, this)" style="flex:1;height:40px;border:1px solid var(--acc-bdr);border-radius:10px;background:var(--acc-bg);color:var(--acc);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Copy Item Name</button>
     </div>
     <div style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin:14px 0 6px">Search Options</div>
     <div style="display:flex;gap:8px">
       <button onclick="ctSearchOn(${idx}, 'cardladder')" style="flex:1;height:40px;border:1px solid var(--bdr2);border-radius:10px;background:var(--surf2);color:var(--tx);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Card Ladder</button>
       <button onclick="ctSearchOn(${idx}, 'comc')" style="flex:1;height:40px;border:1px solid var(--bdr2);border-radius:10px;background:var(--surf2);color:var(--tx);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">COMC</button>
       <button onclick="ctSearchOn(${idx}, 'ebay')" style="flex:1;height:40px;border:1px solid var(--bdr2);border-radius:10px;background:var(--surf2);color:var(--tx);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">eBay</button>
     </div>
    <div id="ct-inhand" style="margin-top:12px"></div>
    <div id="ct-tags" style="margin-top:14px"></div>
    <div id="ct-scans" style="margin-top:14px"></div>
  `;
  _modalMainHtml = ctModalHtml;
  document.getElementById('mcontent').innerHTML = ctModalHtml;
  document.getElementById('mwrap').classList.add('on');
  ctRenderTags(idx);
  ctRenderPendingBadge(idx);
  ctRenderInHand(idx);
  if (c.itemId) ctLoadScans(c.itemId);
}
function ctShowEditMetadata(idx) {
  const menu = document.getElementById('ct-menu');
  if (menu) menu.classList.remove('on');
  const c = cards[idx];
  if (!c) return;

  const fieldInput = (label, key) => {
    const prop = CT_OVERRIDE_FIELD_MAP[key];
    const val = (c[prop] ?? '').toString();
    const inputId = `ct-edit-${prop}`;
    return `
      <div style="margin-bottom:12px">
        <div style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${label}</div>
        <input id="${inputId}" value="${val.replace(/"/g,'&quot;')}" autocomplete="off" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--bdr2);border-radius:8px;background:var(--surf2);color:var(--tx);font-size:13px;font-family:inherit">
      </div>
    `;
  };

  document.getElementById('mcontent').innerHTML = `
    <div style="position:sticky;top:0;background:var(--bg);padding:10px 0 8px;z-index:10;margin-bottom:6px">
      <button onclick="document.getElementById('mcontent').innerHTML=_modalMainHtml"
        style="display:flex;align-items:center;gap:6px;background:none;border:none;color:var(--acc);font-size:14px;font-weight:500;cursor:pointer;font-family:inherit;padding:0">
        ← Back
      </button>
    </div>
    <div class="section-hdr">Edit Metadata</div>
    <div style="margin-top:12px">
      ${fieldInput('Sport', 'Sport')}
      ${fieldInput('Year', 'Year')}
      ${fieldInput('Set', 'Set')}
      ${fieldInput('Variation', 'Variation')}
      ${fieldInput('Version', 'Version')}
      ${fieldInput('Card No', 'Card No')}
      ${fieldInput('Player Name', 'Player Name')}
      ${fieldInput('Serial No', 'Serial No')}
      ${fieldInput('Qty Manufactured', 'Qty Manufactured')}
      ${fieldInput('Purchased From', 'Purchased From')}
      ${fieldInput('Grade', 'Grade')}
    </div>
    <div id="ct-edit-status" style="font-size:12px;color:var(--tx3);margin:4px 0 10px"></div>
    <button id="ct-edit-save-btn" onclick="ctSaveMetadata(${idx})" style="width:100%;height:42px;border:1px solid var(--acc-bdr);border-radius:10px;background:var(--acc-bg);color:var(--acc);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Save Changes</button>
  `;
}

function ctRefreshScans() {
  const menu = document.getElementById('ct-menu');
  if (menu) menu.classList.remove('on');
  const c = cards[ctOpenCardIdx];
  if (!c || !c.itemId) return;
  ctLoadScans(c.itemId, true);
}

async function ctSaveMetadata(idx) {
  const c = cards[idx];
  if (!c || !c.itemId) return;

  const status = document.getElementById('ct-edit-status');
  const saveBtn = document.getElementById('ct-edit-save-btn');
  const fields = {};

  Object.keys(CT_OVERRIDE_FIELD_MAP).forEach(label => {
    const prop = CT_OVERRIDE_FIELD_MAP[label];
    const input = document.getElementById(`ct-edit-${prop}`);
    if (!input) return;
    const newVal = input.value.trim();
    const currentVal = (c[prop] ?? '').toString().trim();
    if (newVal !== currentVal) fields[label] = newVal;
  });

  if (!Object.keys(fields).length) {
    if (status) status.textContent = 'No changes to save.';
    return;
  }

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
  if (status) status.textContent = '';

  try {
    const res = await fetch(`${WORKER_URL}/card-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Key': APP_KEY },
      body: JSON.stringify({ itemId: c.itemId, fields })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'save failed');

    ctPendingCache[c.itemId] = { fields };
    document.getElementById('mcontent').innerHTML = _modalMainHtml;
    ctRenderPendingBadge(idx);
  } catch (e) {
    if (status) status.textContent = "Couldn't save changes. Try again.";
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Changes'; }
  }
}

async function ctLoadScans(itemId, force) {
  const box = document.getElementById('ct-scans');
  if (!box) return;
  box.innerHTML = `<div style="font-size:12px;color:var(--tx3);padding:8px 0">${force ? 'Refreshing scans...' : 'Loading scans...'}</div>`;
  try {
    const res = await fetch(`${WORKER_URL}/scan?id=${encodeURIComponent(itemId)}${force ? '&debug=1' : ''}`);
    const data = await res.json();
    if (!document.getElementById('ct-scans')) return;
    const result = force ? (data.cachedResult || {}) : data;
    const shots = [result.front, result.back].filter(Boolean);
    if (!shots.length) {
      box.innerHTML = `<div style="font-size:12px;color:var(--tx3);padding:8px 0">No scans found</div>`;
      return;
    }
    box.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(${shots.length},1fr);gap:8px">
        ${shots.map(s => `
          <a href="${s.link}" target="_blank" rel="noopener" style="display:block">
            <img src="${s.thumb}" style="width:100%;border-radius:10px;border:1px solid var(--bdr2);display:block" loading="lazy">
          </a>
        `).join('')}
      </div>
    `;
  } catch (e) {
    box.innerHTML = `<div style="font-size:12px;color:var(--tx3);padding:8px 0">Couldn't load scans</div>`;
  }
}

function renderCardTracker() {
  const root = document.getElementById('cardtracker-root');
  ctLoadTags();
  ctLoadInHand();
  ctLoadPendingOverrides();

  root.innerHTML = `
    <div class="ct-wrap">
      <div class="ct-toolbar" style="padding:16px 16px 0">
        ${searchBarHTML('ct', 'Search name, set, year, item ID...')}
      </div>
      <div id="ct-body"></div>
    </div>
  `;

  wireSearchBar('ct', () => ctQuery, v => ctQuery = v, () => {
    const q = ctQuery.trim().toLowerCase();
    if (ctSearchActive) {
      ctPage = 1;
      ctRenderBody();
    } else {
      renderSearchDropdown('ct', q ? cards.filter(c => ctMatches(c, q)) : []);
    }
  }, () => {
    ctSearchActive = true;
    ctPage = 1;
    renderSearchDropdown('ct', []);
    ctRenderBody();
  });

  ctRenderBody();
}

function ctRenderBody() {
  const body = document.getElementById('ct-body');
  if (!body) return;

  const q = ctQuery.trim().toLowerCase();

  if (ctSearchActive) {
    const allMatches = ctSortMatches(
      (q ? cards.filter(c => ctMatches(c, q)) : cards.slice()).filter(ctFilterCategoryMatch)
    );
    const totalPages = Math.max(1, Math.ceil(allMatches.length / CT_PAGE_SIZE));
    if (ctPage > totalPages) ctPage = totalPages;
    const startIdx = (ctPage - 1) * CT_PAGE_SIZE;
    const matches = allMatches.slice(startIdx, startIdx + CT_PAGE_SIZE);
    ctFetchScansForPage(matches.map(c => c.itemId));
    body.innerHTML = `
      <div class="ct-body-row">
        <div class="ct-filter-sidebar" style="flex-shrink:0;width:240px">
          <div class="srow" style="margin:16px 0 16px 16px">
            <div id="ct-filter-sidebar-content"></div>
          </div>
        </div>
        <div class="ct-main-col">
          <div class="sort-chips" style="margin:16px 16px 0">
            ${CT_SORT_OPTS.map(o => `<button class="schip${ctSort===o.k?' on':''}" onclick="ctSetSort('${o.k}')">${o.l}${ctSort===o.k ? (ctSortDir==='asc' ? ' ↑' : ' ↓') : ''}</button>`).join('')}
          </div>
          <div class="ct-panel">
            <div class="ct-toolbar-row">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                <div class="srow-t" style="margin-bottom:0">${allMatches.length} result${allMatches.length===1?'':'s'}${totalPages > 1 ? ` · Page ${ctPage} of ${totalPages}` : ''}</div>
                <div style="display:flex;gap:6px">
                  ${ctShortcutsButtonHTML()}
                  ${ctFilterButtonHTML()}
                  ${ctViewToggleHTML()}
                </div>
              </div>
              ${ctShortcutsDropdownHTML()}
              ${ctPaginationHTML(ctPage, totalPages)}
            </div>
            <div class="ct-list-scroll">
              ${matches.length
                ? (ctViewMode === 'card'
                  ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">${matches.map(c => ctCardBoxHTML(c)).join('')}</div>`
                  : matches.map(c => ctListRowHTML(c)).join(''))
                : '<div style="font-size:12px;color:var(--tx3);padding:8px 0">No matching cards</div>'}
            </div>
          </div>
        </div>
      </div>
    `;
    ctRenderFilterContent();
    return;
  }
}
