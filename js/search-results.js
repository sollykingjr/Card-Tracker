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
