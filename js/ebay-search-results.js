// ── Search Results ────────────────────────────────────────────────────────────
const WORKER = 'https://card-app.maxcsolomon.workers.dev';

let srData = { groups: [], searches: [] };

async function initSearchResults() {
  const root = document.getElementById('sr-root');
  root.innerHTML = `
    <div class="sr-wrap">
      <div class="sr-header">
        <h2 class="sr-title">Search Results</h2>
        <div class="sr-header-btns">
          <button class="sr-add-group-btn" id="sr-add-group-btn">+ Group</button>
          <button class="sr-add-btn" id="sr-add-btn">+ Search</button>
        </div>
      </div>
      <div id="sr-list"></div>
      <div id="sr-form-wrap" style="display:none">
        <div class="sr-form">
          <div class="sr-form-title" id="sr-form-title">New Search Alert</div>
          <input class="sr-input" id="sr-label" placeholder="Label (e.g. Scott Brosius)">
          <div class="sr-form-row">
            <div class="sr-form-label">Group</div>
            <select class="sr-select" id="sr-group-select">
              <option value="">Standalone</option>
            </select>
          </div>
          <input class="sr-input" id="sr-query" placeholder="eBay search query (e.g. scott brosius)">
          <div class="sr-form-section">Seller</div>
          <div class="sr-seller-row">
            <div class="sr-chip-row" id="sr-seller-mode-chips">
              <button class="sr-chip-btn on" data-val="exclude">Exclude</button>
              <button class="sr-chip-btn" data-val="include">Include</button>
            </div>
            <input class="sr-input sr-input-inline" id="sr-seller" placeholder="Seller username (optional)">
          <div class="sr-chip-row" id="sr-fav-sellers-chips"></div>
          </div>
          <div class="sr-form-section">Filters</div>
          <div class="sr-form-row">
            <div class="sr-form-label">Sport</div>
            <div class="sr-chip-row" id="sr-sport-chips">
              <button class="sr-chip-btn on" data-val="">All</button>
              <button class="sr-chip-btn" data-val="Baseball">Baseball</button>
              <button class="sr-chip-btn" data-val="Basketball">Basketball</button>
              <button class="sr-chip-btn" data-val="Football">Football</button>
              <button class="sr-chip-btn" data-val="Hockey">Hockey</button>
            </div>
          </div>
          <div class="sr-form-row">
            <div class="sr-form-label">Condition</div>
            <div class="sr-chip-row" id="sr-condition-chips">
              <button class="sr-chip-btn on" data-val="">Any</button>
              <button class="sr-chip-btn" data-val="Graded">Graded</button>
              <button class="sr-chip-btn" data-val="Ungraded">Ungraded</button>
            </div>
          </div>
          <div class="sr-form-row">
            <div class="sr-form-label">Serial Numbered</div>
            <label class="sr-toggle">
              <input type="checkbox" id="sr-serial">
              <span class="sr-toggle-slider"></span>
            </label>
          </div>
          <div class="sr-form-section">Price</div>
          <div class="sr-form-row">
            <div class="sr-form-label">Min Price</div>
            <input class="sr-input sr-input-inline" id="sr-min-price" placeholder="e.g. 10" type="number" min="0">
          </div>
          <div class="sr-form-row">
            <div class="sr-form-label">Max Price</div>
            <input class="sr-input sr-input-inline" id="sr-max-price" placeholder="e.g. 500" type="number" min="0">
          </div>
          <div class="sr-form-section">Listing</div>
          <div class="sr-form-row">
            <div class="sr-form-label">Type</div>
            <div class="sr-chip-row" id="sr-type-chips">
              <button class="sr-chip-btn on" data-val="BOTH">Both</button>
              <button class="sr-chip-btn" data-val="AUCTION">Auction</button>
              <button class="sr-chip-btn" data-val="FIXED_PRICE">BIN</button>
            </div>
          </div>
          <div class="sr-form-row" id="sr-schedule-row">
            <div class="sr-form-label">Schedule</div>
            <div class="sr-chip-row" id="sr-schedule-chips">
              <button class="sr-chip-btn on" data-val="hourly">Hourly</button>
              <button class="sr-chip-btn" data-val="nightly">Nightly</button>
            </div>
          </div>
          <div class="sr-form-row" id="sr-notify-row">
            <div class="sr-form-label">Instant Notify</div>
            <label class="sr-toggle">
              <input type="checkbox" id="sr-notify" checked>
              <span class="sr-toggle-slider"></span>
            </label>
          </div>
          <div id="sr-keywords-wrap">
            <input class="sr-input" id="sr-keywords" placeholder="Notification keywords, comma separated (e.g. 2005,2006,psa)">
          </div>
          <div class="sr-form-section">Include Keywords</div>
          <div class="sr-and-or" id="sr-include-logic">
            <button class="sr-chip-btn on" data-val="OR">OR</button>
            <button class="sr-chip-btn" data-val="AND">AND</button>
          </div>
          <input class="sr-input" id="sr-include-keywords" placeholder="e.g. topps,bowman">
          <div class="sr-form-section">Exclude Keywords</div>
          <input class="sr-input" id="sr-exclude-keywords" placeholder="e.g. relic,auto,rookie">
          <div class="sr-form-btns">
            <button class="sr-cancel-btn" id="sr-cancel-btn">Cancel</button>
            <button class="sr-save-btn" id="sr-save-btn">Save</button>
          </div>
        </div>
      </div>
      <div id="sr-group-form-wrap" style="display:none">
        <div class="sr-form">
          <div class="sr-form-title" id="sr-group-form-title">New Group</div>
          <input class="sr-input" id="sr-group-label" placeholder="Group name (e.g. DC Sports Baseball)">
          <div class="sr-form-row">
            <div class="sr-form-label">Schedule</div>
            <div class="sr-chip-row" id="sr-group-schedule-chips">
              <button class="sr-chip-btn on" data-val="hourly">Hourly</button>
              <button class="sr-chip-btn" data-val="nightly">Nightly</button>
            </div>
          </div>
          <div class="sr-form-row">
            <div class="sr-form-label">Notify</div>
            <label class="sr-toggle">
              <input type="checkbox" id="sr-group-notify" checked>
              <span class="sr-toggle-slider"></span>
            </label>
          </div>
          <div class="sr-form-btns">
            <button class="sr-cancel-btn" id="sr-group-cancel-btn">Cancel</button>
            <button class="sr-save-btn" id="sr-group-save-btn">Save</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('sr-add-btn').onclick = () => openSearchForm();
  document.getElementById('sr-add-group-btn').onclick = () => openGroupForm();
  document.getElementById('sr-cancel-btn').onclick = () => closeSearchForm();
  document.getElementById('sr-group-cancel-btn').onclick = () => closeGroupForm();
  document.getElementById('sr-save-btn').onclick = saveSearch;
  document.getElementById('sr-group-save-btn').onclick = saveGroup;

  await loadData();

  if (window._pendingDigest) {
    const key = window._pendingDigest;
    const label = key.replace('_digest', '').replace(/_/g, ' ').trim();
    window._pendingDigest = null;
    showDigest(key, label, false);
  }
}

// ── Data ──────────────────────────────────────────────────────────────────────
async function loadData() {
  try {
    const res = await fetch(`${WORKER}/search-alerts`);
    srData = await res.json();
    if (!srData.groups) srData.groups = [];
    if (!srData.searches) srData.searches = [];
    renderList();
  } catch(e) {
    document.getElementById('sr-list').innerHTML = '<div class="sr-empty">Failed to load.</div>';
  }
}

async function saveData() {
  const res = await fetch(`${WORKER}/search-alerts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groups: srData.groups, searches: srData.searches })
  });
  const result = await res.json();
  console.log('saveData result:', result, 'groups:', srData.groups.length, 'searches:', srData.searches.length);
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderList() {
  const list = document.getElementById('sr-list');
  if (!list) return;
  let html = '';

  // Groups
  for (const group of srData.groups) {
    const groupSearches = srData.searches.filter(s => s.groupId === group.id);
    html += `
      <div class="sr-group-card" id="srg-${group.id}">
        <div class="sr-card-header">
          <div class="sr-group-label">${group.label}</div>
          <div class="sr-header-right">
            <span class="sr-schedule-badge">${group.schedule || 'hourly'}</span>
            <div class="sr-menu-wrap">
              <button class="sr-menu-btn" data-id="${group.id}" data-type="group">···</button>
              <div class="sr-menu-dropdown" id="srm-${group.id}" style="display:none">
                <button class="sr-menu-item sr-menu-edit-group" data-id="${group.id}">Edit</button>
                <button class="sr-menu-item sr-menu-add-search-to-group" data-id="${group.id}">Add Search</button>
                <button class="sr-menu-item sr-menu-delete sr-menu-delete-group" data-id="${group.id}">Delete Group</button>
              </div>
            </div>
          </div>
        </div>
        <div class="sr-group-searches">
          ${groupSearches.length === 0 ? '<div class="sr-empty-group">No searches yet</div>' : groupSearches.map(s => `
            <div class="sr-search-row">
              <div class="sr-search-row-label">🔍 ${s.label}</div>
              <div class="sr-menu-wrap">
                <button class="sr-menu-btn sr-menu-btn-sm" data-id="${s.id}" data-type="search">···</button>
                <div class="sr-menu-dropdown" id="srm-${s.id}" style="display:none">
                  <button class="sr-menu-item sr-menu-edit-search" data-id="${s.id}">Edit</button>
                  <button class="sr-menu-item sr-menu-delete sr-menu-delete-search" data-id="${s.id}">Delete</button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="sr-card-links">
          <button class="sr-run-btn" data-digestkey="${group.digestKey}" data-label="${group.label}">▶ Run</button>
          <button class="sr-link" onclick="showDigest('${group.digestKey}', '${group.label}', false)">Today →</button>
          <button class="sr-link" onclick="showDigest('${group.digestKey}', '${group.label}', true)">7-Day →</button>
        </div>
      </div>
    `;
  }

  // Standalone searches
  const standalone = srData.searches.filter(s => !s.groupId);
  for (const s of standalone) {
    html += `
      <div class="sr-card">
        <div class="sr-card-header">
          <div class="sr-card-label">${s.label}</div>
          <div class="sr-menu-wrap">
            <button class="sr-menu-btn" data-id="${s.id}" data-type="search">···</button>
            <div class="sr-menu-dropdown" id="srm-${s.id}" style="display:none">
              <button class="sr-menu-item sr-menu-edit-search" data-id="${s.id}">Edit</button>
              <button class="sr-menu-item sr-menu-delete sr-menu-delete-search" data-id="${s.id}">Delete</button>
            </div>
          </div>
        </div>
        <div class="sr-card-query">🔍 ${s.query || ''}</div>
        <div class="sr-card-keywords">🔔 ${(s.priorityKeywords || []).join(', ')}</div>
        <div class="sr-card-links">
          <button class="sr-run-btn" data-digestkey="${s.digestKey}" data-label="${s.label}">▶ Run</button>
          <button class="sr-link" onclick="showDigest('${s.digestKey}', '${s.label}', false)">Today →</button>
          <button class="sr-link" onclick="showDigest('${s.digestKey}', '${s.label}', true)">7-Day →</button>
        </div>
      </div>
    `;
  }

  if (srData.groups.length === 0 && standalone.length === 0) {
    html = '<div class="sr-empty">No searches yet. Add a group or standalone search above.</div>';
  }

  list.innerHTML = html;
  wireListEvents();
}

function wireListEvents() {
  // Close menus on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.sr-menu-wrap')) {
      document.querySelectorAll('.sr-menu-dropdown').forEach(d => d.style.display = 'none');
    }
  });

  // Menu buttons
  document.querySelectorAll('.sr-menu-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const dropdown = document.getElementById(`srm-${id}`);
      const isOpen = dropdown.style.display === 'block';
      document.querySelectorAll('.sr-menu-dropdown').forEach(d => d.style.display = 'none');
      dropdown.style.display = isOpen ? 'none' : 'block';
    };
  });

  // Edit group
  document.querySelectorAll('.sr-menu-edit-group').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const group = srData.groups.find(g => g.id === btn.dataset.id);
      if (!group) return;
      document.querySelectorAll('.sr-menu-dropdown').forEach(d => d.style.display = 'none');
      openGroupForm(group);
    };
  });

  // Add search to group
  document.querySelectorAll('.sr-menu-add-search-to-group').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      document.querySelectorAll('.sr-menu-dropdown').forEach(d => d.style.display = 'none');
      openSearchForm(null, btn.dataset.id);
    };
  });

  // Delete group
  document.querySelectorAll('.sr-menu-delete-group').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const group = srData.groups.find(g => g.id === btn.dataset.id);
      if (!confirm(`Delete group "${group.label}" and all its searches?`)) return;
      const deleteKeys = [group.digestKey, group.digestKey + '_archive', group.digestKey + '_hourly'];
      srData.groups = srData.groups.filter(g => g.id !== group.id);
      srData.searches = srData.searches.filter(s => s.groupId !== group.id);
      await fetch(`${WORKER}/search-alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: srData.groups, searches: srData.searches, deleteKeys })
      });
      renderList();
    };
  });

  // Edit search
  document.querySelectorAll('.sr-menu-edit-search').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const search = srData.searches.find(s => s.id === btn.dataset.id);
      if (!search) return;
      document.querySelectorAll('.sr-menu-dropdown').forEach(d => d.style.display = 'none');
      openSearchForm(search);
    };
  });

  // Delete search
  document.querySelectorAll('.sr-menu-delete-search').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const search = srData.searches.find(s => s.id === btn.dataset.id);
      if (!confirm(`Delete "${search.label}"?`)) return;
      const deleteKeys = [search.digestKey, search.digestKey + '_archive', search.digestKey + '_hourly'];
      srData.searches = srData.searches.filter(s => s.id !== search.id);
      await fetch(`${WORKER}/search-alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: srData.groups, searches: srData.searches, deleteKeys })
      });
      renderList();
    };
  });

  // Run buttons
  document.querySelectorAll('.sr-run-btn').forEach(btn => {
    btn.onclick = async () => {
      const digestKey = btn.dataset.digestkey;
      const label = btn.dataset.label;
      btn.textContent = '⏳ Running...';
      btn.disabled = true;
      try {
        await fetch(`${WORKER}/run-search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ digestKey })
        });
        btn.textContent = '▶ Run';
        btn.disabled = false;
        showDigest(digestKey, label, false);
      } catch(e) {
        btn.textContent = '▶ Run';
        btn.disabled = false;
      }
    };
  });
}

// ── Group Form ────────────────────────────────────────────────────────────────
function openGroupForm(group) {
  document.getElementById('sr-group-form-wrap').style.display = 'block';
  document.getElementById('sr-form-wrap').style.display = 'none';
  document.getElementById('sr-group-form-title').textContent = group ? 'Edit Group' : 'New Group';
  wireChips('sr-group-schedule-chips');

  if (group) {
    document.getElementById('sr-group-label').value = group.label || '';
    setChip('sr-group-schedule-chips', group.schedule || 'hourly');
    document.getElementById('sr-group-notify').checked = group.notify !== false;
    document.getElementById('sr-group-save-btn').onclick = async () => {
      group.label = document.getElementById('sr-group-label').value.trim();
      group.schedule = getChipVal('sr-group-schedule-chips') || 'hourly';
      group.notify = document.getElementById('sr-group-notify').checked;
      await saveData();
      closeGroupForm();
      renderList();
    };
  } else {
    document.getElementById('sr-group-label').value = '';
    setChip('sr-group-schedule-chips', 'hourly');
    document.getElementById('sr-group-notify').checked = true;
    document.getElementById('sr-group-save-btn').onclick = saveGroup;
  }
}

function closeGroupForm() {
  document.getElementById('sr-group-form-wrap').style.display = 'none';
  document.getElementById('sr-group-label').value = '';
  document.getElementById('sr-group-save-btn').onclick = saveGroup;
}

async function saveGroup() {
  const label = document.getElementById('sr-group-label').value.trim();
  if (!label) return;
  const id = 'grp_' + Date.now();
  const digestKey = label.toLowerCase().replace(/\s+/g, '_') + '_digest';
  srData.groups.push({
    id, label, digestKey,
    schedule: getChipVal('sr-group-schedule-chips') || 'hourly',
    notify: document.getElementById('sr-group-notify').checked
  });
  await saveData();
  closeGroupForm();
  renderList();
}

// ── Search Form ───────────────────────────────────────────────────────────────
function openSearchForm(search, presetGroupId) {
  document.getElementById('sr-form-wrap').style.display = 'block';
  document.getElementById('sr-group-form-wrap').style.display = 'none';
  document.getElementById('sr-form-title').textContent = search ? 'Edit Search' : 'New Search Alert';
  wireForm();

  // Load and render fav sellers
  fetch(`${WORKER}/sb-data`).then(r => r.json()).then(data => {
    const favs = data.favSellers || [];
    const container = document.getElementById('sr-fav-sellers-chips');
    if (!container) return;
    container.innerHTML = favs.map(s => `
      <button class="sr-chip-btn sr-fav-seller-chip" data-seller="${s}">${s}</button>
    `).join('');
    container.querySelectorAll('.sr-fav-seller-chip').forEach(btn => {
      btn.onclick = () => {
        const field = document.getElementById('sr-seller');
        const current = field.value.trim();
        field.value = current ? `${current},${btn.dataset.seller}` : btn.dataset.seller;
      };
    });
  });

  // Populate group dropdown
  const sel = document.getElementById('sr-group-select');
  sel.innerHTML = '<option value="">Standalone</option>';
  srData.groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.label;
    sel.appendChild(opt);
  });

  if (search) {
    document.getElementById('sr-label').value = search.label || '';
    document.getElementById('sr-query').value = search.query || '';
    document.getElementById('sr-seller').value = search.seller || '';
    document.getElementById('sr-keywords').value = (search.priorityKeywords || []).join(', ');
    document.getElementById('sr-serial').checked = search.serial || false;
    document.getElementById('sr-notify').checked = search.notify !== false;
    document.getElementById('sr-keywords-wrap').style.display = search.notify !== false ? 'block' : 'none';
    document.getElementById('sr-min-price').value = search.minPrice || '';
    document.getElementById('sr-max-price').value = search.maxPrice || '';
    document.getElementById('sr-include-keywords').value = search.includeKeywords || '';
    document.getElementById('sr-exclude-keywords').value = search.excludeKeywords || '';
    sel.value = search.groupId || '';
    setChip('sr-seller-mode-chips', search.sellerMode || 'exclude');
    setChip('sr-sport-chips', search.sport || '');
    setChip('sr-condition-chips', search.condition || '');
    setChip('sr-type-chips', search.listingType || 'BOTH');
    setChip('sr-schedule-chips', search.schedule || 'hourly');
    setChip('sr-include-logic', search.includeLogic || 'OR');

    // Show/hide schedule+notify based on group
    updateScheduleNotifyVisibility(search.groupId);

    document.getElementById('sr-save-btn').onclick = async () => {
      search.label = document.getElementById('sr-label').value.trim();
      search.query = document.getElementById('sr-query').value.trim();
      search.seller = document.getElementById('sr-seller').value.trim();
      search.groupId = document.getElementById('sr-group-select').value || null;
      search.sellerMode = getChipVal('sr-seller-mode-chips') || 'exclude';
      search.sport = getChipVal('sr-sport-chips');
      search.condition = getChipVal('sr-condition-chips');
      search.serial = document.getElementById('sr-serial').checked;
      search.listingType = getChipVal('sr-type-chips') || 'BOTH';
      search.schedule = search.groupId ? null : (getChipVal('sr-schedule-chips') || 'hourly');
      search.notify = search.groupId ? null : document.getElementById('sr-notify').checked;
      search.priorityKeywords = document.getElementById('sr-keywords').value.trim().split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
      search.minPrice = document.getElementById('sr-min-price').value || '';
      search.maxPrice = document.getElementById('sr-max-price').value || '';
      search.includeKeywords = document.getElementById('sr-include-keywords').value || '';
      search.includeLogic = getChipVal('sr-include-logic') || 'OR';
      search.excludeKeywords = document.getElementById('sr-exclude-keywords').value || '';
      await saveData();
      closeSearchForm();
      renderList();
    };
  } else {
    clearSearchForm();
    if (presetGroupId) {
      sel.value = presetGroupId;
      updateScheduleNotifyVisibility(presetGroupId);
    }
    document.getElementById('sr-save-btn').onclick = saveSearch;
  }

  // Update visibility when group changes
  sel.onchange = () => updateScheduleNotifyVisibility(sel.value);
}

function updateScheduleNotifyVisibility(groupId) {
  const hasGroup = !!groupId;
  document.getElementById('sr-schedule-row').style.display = hasGroup ? 'none' : '';
  document.getElementById('sr-notify-row').style.display = hasGroup ? 'none' : '';
  document.getElementById('sr-keywords-wrap').style.display = hasGroup ? 'none' : (document.getElementById('sr-notify').checked ? 'block' : 'none');
}

function closeSearchForm() {
  document.getElementById('sr-form-wrap').style.display = 'none';
  clearSearchForm();
  document.getElementById('sr-save-btn').onclick = saveSearch;
}

function clearSearchForm() {
  document.getElementById('sr-label').value = '';
  document.getElementById('sr-query').value = '';
  document.getElementById('sr-seller').value = '';
  document.getElementById('sr-keywords').value = '';
  document.getElementById('sr-serial').checked = false;
  document.getElementById('sr-notify').checked = true;
  document.getElementById('sr-min-price').value = '';
  document.getElementById('sr-max-price').value = '';
  document.getElementById('sr-include-keywords').value = '';
  document.getElementById('sr-exclude-keywords').value = '';
  document.getElementById('sr-group-select').value = '';
  document.querySelectorAll('#sr-seller-mode-chips .sr-chip-btn').forEach((b,i) => b.classList.toggle('on', i===0));
  document.querySelectorAll('#sr-sport-chips .sr-chip-btn').forEach((b,i) => b.classList.toggle('on', i===0));
  document.querySelectorAll('#sr-condition-chips .sr-chip-btn').forEach((b,i) => b.classList.toggle('on', i===0));
  document.querySelectorAll('#sr-type-chips .sr-chip-btn').forEach((b,i) => b.classList.toggle('on', i===0));
  document.querySelectorAll('#sr-schedule-chips .sr-chip-btn').forEach((b,i) => b.classList.toggle('on', i===0));
  document.querySelectorAll('#sr-include-logic .sr-chip-btn').forEach((b,i) => b.classList.toggle('on', i===0));
  document.getElementById('sr-schedule-row').style.display = '';
  document.getElementById('sr-notify-row').style.display = '';
  document.getElementById('sr-keywords-wrap').style.display = 'block';
}

async function saveSearch() {
  const label = document.getElementById('sr-label').value.trim();
  const query = document.getElementById('sr-query').value.trim();
  const seller = document.getElementById('sr-seller').value.trim();
  if (!label || (!query && !seller)) return;

  const groupId = document.getElementById('sr-group-select').value || null;
  const id = 'src_' + Date.now();
  const digestKey = label.toLowerCase().replace(/\s+/g, '_') + '_digest';
  const keywords = document.getElementById('sr-keywords').value.trim();

  srData.searches.push({
    id, label, query, seller, groupId, digestKey,
    sellerMode: getChipVal('sr-seller-mode-chips') || 'exclude',
    sport: getChipVal('sr-sport-chips'),
    condition: getChipVal('sr-condition-chips'),
    serial: document.getElementById('sr-serial').checked,
    listingType: getChipVal('sr-type-chips') || 'BOTH',
    schedule: groupId ? null : (getChipVal('sr-schedule-chips') || 'hourly'),
    notify: groupId ? null : document.getElementById('sr-notify').checked,
    priorityKeywords: keywords ? keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean) : [],
    minPrice: document.getElementById('sr-min-price').value || '',
    maxPrice: document.getElementById('sr-max-price').value || '',
    includeKeywords: document.getElementById('sr-include-keywords').value || '',
    includeLogic: getChipVal('sr-include-logic') || 'OR',
    excludeKeywords: document.getElementById('sr-exclude-keywords').value || ''
  });

  await saveData();
  closeSearchForm();
  renderList();
}

// ── Chip helpers ──────────────────────────────────────────────────────────────
function getChipVal(groupId) {
  return document.querySelector(`#${groupId} .sr-chip-btn.on`)?.dataset.val || '';
}

function wireChips(groupId) {
  document.querySelectorAll(`#${groupId} .sr-chip-btn`).forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(`#${groupId} .sr-chip-btn`).forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
    };
  });
}

function setChip(groupId, val) {
  document.querySelectorAll(`#${groupId} .sr-chip-btn`).forEach(b => {
    b.classList.toggle('on', b.dataset.val === val);
  });
}

function wireForm() {
  wireChips('sr-seller-mode-chips');
  wireChips('sr-sport-chips');
  wireChips('sr-condition-chips');
  wireChips('sr-type-chips');
  wireChips('sr-schedule-chips');
  wireChips('sr-include-logic');
  document.getElementById('sr-notify').onchange = function() {
    document.getElementById('sr-keywords-wrap').style.display = this.checked ? 'block' : 'none';
  };
}

// ── Digest View ───────────────────────────────────────────────────────────────
async function showDigest(digestKey, label, isArchive, overrideKey) {
  const root = document.getElementById('sr-root');
  const key = overrideKey || (isArchive ? digestKey + '_archive' : digestKey);
  let sortMode = 'newest';
  let filterText = '';
  let showAll = false;

  root.innerHTML = `
    <div class="sr-wrap">
      <div class="sr-digest-header">
        <button class="sr-back-btn" id="sr-back-btn">← Back</button>
        <div class="sr-digest-title">${label} — ${isArchive ? '7-Day Archive' : "Today's Listings"}</div>
        <button class="sr-mark-seen-btn" id="sr-mark-seen-btn">Mark Seen</button>
      </div>
      <div class="sr-digest-controls">
        <input class="sr-search-input" id="sr-digest-search" placeholder="Search titles...">
        <div class="sr-chip-row" id="sr-sort-chips">
          <button class="sr-chip-btn on" data-val="newest">Newest</button>
          <button class="sr-chip-btn" data-val="ending">Ending Soon</button>
        </div>
        <button class="sr-chip-btn" id="sr-show-all-btn">Show All</button>
      </div>
      <div id="sr-digest-list"><div class="sr-loading">Loading...</div></div>
    </div>
  `;

  document.getElementById('sr-back-btn').onclick = () => initSearchResults();
  document.getElementById('sr-show-all-btn').onclick = () => {
    showAll = !showAll;
    document.getElementById('sr-show-all-btn').classList.toggle('on', showAll);
    document.getElementById('sr-show-all-btn').textContent = showAll ? 'Unseen Only' : 'Show All';
    renderDigestItems(allItems, sortMode, filterText, key, showAll);
  };

  document.getElementById('sr-mark-seen-btn').onclick = async () => {
    await fetch(`${WORKER}/mark-seen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    allItems = allItems.map(item => ({ ...item, seen: true }));
    renderDigestItems(allItems, sortMode, filterText, key, showAll);
  };
  document.getElementById('sr-reset-btn').onclick = async () => {
    if (!confirm('Clear all listings from this view?')) return;
    await fetch(`${WORKER}/search-alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteKeys: [key] })
    });
    document.getElementById('sr-digest-list').innerHTML = '<div class="sr-empty">Cleared.</div>';
  };

  wireChips('sr-sort-chips');
  document.getElementById('sr-digest-search').oninput = (e) => {
    filterText = e.target.value.toLowerCase();
    renderDigestItems(allItems, sortMode, filterText, key, showAll);
  };
  document.querySelectorAll('#sr-sort-chips .sr-chip-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#sr-sort-chips .sr-chip-btn').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      sortMode = btn.dataset.val;
      renderDigestItems(allItems, sortMode, filterText, key, showAll);
    };
  });

  let allItems = [];
  try {
    const res = await fetch(`${WORKER}/player-digest-json?key=${key}`);
    const data = await res.json();
    allItems = data.items || [];
    renderDigestItems(allItems, sortMode, filterText, key, showAll);
  } catch(e) {
    document.getElementById('sr-digest-list').innerHTML = '<div class="sr-empty">Failed to load listings.</div>';
  }
}

function renderDigestItems(allItems, sortMode, filterText, key, showAll = false) {
  const list = document.getElementById('sr-digest-list');
  if (!list) return;

  let items = [...allItems];

  // Filter to unseen only unless showAll
  if (!showAll) {
    items = items.filter(item => !item.seen);
  }

  // Filter by search text
  if (filterText) {
    items = items.filter(item => item.title.toLowerCase().includes(filterText));
  }

  // Sort
  if (sortMode === 'ending') {
    items.sort((a, b) => {
      if (!a.endDate && !b.endDate) return 0;
      if (!a.endDate) return 1;
      if (!b.endDate) return -1;
      return new Date(a.endDate) - new Date(b.endDate);
    });
  } else {
    items = items.reverse();
  }

  if (items.length === 0) {
    list.innerHTML = '<div class="sr-empty">No listings found.</div>';
    return;
  }

  list.innerHTML = items.map(item => {
    const date = new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const endDate = item.endDate ? new Date(item.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
    return `
      <div class="sr-listing-card">
        ${item.image ? `<img class="sr-listing-img" src="${item.image}" alt="${item.title}" loading="lazy">` : ''}
        <div class="sr-listing-title">${item.title}</div>
        <div class="sr-listing-meta">${item.type} · Listed ${date}${endDate ? ` · Ends ${endDate}` : ''}</div>
        <div class="sr-listing-bottom">
          <div class="sr-listing-price">$${item.price}</div>
          <a href="${item.url}" target="_blank" class="sr-listing-link">View on eBay →</a>
        </div>
      </div>
    `;
  }).join('');
}
