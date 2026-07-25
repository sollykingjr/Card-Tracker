// ── Card Tracker ──────────────────────────────────────────────────────────────
let ctQuery = '';
let ctSearchActive = false;
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
let ctTagCache = {};
let ctTagsLoaded = false;

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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: c.itemId, tags: updated })
    });
  } catch (e) {}
}

async function ctFetchScansForPage(itemIds) {
  const needed = [...new Set(itemIds.filter(id => id && !(id in ctScanCache)))];
  if (!needed.length) return;
  try {
    const res = await fetch(`${WORKER_URL}/scan-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds: needed })
    });
    const data = await res.json();
    Object.assign(ctScanCache, data);
  } catch (e) {
    needed.forEach(id => { if (!(id in ctScanCache)) ctScanCache[id] = { front: null, back: null }; });
  }
  ctRenderBody();
}

function ctThumbHTML(itemId) {
  const scan = itemId ? ctScanCache[itemId] : null;
  const src = scan?.front?.thumb;
  if (src) {
    return `<img src="${src}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;border:1px solid var(--bdr2);flex-shrink:0" loading="lazy">`;
  }
  return `<div style="width:44px;height:44px;border-radius:8px;background:var(--surf2);border:1px solid var(--bdr);flex-shrink:0"></div>`;
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
  if (ctFilterSerial) n++;
  if (ctFilterGraded) n++;
  if (ctFilterTags.length) n++;
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

    <div style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Sold</div>
    <div style="display:flex;gap:6px;margin-bottom:20px">
      <button class="schip${ctFilterSold==='all'?' on':''}" onclick="ctSetFilterSold('all')" style="flex:1;padding:8px;font-size:11px">All</button>
      <button class="schip${ctFilterSold==='exclude'?' on':''}" onclick="ctSetFilterSold('exclude')" style="flex:1;padding:8px;font-size:11px">Exclude Sold</button>
      <button class="schip${ctFilterSold==='only'?' on':''}" onclick="ctSetFilterSold('only')" style="flex:1;padding:8px;font-size:11px">Sold Only</button>
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

    ${ctPickerHTML('sports', scope)}
    ${ctPickerHTML('years', scope)}
    ${ctPickerHTML('sets', scope)}
    ${ctPickerHTML('tags', scope)}
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
  ctFilterSerial = false;
  ctFilterGraded = false;
  ctFilterTags = [];
  ctFilterSports = [];
  ctFilterYears = [];
  ctFilterSets = [];
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
  return `
    <div class="recent-row" style="cursor:pointer;align-items:flex-start" onclick="ctOpenCard(${cards.indexOf(c)})">
      ${ctThumbHTML(c.itemId)}
      <div class="recent-info">
        <div style="font-size:14px;font-weight:700">${c.fullCard || '—'}</div>
        <div style="font-size:13px;color:var(--tx2);font-weight:500;margin-top:3px">${dateLine}</div>
      </div>
      <div style="display:flex;gap:16px;flex-shrink:0">
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--tx3);font-weight:600">Purchase Price</div>
          <div style="font-size:14px;color:var(--tx);font-weight:700">$${safeNum(c.purchasePrice).toFixed(2)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--tx3);font-weight:600">Sale Price</div>
          <div style="font-size:14px;color:var(--tx);font-weight:700">${c.salePrice ? '$' + safeNum(c.salePrice).toFixed(2) : 'Not sold'}</div>
        </div>
      </div>
    </div>`;
}

function ctCardBoxHTML(c) {
  const dateLine = ctDateLine(c);
  const scan = c.itemId ? ctScanCache[c.itemId] : null;
  const src = scan?.front?.thumb;
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

  if (ctFilterSports.length && !ctFilterSports.includes(c.sport)) return false;
  if (ctFilterYears.length && !ctFilterYears.includes(String(c.year))) return false;
  if (ctFilterSets.length && !ctFilterSets.includes(c.set)) return false;

  if (ctFilterTags.length) {
    const cardTags = ctGetTags(c);
    if (!ctFilterTags.every(t => cardTags.includes(t))) return false;
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

let ctOpenCardIdx = null;

function ctOpenCard(idx) {
  const c = cards[idx];
  if (!c) return;
  ctOpenCardIdx = idx;
  const date = c.transactionDate || c.datePurchased;
  document.getElementById('mcontent').innerHTML = `
    <div class="mname">${c.fullCard || c.playerDisplay || '—'}</div>
    <div class="msub">${[c.year, c.sport].filter(Boolean).join(' ')}${c.grade ? ' · Graded ' + c.grade : ''}</div>
    <div class="sgrid">
      <div class="scard"><div class="slbl">Item ID</div><div class="sval">${c.itemId || '—'}</div></div>
      <div class="scard"><div class="slbl">Serial No</div><div class="sval">${c.serialNo || '—'}</div></div>
      <div class="scard"><div class="slbl">Purchase price</div><div class="sval">$${safeNum(c.purchasePrice).toFixed(2)}</div></div>
      <div class="scard"><div class="slbl">Sale price</div><div class="sval">${c.salePrice ? '$'+safeNum(c.salePrice).toFixed(2) : '—'}</div></div>
      <div class="scard"><div class="slbl">Net profit</div><div class="sval"><span class="${safeNum(c.netProfit,true)>=0?'up':'dn'}">${safeNum(c.netProfit,true)>=0?'+':''}$${safeNum(c.netProfit,true).toFixed(2)}</span></div></div>
      <div class="scard"><div class="slbl">Date</div><div class="sval">${fmtShortDate(date)}</div></div>
    </div>
     <button onclick="ctCopyId('${(c.itemId||'').replace(/'/g,"\\'")}', this)" style="width:100%;height:40px;border:1px solid var(--acc-bdr);border-radius:10px;background:var(--acc-bg);color:var(--acc);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:4px">Copy Item ID</button>
    <div id="ct-tags" style="margin-top:14px"></div>
    <div id="ct-scans" style="margin-top:14px"></div>
  `;
  document.getElementById('mwrap').classList.add('on');
  ctRenderTags(idx);
  if (c.itemId) ctLoadScans(c.itemId);
}
async function ctLoadScans(itemId) {
  const box = document.getElementById('ct-scans');
  if (!box) return;
  box.innerHTML = `<div style="font-size:12px;color:var(--tx3);padding:8px 0">Loading scans...</div>`;
  try {
    const res = await fetch(`${WORKER_URL}/scan?id=${encodeURIComponent(itemId)}`);
    const data = await res.json();
    if (!document.getElementById('ct-scans')) return;
    const shots = [data.front, data.back].filter(Boolean);
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

  root.innerHTML = `
    <div class="sr-wrap">
      <div style="padding:16px 16px 0">
        ${searchBarHTML('ct', 'Search name, set, year, item ID...')}
      </div>
      <div id="ct-body"></div>
    </div>
  `;

  wireSearchBar('ct', () => ctQuery, v => ctQuery = v, () => {
    const q = ctQuery.trim().toLowerCase();
    if (ctSearchActive) {
      if (!q) ctSearchActive = false;
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
      <div style="display:flex;gap:16px;align-items:flex-start">
        <div class="ct-filter-sidebar" style="flex-shrink:0;width:240px">
          <div class="srow" style="margin:16px 0 16px 16px">
            <div id="ct-filter-sidebar-content"></div>
          </div>
        </div>
        <div style="flex:1;min-width:0">
          <div class="sort-chips" style="margin:16px 16px 0">
            ${CT_SORT_OPTS.map(o => `<button class="schip${ctSort===o.k?' on':''}" onclick="ctSetSort('${o.k}')">${o.l}${ctSort===o.k ? (ctSortDir==='asc' ? ' ↑' : ' ↓') : ''}</button>`).join('')}
          </div>
          <div class="srow" style="margin:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
              <div class="srow-t">${allMatches.length} result${allMatches.length===1?'':'s'}${totalPages > 1 ? ` · Page ${ctPage} of ${totalPages}` : ''}</div>
              <div style="display:flex;gap:6px">
                ${ctFilterButtonHTML()}
                ${ctViewToggleHTML()}
              </div>
            </div>
            ${ctPaginationHTML(ctPage, totalPages)}
            ${matches.length
              ? (ctViewMode === 'card'
                ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px">${matches.map(c => ctCardBoxHTML(c)).join('')}</div>`
                : matches.map(c => ctListRowHTML(c)).join(''))
              : '<div style="font-size:12px;color:var(--tx3);padding:8px 0">No matching cards</div>'}
            ${ctPaginationHTML(ctPage, totalPages)}
          </div>
        </div>
      </div>
    `;
    ctRenderFilterContent();
    return;
  }

  const sold  = cards.filter(c =>  c.salePrice);
  const purchased = cards.filter(c => c.purchasePrice);
  const owned = purchased.filter(c => !c.salePrice);
  const totalPurchasesCount = purchased.length;
  const totalInvested     = purchased.reduce((s,c) => s + safeNum(c.purchasePrice), 0);
  const totalRecovered    = sold.reduce((s,c) => s + safeNum(c.salePrice, true) - safeNum(c.saleFees, true), 0);
  const realizedNetProfit = cards.reduce((s,c) => s + safeNum(c.netProfit, true), 0);

  const ownedCostBasis  = owned.reduce((s,c) => s + safeNum(c.purchasePrice), 0);
  const soldCostBasis   = sold.reduce((s,c) => s + safeNum(c.purchasePrice), 0);
  const realizedPnL     = sold.reduce((s,c) => s + safeNum(c.netProfit, true), 0);
  const sellThroughRate = totalPurchasesCount ? (sold.length / totalPurchasesCount * 100) : 0;
  const wins            = sold.filter(c => safeNum(c.netProfit, true) > 0).length;
  const winRate         = sold.length ? (wins / sold.length * 100) : 0;
  const avgROI          = soldCostBasis > 0 ? (realizedPnL / soldCostBasis * 100) : 0;

  const flipCutoff = Date.now() - 30*24*60*60*1000;
  const recentSold = sold.filter(c => parseDate(c.transactionDate || c.datePurchased) >= flipCutoff);
  const bestFlip  = recentSold.reduce((best,c)  => (!best  || safeNum(c.netProfit,true) > safeNum(best.netProfit,true))  ? c : best,  null);
  const worstFlip = recentSold.reduce((worst,c) => (!worst || safeNum(c.netProfit,true) < safeNum(worst.netProfit,true)) ? c : worst, null);

  const recent = [...cards]
    .filter(c => c.datePurchased || c.transactionDate)
    .sort((a,b) => parseDate(b.transactionDate || b.datePurchased) - parseDate(a.transactionDate || a.datePurchased))
    .slice(0, 8);

  const heroHtml = `
    <div class="srow" style="margin:16px;display:flex;gap:16px;text-align:center">
      <div style="flex:1">
        <div class="sc-l">Net position</div>
        <div style="font-size:28px;font-weight:700;margin-top:6px"><span class="${realizedNetProfit>=0?'up':'dn'}">${realizedNetProfit>=0?'+':''}$${realizedNetProfit.toFixed(2)}</span></div>
      </div>
      <div style="flex:1;border-left:1px solid var(--bdr);padding-left:16px">
        <div class="sc-l">Realized P&amp;L</div>
        <div style="font-size:28px;font-weight:700;margin-top:6px"><span class="${realizedPnL>=0?'up':'dn'}">${realizedPnL>=0?'+':''}$${realizedPnL.toFixed(2)}</span></div>
      </div>
    </div>
  `;

  const purchasesHtml = `
    <div class="srow" style="margin:16px">
      <div class="srow-t">Purchases</div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;text-align:center;margin-top:8px">
        <div><div class="sc-l">Total purchases</div><div class="sc-v">${totalPurchasesCount}</div></div>
        <div><div class="sc-l">Purchases</div><div class="sc-v">$${totalInvested.toFixed(2)}</div></div>
        <div><div class="sc-l">Cards owned</div><div class="sc-v">${owned.length}</div></div>
        <div><div class="sc-l">Owned cost basis</div><div class="sc-v">$${ownedCostBasis.toFixed(2)}</div></div>
      </div>
    </div>
  `;

  const salesHtml = `
    <div class="srow" style="margin:16px">
      <div class="srow-t">Sales</div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;text-align:center;margin-top:8px">
        <div><div class="sc-l">Total sales</div><div class="sc-v">${sold.length}</div></div>
        <div><div class="sc-l">Net sales</div><div class="sc-v">$${totalRecovered.toFixed(2)}</div></div>
        <div><div class="sc-l">Sell-through</div><div class="sc-v">${sellThroughRate.toFixed(1)}%</div></div>
        <div><div class="sc-l">Win rate</div><div class="sc-v">${winRate.toFixed(1)}%</div></div>
        <div><div class="sc-l">Avg ROI</div><div class="sc-v"><span class="${avgROI>=0?'up':'dn'}">${avgROI>=0?'+':''}${avgROI.toFixed(1)}%</span></div></div>
      </div>
    </div>
  `;

  const flipHtml = `
    <div class="srow" style="margin:16px">
      <div class="srow-t">Best &amp; worst flip (last 30 days)</div>
      <div class="recent-row">
        <div class="recent-info"><div class="rc-name">${bestFlip ? (bestFlip.fullCard || '—') : 'No sales in the last 30 days'}</div><div class="rc-date">Best flip</div></div>
        ${bestFlip ? `<div class="recent-sale"><span class="up">+$${safeNum(bestFlip.netProfit, true).toFixed(2)}</span></div>` : ''}
      </div>
      <div class="recent-row">
        <div class="recent-info"><div class="rc-name">${worstFlip ? (worstFlip.fullCard || '—') : 'No sales in the last 30 days'}</div><div class="rc-date">Worst flip</div></div>
        ${worstFlip ? `<div class="recent-sale"><span class="${safeNum(worstFlip.netProfit,true)>=0?'up':'dn'}">${safeNum(worstFlip.netProfit,true)>=0?'+':''}$${safeNum(worstFlip.netProfit, true).toFixed(2)}</span></div>` : ''}
      </div>
    </div>
  `;

  const recentHtml = `
    <div class="srow" style="margin:16px">
      <div class="srow-t">Recent activity</div>
      ${recent.length ? recent.map(c => {
        const isSold = !!c.salePrice;
        const date = fmtShortDate(c.transactionDate || c.datePurchased);
        return `<div class="recent-row">
          <div class="recent-info"><div class="rc-name">${c.fullCard || '—'}</div><div class="rc-date">${date}${isSold ? ' · Sold' : ' · Purchased'}</div></div>
          <div class="${isSold ? 'recent-sale' : 'recent-price'}">${isSold ? `$${safeNum(c.salePrice).toFixed(2)}` : `$${safeNum(c.purchasePrice).toFixed(2)}`}</div>
        </div>`;
      }).join('') : '<div style="font-size:12px;color:var(--tx3);padding:4px 0">No activity yet</div>'}
    </div>
  `;

  body.innerHTML = `${heroHtml}${purchasesHtml}${salesHtml}${flipHtml}${recentHtml}`;
}
