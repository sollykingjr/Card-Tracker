// ── intake.js — Intake screen (new purchases needing file names, sales to review,
// manual add, COMC upload). One screen, opened from the Home banner or the
// Intake button on Card Collection. Only active when the card database is in use.
const INTAKE_API = CARD_DB_URL;
const INTAKE_FIELDS = [['year','Year'],['set_name','Set'],['variation','Variation'],['card_no','Card No'],['version','Version'],['player_name','Player'],['qty_manufactured','Qty Mfg'],['grade','Grade']];
let intakeCounts = { pending: 0, review: 0 };
let intakeSports = [];
const inEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inMoney = c => c == null ? '—' : '$' + (c / 100).toFixed(2);

async function intakeGet(path) {
  const r = await fetch(INTAKE_API + path, { headers: { 'X-App-Key': APP_KEY } });
  return r.json();
}
async function intakePost(path, body, raw) {
  const r = await fetch(INTAKE_API + path, {
    method: 'POST',
    headers: { 'X-App-Key': APP_KEY, 'Content-Type': raw ? 'text/csv' : 'application/json' },
    body: raw ? body : JSON.stringify(body)
  });
  return r.json();
}

// ── Entry points ──────────────────────────────────────────────────────────────
async function intakeRefreshCounts() {
  if (!INTAKE_API) return;
  try {
    intakeCounts = await intakeGet('/intake-counts');
  } catch (e) { intakeCounts = { pending: 0, review: 0 }; }
  intakeRenderBanner();
  const btn = document.getElementById('intake-btn');
  if (btn) btn.outerHTML = intakeButtonHTML();
}

function intakeBannerText() {
  const parts = [];
  if (intakeCounts.pending) parts.push(`${intakeCounts.pending} purchase${intakeCounts.pending === 1 ? '' : 's'} need${intakeCounts.pending === 1 ? 's' : ''} a file name`);
  if (intakeCounts.review) parts.push(`${intakeCounts.review} sale${intakeCounts.review === 1 ? '' : 's'} to review`);
  return parts.join(' · ');
}

function intakeRenderBanner() {
  const box = document.getElementById('intake-banner');
  if (!box) return;
  const text = INTAKE_API ? intakeBannerText() : '';
  box.innerHTML = text ? `<button class="intake-banner" onclick="intakeOpen()"><span>${inEsc(text)}</span><span class="intake-banner-go">Open ›</span></button>` : '';
}

function intakeButtonHTML() {
  if (!INTAKE_API) return '';
  const n = (intakeCounts.pending || 0) + (intakeCounts.review || 0);
  return `<button id="intake-btn" class="schip${n ? ' on' : ''}" onclick="intakeOpen()">Intake${n ? ` (${n})` : ''}</button>`;
}

async function intakeOpen() {
  if (!INTAKE_API) return;
  document.getElementById('intake-wrap').classList.add('on');
  document.getElementById('intake-content').innerHTML = '<div class="spin"><div class="spin-ring"></div>Loading…</div>';
  if (!intakeSports.length) intakeSports = await intakeGet('/sports').catch(() => []);
  await intakeRender();
}

function intakeClose() {
  document.getElementById('intake-wrap').classList.remove('on');
}

// ── Screen ────────────────────────────────────────────────────────────────────
async function intakeRender() {
  const [pending, review] = await Promise.all([intakeGet('/pending'), intakeGet('/sale-review')]);
  intakeCounts = { pending: pending.pending || 0, review: review.open || 0 };
  intakeRenderBanner();
  const sportOpts = intakeSports.map(s => `<option>${inEsc(s)}</option>`).join('');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  document.getElementById('intake-content').innerHTML = `
    <div class="intake-title">Intake</div>

    <div class="srow-t">Needs file name${pending.pending ? ` · ${pending.pending}` : ''}</div>
    ${(pending.rows || []).length ? pending.rows.map(r => `
      <div class="intake-card" id="in-c-${r.item_id}">
        <div class="intake-name">${inEsc(r.ebay_title)}${r.flag === 'refunded' ? '<span class="intake-flag">Refunded</span>' : ''}</div>
        <div class="intake-meta">${inEsc(r.seller)} · ${inEsc(r.date_purchased)} · ID ${r.item_id}</div>
        <div class="intake-cost"><span>Item <b>$${r.item}</b></span><span>Ship <b>$${r.shipping}</b></span><span>Tax <b>$${r.tax}</b></span><span>Total <b>$${r.purchasePrice}</b></span></div>
        <textarea class="intake-in" placeholder="Paste file name" oninput="intakePreview('${r.item_id}', this.value)"></textarea>
        <table class="intake-prev" id="in-p-${r.item_id}"></table>
        <select class="intake-in" id="in-s-${r.item_id}" onchange="intakeGate('${r.item_id}')"><option value="">Sport…</option>${sportOpts}</select>
        <div class="intake-err" id="in-e-${r.item_id}"></div>
        <div class="intake-row">
          <button class="intake-btn" onclick="intakeSkip('${r.item_id}')">Skip</button>
          <button class="intake-btn primary" id="in-b-${r.item_id}" disabled onclick="intakeConfirm('${r.item_id}')">Confirm</button>
        </div>
      </div>`).join('') : '<div class="intake-empty">Nothing waiting.</div>'}

    ${(review.rows || []).length ? `
      <div class="srow-t" style="margin-top:18px">Sales to review · ${review.open}</div>
      ${review.rows.map((r, i) => `
        <div class="intake-card" id="in-r-${i}">
          <div class="intake-name">${inEsc(r.title || r.sku)}</div>
          <div class="intake-meta">${inEsc(r.sale_date || '')} · ${r.sku ? 'ID ' + inEsc(r.sku) : 'no Item ID'} · sold ${inMoney(r.sale_price_cents)}</div>
          <div class="intake-meta">${inEsc(r.reason)}</div>
          <div class="intake-row"><button class="intake-btn" onclick="intakeDismiss('${inEsc(r.order_id)}','${inEsc(r.sku || '')}', ${i})">Dismiss</button></div>
        </div>`).join('')}` : ''}

    <details class="intake-section">
      <summary class="srow-t">Add a card manually</summary>
      <textarea class="intake-in" id="in-m-name" placeholder="Paste file name" oninput="intakeManualPreview()"></textarea>
      <table class="intake-prev" id="in-m-prev"></table>
      <select class="intake-in" id="in-m-sport" onchange="intakeManualGate()"><option value="">Sport…</option>${sportOpts}</select>
      <input class="intake-in" id="in-m-price" inputmode="decimal" placeholder="Purchase price (e.g. 12.50)" oninput="intakeManualGate()">
      <input class="intake-in" id="in-m-from" placeholder="Where you bought it" oninput="intakeManualGate()">
      <input class="intake-in" id="in-m-date" type="date" value="${today}">
      <div class="intake-err" id="in-m-err"></div>
      <div class="intake-row"><button class="intake-btn primary" id="in-m-btn" disabled onclick="intakeManualSave()">Add card</button></div>
      <div id="in-m-done"></div>
    </details>

    <details class="intake-section">
      <summary class="srow-t">Upload COMC file</summary>
      <select class="intake-in" id="in-c-type"><option value="purchases">Purchase history</option><option value="sales">Sales history</option></select>
      <input class="intake-in" id="in-c-file" type="file" accept=".csv,text/csv">
      <div class="intake-row">
        <button class="intake-btn" onclick="intakeComc(false)">Check file</button>
        <button class="intake-btn primary" id="in-c-go" disabled onclick="intakeComc(true)">Import</button>
      </div>
      <div class="intake-err" id="in-c-err"></div>
      <div id="in-c-out"></div>
    </details>
  `;
}

// ── Needs file name ───────────────────────────────────────────────────────────
const intakeTimers = {}, intakeReady = {};
function intakePreviewTable(d) {
  return INTAKE_FIELDS.map(([k, l]) => `<tr><td>${l}</td><td>${d[k] ? inEsc(d[k]) : '—'}</td></tr>`).join('');
}
function intakePreview(id, name) {
  clearTimeout(intakeTimers[id]);
  intakeTimers[id] = setTimeout(async () => {
    const t = document.getElementById('in-p-' + id);
    if (!name.trim()) { t.innerHTML = ''; intakeReady[id] = false; intakeGate(id); return; }
    const d = await intakeGet('/parse?name=' + encodeURIComponent(name));
    t.innerHTML = intakePreviewTable(d);
    intakeReady[id] = !!d.player_name;
    const sel = document.getElementById('in-s-' + id);
    if (d.suggested_sport && !sel.value) sel.value = d.suggested_sport;
    intakeGate(id);
  }, 200);
}
function intakeGate(id) {
  document.getElementById('in-b-' + id).disabled = !(intakeReady[id] && document.getElementById('in-s-' + id).value);
}
async function intakeConfirm(id) {
  const name = document.querySelector(`#in-c-${id} textarea`).value;
  const sport = document.getElementById('in-s-' + id).value;
  const d = await intakePost('/pending/confirm', { item_id: id, file_name: name, sport });
  if (d.error) { document.getElementById('in-e-' + id).textContent = d.error; return; }
  document.getElementById('in-c-' + id).innerHTML = `<div class="intake-done">Added · ID ${id} · ${inEsc(name)}</div>`;
  intakeAfterChange();
}
async function intakeSkip(id) {
  const d = await intakePost('/pending/skip', { item_id: id });
  if (d.error) { document.getElementById('in-e-' + id).textContent = d.error; return; }
  document.getElementById('in-c-' + id).innerHTML = '<div class="intake-meta">Skipped</div>';
  intakeAfterChange(false);
}

// ── Sales to review ───────────────────────────────────────────────────────────
async function intakeDismiss(orderId, sku, i) {
  const d = await intakePost('/sale-review/dismiss', { order_id: orderId, sku });
  if (d.error) return;
  document.getElementById('in-r-' + i).innerHTML = '<div class="intake-meta">Dismissed</div>';
  intakeAfterChange(false);
}

// ── Manual add ────────────────────────────────────────────────────────────────
let intakeManualReady = false, intakeManualTimer;
function intakeManualPreview() {
  clearTimeout(intakeManualTimer);
  intakeManualTimer = setTimeout(async () => {
    const name = document.getElementById('in-m-name').value, t = document.getElementById('in-m-prev');
    if (!name.trim()) { t.innerHTML = ''; intakeManualReady = false; intakeManualGate(); return; }
    const d = await intakeGet('/parse?name=' + encodeURIComponent(name));
    t.innerHTML = intakePreviewTable(d);
    intakeManualReady = !!d.player_name;
    const sel = document.getElementById('in-m-sport');
    if (d.suggested_sport && !sel.value) sel.value = d.suggested_sport;
    intakeManualGate();
  }, 200);
}
function intakeManualGate() {
  const v = id => document.getElementById(id).value.trim();
  document.getElementById('in-m-btn').disabled = !(intakeManualReady && v('in-m-sport') && v('in-m-price') && v('in-m-from'));
}
async function intakeManualSave() {
  const v = id => document.getElementById(id).value;
  const d = await intakePost('/manual-add', { file_name: v('in-m-name'), sport: v('in-m-sport'), price: v('in-m-price'), purchased_from: v('in-m-from'), date: v('in-m-date') });
  if (d.error) { document.getElementById('in-m-err').textContent = d.error; return; }
  document.getElementById('in-m-err').textContent = '';
  document.getElementById('in-m-done').innerHTML = `<div class="intake-done">Added · ID ${d.added} · $${d.purchasePrice}</div>`;
  ['in-m-name', 'in-m-price', 'in-m-from'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('in-m-prev').innerHTML = ''; intakeManualReady = false; intakeManualGate();
  intakeAfterChange();
}

// ── COMC upload ───────────────────────────────────────────────────────────────
let intakeComcChecked = null;
async function intakeComc(commit) {
  const f = document.getElementById('in-c-file').files[0], type = document.getElementById('in-c-type').value;
  const err = document.getElementById('in-c-err'), out = document.getElementById('in-c-out'), go = document.getElementById('in-c-go');
  err.textContent = '';
  if (!f) { err.textContent = 'Choose a CSV file first'; return; }
  if (commit && intakeComcChecked !== f.name + type) { err.textContent = 'Check the file first'; return; }
  if (commit && !confirm('Import this file into your data?')) return;
  out.innerHTML = '<div class="intake-meta">Working…</div>';
  const d = await intakePost(`/comc-import?type=${type}${commit ? '&commit=1' : ''}`, await f.text(), true);
  if (d.error) { out.innerHTML = ''; err.textContent = d.error; return; }
  const list = (arr, fmt) => arr && arr.length ? '<ul class="intake-list">' + arr.map(x => `<li>${inEsc(fmt(x))}</li>`).join('') + '</ul>' : '';
  out.innerHTML = `<div class="${commit ? 'intake-done' : 'intake-meta'}">${commit ? 'Imported' : 'Preview — nothing saved yet'} · ${d.rowsInFile} rows · ${d.alreadyInData} already in data · ${d.added} to add${type === 'sales' ? ` · ${d.markedSold} to mark sold` : ''} · ${d.sentToReview} for review</div>` +
    list(d.addedSample, x => `Add ${x.itemId} ${x.card}${x.price ? ' $' + x.price : ''}${x.sale ? ' sold $' + x.sale : ''}`) +
    list(d.markedSoldSample, x => `Sold ${x.itemId} ${x.card} $${x.sale}`) +
    list(d.review, x => `Review ${x.itemId} ${x.card}: ${x.reason}`);
  if (commit) { intakeComcChecked = null; go.disabled = true; intakeAfterChange(); }
  else { intakeComcChecked = f.name + type; go.disabled = false; }
}

// After anything that changes the data: refresh counts, and reload cards when cards changed
function intakeAfterChange(cardsChanged = true) {
  intakeRefreshCounts();
  if (cardsChanged && typeof loadCardData === 'function') loadCardData();
}

// Load counts once at startup so the Collection button shows the right number
if (INTAKE_API) intakeRefreshCounts();
