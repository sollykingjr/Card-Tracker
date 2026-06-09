// ── Search Results ────────────────────────────────────────────────────────────
const WORKER = 'https://card-app.maxcsolomon.workers.dev';

async function initSearchResults() {
  const root = document.getElementById('sr-root');
  root.innerHTML = `
    <div class="sr-wrap">
      <div class="sr-header">
        <h2 class="sr-title">Search Results</h2>
        <button class="sr-add-btn" id="sr-add-btn">+ Add Search</button>
      </div>
      <div id="sr-list"></div>
      <div id="sr-form-wrap" style="display:none">
        <div class="sr-form">
          <div class="sr-form-title">New Search Alert</div>
          <input class="sr-input" id="sr-label" placeholder="Label (e.g. Scott Brosius)">
          <input class="sr-input" id="sr-query" placeholder="eBay search query (e.g. scott brosius)">
          <div class="sr-form-section">Seller</div>
          <div class="sr-seller-row">
            <div class="sr-chip-row" id="sr-seller-mode-chips">
              <button class="sr-chip-btn on" data-val="exclude">Exclude</button>
              <button class="sr-chip-btn" data-val="include">Include</button>
            </div>
            <input class="sr-input sr-input-inline" id="sr-seller" placeholder="Seller username (optional)">
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
          <div class="sr-form-row">
            <div class="sr-form-label">Schedule</div>
            <div class="sr-chip-row" id="sr-schedule-chips">
              <button class="sr-chip-btn on" data-val="hourly">Hourly</button>
              <button class="sr-chip-btn" data-val="nightly">Nightly</button>
            </div>
          </div>
          <div class="sr-form-row">
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
    </div>
  `;

   document.getElementById('sr-add-btn').onclick = () => {
    document.getElementById('sr-form-wrap').style.display = 'block';
    document.getElementById('sr-add-btn').style.display = 'none';
    wireForm();
  };

  document.getElementById('sr-cancel-btn').onclick = () => {
    document.getElementById('sr-form-wrap').style.display = 'none';
    document.getElementById('sr-add-btn').style.display = 'block';
    clearForm();
  };

  document.getElementById('sr-save-btn').onclick = saveSearch;

  await loadSearches();
  if (window._pendingDigest) {
    const key = window._pendingDigest;
    const label = key.replace('_digest_hourly', '').replace(/_/g, ' ');
    window._pendingDigest = null;
    showDigest(key.replace('_hourly', ''), label, false, key);
  }
}

function clearForm() {
  document.getElementById('sr-label').value = '';
  document.getElementById('sr-query').value = '';
  document.getElementById('sr-seller').value = '';
  document.getElementById('sr-keywords').value = '';
  document.getElementById('sr-serial').checked = false;
  document.getElementById('sr-notify').checked = true;
  document.querySelectorAll('#sr-seller-mode-chips .sr-chip-btn').forEach((b,i) => b.classList.toggle('on', i===0));
  document.querySelectorAll('#sr-sport-chips .sr-chip-btn').forEach((b,i) => b.classList.toggle('on', i===0));
  document.querySelectorAll('#sr-condition-chips .sr-chip-btn').forEach((b,i) => b.classList.toggle('on', i===0));
  document.querySelectorAll('#sr-type-chips .sr-chip-btn').forEach((b,i) => b.classList.toggle('on', i===0));
  document.querySelectorAll('#sr-schedule-chips .sr-chip-btn').forEach((b,i) => b.classList.toggle('on', i===0));
  document.getElementById('sr-min-price').value = '';
  document.getElementById('sr-max-price').value = '';
  document.getElementById('sr-include-keywords').value = '';
  document.getElementById('sr-exclude-keywords').value = '';
  document.querySelectorAll('#sr-include-logic .sr-chip-btn').forEach((b,i) => b.classList.toggle('on', i===0));
}

async function loadSearches() {
  const list = document.getElementById('sr-list');
  list.innerHTML = '<div class="sr-loading">Loading...</div>';
  try {
    const res = await fetch(`${WORKER}/search-alerts`);
    const data = await res.json();
    renderSearches(data.searches || []);
  } catch(e) {
    list.innerHTML = '<div class="sr-empty">Failed to load searches.</div>';
  }
}
function renderSearches(searches) {
  const list = document.getElementById('sr-list');
  if (searches.length === 0) {
    list.innerHTML = '<div class="sr-empty">No search alerts yet. Add one above.</div>';
    return;
  }

  list.innerHTML = searches.map((s, i) => `
    <div class="sr-card">
      <div class="sr-card-header">
        <div class="sr-card-label">${s.label}</div>
        <div class="sr-menu-wrap">
          <button class="sr-menu-btn" data-index="${i}">···</button>
          <div class="sr-menu-dropdown" id="sr-menu-${i}" style="display:none">
            <button class="sr-menu-item sr-menu-edit" data-index="${i}">Edit</button>
            <button class="sr-menu-item sr-menu-rename" data-index="${i}">Rename</button>
            <button class="sr-menu-item sr-menu-delete" data-index="${i}">Delete</button>
          </div>
        </div>
      </div>
      <div class="sr-card-query">🔍 ${s.query}</div>
      <div class="sr-card-keywords">🔔 ${(s.priorityKeywords || []).join(', ')}</div>
      <div class="sr-card-links">
        <button class="sr-run-btn" data-digestkey="${s.digestKey}" data-label="${s.label}">▶ Run</button>
        <button class="sr-link" onclick="showDigest('${s.digestKey}', '${s.label}', false, '${s.digestKey}_hourly')">Last Hour →</button>
        <button class="sr-link" onclick="showDigest('${s.digestKey}', '${s.label}', false)">Today →</button>
        <button class="sr-link" onclick="showDigest('${s.digestKey}', '${s.label}', true)">7-Day →</button>
      </div>
    </div>
  `).join('');

  // Close all menus when clicking outside
  document.addEventListener('click', e => {
    if (!e.target.closest('.sr-menu-wrap')) {
      document.querySelectorAll('.sr-menu-dropdown').forEach(d => d.style.display = 'none');
    }
  });

  document.querySelectorAll('.sr-run-btn').forEach(btn => {
    btn.onclick = async () => {
      const digestKey = btn.dataset.digestkey;
      const label = btn.dataset.label;
      btn.textContent = '⏳ Running...';
      btn.disabled = true;
      try {
        const res = await fetch(`${WORKER}/run-search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ digestKey })
        });
        const data = await res.json();
        btn.textContent = `▶ Run`;
        btn.disabled = false;
        showDigest(digestKey, label, false, digestKey + '_hourly');
      } catch(e) {
        btn.textContent = '▶ Run';
        btn.disabled = false;
      }
    };
  });

  document.querySelectorAll('.sr-menu-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const i = btn.dataset.index;
      const dropdown = document.getElementById(`sr-menu-${i}`);
      const isOpen = dropdown.style.display === 'block';
      document.querySelectorAll('.sr-menu-dropdown').forEach(d => d.style.display = 'none');
      dropdown.style.display = isOpen ? 'none' : 'block';
    };
  });

  document.querySelectorAll('.sr-menu-rename').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const i = parseInt(btn.dataset.index);
      const res = await fetch(`${WORKER}/search-alerts`);
      const data = await res.json();
      const search = data.searches[i];
      const newLabel = prompt('Rename search:', search.label);
      if (!newLabel || newLabel.trim() === search.label) return;
      data.searches[i].label = newLabel.trim();
      await fetch(`${WORKER}/search-alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searches: data.searches })
      });
      await loadSearches();
    };
  });

  document.querySelectorAll('.sr-menu-edit').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const i = parseInt(btn.dataset.index);
      const res = await fetch(`${WORKER}/search-alerts`);
      const data = await res.json();
      const s = data.searches[i];
      document.querySelectorAll('.sr-menu-dropdown').forEach(d => d.style.display = 'none');
      document.getElementById('sr-form-wrap').style.display = 'block';
      document.getElementById('sr-add-btn').style.display = 'none';
      wireForm();
      // Pre-fill form
      document.getElementById('sr-label').value = s.label || '';
      document.getElementById('sr-query').value = s.query || '';
      document.getElementById('sr-seller').value = s.seller || '';
      document.getElementById('sr-keywords').value = (s.priorityKeywords || []).join(', ');
      document.getElementById('sr-serial').checked = s.serial || false;
      document.getElementById('sr-notify').checked = s.notify !== false;
      document.getElementById('sr-keywords-wrap').style.display = s.notify !== false ? 'block' : 'none';
      // Set chips
      const setChip = (groupId, val) => {
        document.querySelectorAll(`#${groupId} .sr-chip-btn`).forEach(b => {
          b.classList.toggle('on', b.dataset.val === val);
        });
      };
      setChip('sr-seller-mode-chips', s.sellerMode || 'exclude');
      setChip('sr-sport-chips', s.sport || '');
      setChip('sr-condition-chips', s.condition || '');
      setChip('sr-type-chips', s.listingType || 'BOTH');
      setChip('sr-schedule-chips', s.schedule || 'hourly');
      document.getElementById('sr-min-price').value = s.minPrice || '';
      document.getElementById('sr-max-price').value = s.maxPrice || '';
      document.getElementById('sr-include-keywords').value = s.includeKeywords || '';
      document.getElementById('sr-exclude-keywords').value = s.excludeKeywords || '';
      setChip('sr-include-logic', s.includeLogic || 'OR');
      // Override save to update instead of add
      document.getElementById('sr-save-btn').onclick = async () => {
        const updated = [...data.searches];
        const keywords = document.getElementById('sr-keywords').value.trim();
        updated[i] = {
          ...s,
          label: document.getElementById('sr-label').value.trim(),
          query: document.getElementById('sr-query').value.trim(),
          seller: document.getElementById('sr-seller').value.trim(),
          sellerMode: getChipVal('sr-seller-mode-chips') || 'exclude',
          sport: getChipVal('sr-sport-chips'),
          condition: getChipVal('sr-condition-chips'),
          serial: document.getElementById('sr-serial').checked,
          listingType: getChipVal('sr-type-chips') || 'BOTH',
          schedule: getChipVal('sr-schedule-chips') || 'hourly',
          notify: document.getElementById('sr-notify').checked,
          priorityKeywords: keywords ? keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean) : [],
          minPrice: document.getElementById('sr-min-price').value || '',
          maxPrice: document.getElementById('sr-max-price').value || '',
          includeKeywords: document.getElementById('sr-include-keywords').value || '',
          includeLogic: getChipVal('sr-include-logic') || 'OR',
          excludeKeywords: document.getElementById('sr-exclude-keywords').value || ''
        };
        await fetch(`${WORKER}/search-alerts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ searches: updated })
        });
        document.getElementById('sr-form-wrap').style.display = 'none';
        document.getElementById('sr-add-btn').style.display = 'block';
        document.getElementById('sr-save-btn').onclick = saveSearch;
        clearForm();
        await loadSearches();
      };
    };
  });

  document.querySelectorAll('.sr-menu-delete').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const i = parseInt(btn.dataset.index);
      const res = await fetch(`${WORKER}/search-alerts`);
      const data = await res.json();
      const search = data.searches[i];

      // Confirm before deleting
      if (!confirm(`Delete "${search.label}"?`)) return;

      // Clean up digest and archive from KV
      await fetch(`${WORKER}/search-alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          searches: data.searches.filter((_, idx) => idx !== i),
          deleteKeys: [search.digestKey, search.digestKey + '_archive']
        })
      });
      await loadSearches();
    };
  });
}

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

function wireForm() {
  wireChips('sr-seller-mode-chips');
  wireChips('sr-sport-chips');
  wireChips('sr-condition-chips');
  wireChips('sr-type-chips');
  wireChips('sr-schedule-chips');

  document.getElementById('sr-notify').onchange = function() {
    document.getElementById('sr-keywords-wrap').style.display = this.checked ? 'block' : 'none';
  };
  wireChips('sr-include-logic');
}

async function saveSearch() {
  const label = document.getElementById('sr-label').value.trim();
  const query = document.getElementById('sr-query').value.trim();
  const seller = document.getElementById('sr-seller').value.trim();

  if (!label || (!query && !seller)) return;

  const digestKey = label.toLowerCase().replace(/\s+/g, '_') + '_digest';
  const keywords = document.getElementById('sr-keywords').value.trim();
  const priorityKeywords = keywords ? keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean) : [];

  const search = {
    label,
    query,
    seller,
    sellerMode: getChipVal('sr-seller-mode-chips') || 'exclude',
    sport: getChipVal('sr-sport-chips'),
    condition: getChipVal('sr-condition-chips'),
    serial: document.getElementById('sr-serial').checked,
    listingType: getChipVal('sr-type-chips') || 'BOTH',
    schedule: getChipVal('sr-schedule-chips') || 'hourly',
    notify: document.getElementById('sr-notify').checked,
    priorityKeywords,
    digestKey,
    minPrice: document.getElementById('sr-min-price').value || '',
    maxPrice: document.getElementById('sr-max-price').value || '',
    includeKeywords: document.getElementById('sr-include-keywords').value || '',
    includeLogic: getChipVal('sr-include-logic') || 'OR',
    excludeKeywords: document.getElementById('sr-exclude-keywords').value || ''
  };

  const res = await fetch(`${WORKER}/search-alerts`);
  const data = await res.json();
  const updated = [...(data.searches || []), search];

  await fetch(`${WORKER}/search-alerts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ searches: updated })
  });

  document.getElementById('sr-form-wrap').style.display = 'none';
  document.getElementById('sr-add-btn').style.display = 'block';
  clearForm();
  await loadSearches();
}
async function showDigest(digestKey, label, isArchive, overrideKey) {
  const root = document.getElementById('sr-root');
  const key = overrideKey || (isArchive ? digestKey + '_archive' : digestKey);

  root.innerHTML = `
    <div class="sr-wrap">
      <div class="sr-digest-header">
        <button class="sr-back-btn" id="sr-back-btn">← Back</button>
        <div class="sr-digest-title">${label} — ${overrideKey?.includes('_hourly') ? 'Last Hour' : isArchive ? '7-Day Archive' : "Today's Listings"}</div>
        <button class="sr-reset-btn" id="sr-reset-btn">Clear</button>
      </div>
      <div id="sr-digest-list"><div class="sr-loading">Loading...</div></div>
    </div>
  `;

  document.getElementById('sr-back-btn').onclick = () => initSearchResults();
  document.getElementById('sr-reset-btn').onclick = async () => {
    if (!confirm('Clear all listings from this view?')) return;
    await fetch(`${WORKER}/search-alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteKeys: [key] })
    });
    document.getElementById('sr-digest-list').innerHTML = '<div class="sr-empty">Cleared.</div>';
  };

  try {
    const res = await fetch(`${WORKER}/player-digest-json?key=${key}`);
    const data = await res.json();
    const items = data.items || [];
    const list = document.getElementById('sr-digest-list');

    if (items.length === 0) {
      list.innerHTML = '<div class="sr-empty">No listings found.</div>';
      return;
    }

    list.innerHTML = items.map(item => {
      const date = new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      return `
        <div class="sr-listing-card">
          ${item.image ? `<img class="sr-listing-img" src="${item.image}" alt="${item.title}" loading="lazy">` : ''}
          <div class="sr-listing-title">${item.title}</div>
          <div class="sr-listing-meta">${item.type} · ${date}</div>
          <div class="sr-listing-bottom">
            <div class="sr-listing-price">$${item.price}</div>
            <a href="${item.url}" target="_blank" class="sr-listing-link">View on eBay →</a>
          </div>
        </div>
      `;
    }).join('');
  } catch(e) {
    document.getElementById('sr-digest-list').innerHTML = '<div class="sr-empty">Failed to load listings.</div>';
  }
}
