// ── review-page.js — STAGING test page for the "needs file name" queue
export const REVIEW_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Needs File Name</title>
<style>
  :root{--bg:#f6f6f4;--card:#fff;--ink:#1d1d1b;--muted:#6b6b66;--line:#e2e2dc;--accent:#c5050c;--ok:#1f7a3f;--warn:#a15c00}
  @media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1f1f1d;--ink:#ecece8;--muted:#9a9a93;--line:#33332f;--ok:#4cbb74;--warn:#e6a23c}}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 -apple-system,system-ui,sans-serif}
  header{padding:16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:baseline}
  h1{font-size:18px;margin:0}.count{color:var(--muted)}
  main{max-width:720px;margin:0 auto;padding:12px 16px 40px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:12px 0}
  .title{font-weight:600}.meta{color:var(--muted);font-size:13px;margin:4px 0 8px}
  .cost{display:flex;gap:12px;flex-wrap:wrap;font-size:13px;margin-bottom:10px}.cost b{font-variant-numeric:tabular-nums}
  .badge{display:inline-block;font-size:12px;padding:2px 8px;border-radius:999px;background:var(--warn);color:#fff;margin-left:6px}
  select{width:100%;margin-top:8px;font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)}
  textarea{width:100%;min-height:54px;font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)}
  table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0}td{padding:3px 4px;border-bottom:1px solid var(--line)}td:first-child{color:var(--muted);width:120px}
  .row{display:flex;gap:8px;margin-top:8px}button{flex:1;font:inherit;padding:10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
  button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button:disabled{opacity:.45;cursor:default}
  .done{color:var(--ok);font-weight:600}.err{color:var(--accent);font-size:13px}.empty{color:var(--muted);text-align:center;padding:40px 0}
</style></head><body>
<header><h1>Needs file name</h1><span class="count" id="count"></span></header>
<main id="list"><p class="empty">Loading…</p></main>
<script>
const KEY = new URLSearchParams(location.search).get('key') || '';
const q = p => p + (p.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(KEY);
const FIELDS = [['year','Year'],['set_name','Set'],['variation','Variation'],['card_no','Card No'],['version','Version'],['player_name','Player'],['qty_manufactured','Qty Mfg'],['grade','Grade']];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let timers = {};
let SPORTS = [];
const ready = {};
async function load() {
  SPORTS = await (await fetch(q('/sports'))).json().catch(() => []);
  const r = await fetch(q('/pending')); const d = await r.json();
  const list = document.getElementById('list');
  if (d.error) { list.innerHTML = '<p class="err">' + esc(d.error) + '</p>'; return; }
  document.getElementById('count').textContent = d.pending + ' waiting';
  if (!d.rows.length) { list.innerHTML = '<p class="empty">Nothing waiting.</p>'; return; }
  list.innerHTML = d.rows.map(r => \`
    <div class="card" id="c-\${r.item_id}">
      <div class="title">\${esc(r.ebay_title)}\${r.flag === 'refunded' ? '<span class="badge">Refunded</span>' : ''}</div>
      <div class="meta">\${esc(r.seller)} · \${esc(r.date_purchased)} · ID \${r.item_id}</div>
      <div class="cost"><span>Item <b>$\${r.item}</b></span><span>Ship <b>$\${r.shipping}</b></span><span>Tax <b>$\${r.tax}</b></span><span>Total <b>$\${r.purchasePrice}</b></span></div>
      <textarea placeholder="Paste file name" oninput="preview('\${r.item_id}', this.value)"></textarea>
      <select id="s-\${r.item_id}" onchange="gate('\${r.item_id}')"><option value="">Sport…</option>\${SPORTS.map(x => '<option>' + esc(x) + '</option>').join('')}</select>
      <table id="p-\${r.item_id}"></table>
      <div class="err" id="e-\${r.item_id}"></div>
      <div class="row"><button onclick="skip('\${r.item_id}')">Skip</button><button class="primary" id="b-\${r.item_id}" disabled onclick="confirmCard('\${r.item_id}')">Confirm</button></div>
    </div>\`).join('');
}
function preview(id, name) {
  clearTimeout(timers[id]);
  timers[id] = setTimeout(async () => {
    const t = document.getElementById('p-' + id), b = document.getElementById('b-' + id);
    if (!name.trim()) { t.innerHTML = ''; ready[id] = false; gate(id); return; }
    const d = await (await fetch(q('/parse?name=' + encodeURIComponent(name)))).json();
    t.innerHTML = FIELDS.map(([k, l]) => '<tr><td>' + l + '</td><td>' + (d[k] ? esc(d[k]) : '—') + '</td></tr>').join('');
    ready[id] = !!d.player_name;
    const sel = document.getElementById('s-' + id);
    if (d.suggested_sport && !sel.value) sel.value = d.suggested_sport;
    gate(id);
  }, 200);
}
function gate(id) {
  document.getElementById('b-' + id).disabled = !(ready[id] && document.getElementById('s-' + id).value);
}
async function post(path, body) {
  const r = await fetch(q(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
async function confirmCard(id) {
  const name = document.querySelector('#c-' + id + ' textarea').value;
  const sport = document.getElementById('s-' + id).value;
  const d = await post('/pending/confirm', { item_id: id, file_name: name, sport });
  if (d.error) { document.getElementById('e-' + id).textContent = d.error; return; }
  document.getElementById('c-' + id).innerHTML = '<span class="done">Added · ' + esc(name) + '</span>';
}
async function skip(id) {
  const d = await post('/pending/skip', { item_id: id });
  if (d.error) { document.getElementById('e-' + id).textContent = d.error; return; }
  document.getElementById('c-' + id).innerHTML = '<span class="muted">Skipped</span>';
}
load();
</script></body></html>`;
