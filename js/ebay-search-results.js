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
          <input class="sr-input" id="sr-keywords" placeholder="Priority keywords, comma separated (e.g. psa,rc,auto)">
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
  };

  document.getElementById('sr-cancel-btn').onclick = () => {
    document.getElementById('sr-form-wrap').style.display = 'none';
    document.getElementById('sr-add-btn').style.display = 'block';
    clearForm();
  };

  document.getElementById('sr-save-btn').onclick = saveSearch;

  await loadSearches();
}

function clearForm() {
  document.getElementById('sr-label').value = '';
  document.getElementById('sr-query').value = '';
  document.getElementById('sr-keywords').value = '';
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
        <button class="sr-delete-btn" data-index="${i}">✕</button>
      </div>
      <div class="sr-card-query">🔍 ${s.query}</div>
      <div class="sr-card-keywords">⚡ ${s.priorityKeywords.join(', ')}</div>
      <div class="sr-card-links">
        <button class="sr-link" onclick="showDigest('${s.digestKey}', '${s.label}', false)">Today's Listings →</button>
        <button class="sr-link" onclick="showDigest('${s.digestKey}', '${s.label}', true)">7-Day Archive →</button>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.sr-delete-btn').forEach(btn => {
    btn.onclick = async () => {
      const i = parseInt(btn.dataset.index);
      const res = await fetch(`${WORKER}/search-alerts`);
      const data = await res.json();
      const updated = data.searches.filter((_, idx) => idx !== i);
      await fetch(`${WORKER}/search-alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searches: updated })
      });
      await loadSearches();
    };
  });
}

async function saveSearch() {
  const label = document.getElementById('sr-label').value.trim();
  const query = document.getElementById('sr-query').value.trim();
  const keywords = document.getElementById('sr-keywords').value.trim();

  if (!label || !query) return;

  const digestKey = label.toLowerCase().replace(/\s+/g, '_') + '_digest';
  const priorityKeywords = keywords ? keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean) : [];

  const res = await fetch(`${WORKER}/search-alerts`);
  const data = await res.json();
  const updated = [...(data.searches || []), { label, query, priorityKeywords, digestKey }];

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
async function showDigest(digestKey, label, isArchive) {
  const root = document.getElementById('sr-root');
  const key = isArchive ? digestKey + '_archive' : digestKey;

  root.innerHTML = `
    <div class="sr-wrap">
      <div class="sr-digest-header">
        <button class="sr-back-btn" id="sr-back-btn">← Back</button>
        <div class="sr-digest-title">${label} — ${isArchive ? '7-Day Archive' : "Today's Listings"}</div>
      </div>
      <div id="sr-digest-list"><div class="sr-loading">Loading...</div></div>
    </div>
  `;

  document.getElementById('sr-back-btn').onclick = () => initSearchResults();

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
