// ── prospect-inbox.js — Prospects > Inbox: paste a prospect-analytics post (text + screenshots),
// Claude extracts it, you review/edit, then Confirm saves it. Same approve-before-saving idea as Intake.
// Also drives the Home banner ("N prospect posts to review") and the Inbox tab count.
const PIB_API = API_BASE;
let pibPending = [];          // posts waiting for review (with extraction + matches)
let pibImages = [];           // screenshots attached in the paste box: { name, media_type, base64 }
let pibBusy = false;
let pibMsg = '';
let pibUsage = null;          // { month, all_time } extraction cost totals from the Worker

// Cost is stored in micro-dollars. Show 4 decimals for tiny amounts so a $0.003 post doesn't read as $0.00.
const pibCost = m => m == null ? '' : '$' + (m / 1e6).toFixed(m < 100000 ? 4 : 2);
const pibTok = n => Number(n || 0).toLocaleString('en-US');
const pibUsageLine = u => u ? `${pibTok(u.input_tokens)} tokens in · ${pibTok(u.output_tokens)} out${u.cost_micros != null ? ' · ≈ ' + pibCost(u.cost_micros) : ''}` : '';

const pibEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pibToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

async function pibCall(path, body) {
  const r = await fetch(PIB_API + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-App-Key': APP_KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const d = await r.json().catch(() => ({ error: `Bad response (${r.status})` }));
  if (!r.ok && !d.error) d.error = `Error ${r.status}`;
  return d;
}

// ── Counts: Inbox tab label + Home banner ─────────────────────────────────────
let pibCount = 0;
async function pibRefreshCounts() {
  try { pibCount = (await pibCall('/prospect-counts')).pending || 0; } catch (e) { pibCount = 0; }
  pibUpdateBadges();
}
function pibUpdateBadges() {
  const t = document.getElementById('tab-inbox');
  if (t) t.textContent = pibCount ? `Inbox (${pibCount})` : 'Inbox';
  pibRenderBanner();
}
function pibRenderBanner() {
  const box = document.getElementById('prospect-banner');
  if (!box) return;
  box.innerHTML = pibCount
    ? `<button class="intake-banner" onclick="pibOpen()"><span>${pibCount} prospect post${pibCount === 1 ? '' : 's'} to review</span><span class="intake-banner-go">Open ›</span></button>`
    : '';
}
// Jump to Prospects > Inbox (used by the Home banner)
function pibOpen() {
  tab = 'inbox';
  document.querySelectorAll('#tabs .tab').forEach(x => x.classList.toggle('on', x.dataset.t === 'inbox'));
  setSection('prospects');
}

// ── Screen ────────────────────────────────────────────────────────────────────
async function renderProspectInbox() {
  const listEl = document.getElementById('list');
  listEl.classList.remove('grid-2');
  document.getElementById('sortchips').innerHTML = '';
  document.getElementById('cntlbl').textContent = '';
  if (!pibPending.length) listEl.innerHTML = '<div class="spin"><div class="spin-ring"></div>Loading…</div>';
  const [d, u] = await Promise.all([pibCall('/prospect-pending'), pibCall('/prospect-usage')]);
  pibUsage = u && !u.error ? u : null;
  if (tab !== 'inbox') return;                       // user switched tabs while loading
  if (d.error) { listEl.innerHTML = `<div class="intake-card"><div class="intake-err">${pibEsc(d.error)}</div></div>`; return; }
  pibPending = d.posts || [];
  pibCount = pibPending.length; pibUpdateBadges();
  pibDraw();
}

function pibDraw() {
  const listEl = document.getElementById('list');
  listEl.innerHTML = `
    <div class="pib-wrap">
      <div class="intake-card">
        <div class="srow-t">Add a post</div>
        <textarea class="intake-in" id="pib-text" style="min-height:120px" placeholder="Paste the post or email text here"></textarea>
        <div class="intake-row" style="align-items:center">
          <input class="intake-in" id="pib-title" style="margin-top:0" placeholder="Title (optional)">
          <input class="intake-in" id="pib-date" type="date" style="margin-top:0;max-width:150px" value="${pibToday()}">
        </div>
        <div class="intake-meta">Date is when the post came out. It dates the prices in it.</div>
        <div id="pib-thumbs" class="pib-thumbs"></div>
        <div class="intake-row">
          <button class="intake-btn" onclick="document.getElementById('pib-file').click()">Add screenshots</button>
          <button class="intake-btn primary" id="pib-go" onclick="pibSubmit()">Extract</button>
        </div>
        <input id="pib-file" type="file" accept="image/*" multiple style="display:none" onchange="pibAddFiles(this.files); this.value=''">
        <div class="intake-err" id="pib-err">${pibEsc(pibMsg)}</div>
        ${pibUsage && pibUsage.all_time.posts ? `<div class="intake-meta">Extraction cost · this month ${pibUsage.month.posts} post${pibUsage.month.posts === 1 ? '' : 's'}, ≈ ${pibCost(pibUsage.month.cost_micros)} · all time ≈ ${pibCost(pibUsage.all_time.cost_micros)}</div>` : ''}
      </div>
      <div class="srow-t" style="margin:16px 0 8px">To review${pibPending.length ? ` · ${pibPending.length}` : ''}</div>
      ${pibPending.length ? pibPending.map(pibPostHTML).join('') : '<div class="intake-empty">Nothing waiting.</div>'}
    </div>`;
  const ta = document.getElementById('pib-text');
  ta.addEventListener('paste', e => {                 // pasting a copied image works too
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); pibAddFiles(files); }
  });
  pibDrawThumbs();
}

// ── Screenshots ───────────────────────────────────────────────────────────────
const PIB_OK_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
async function pibPrepImage(file) {
  const asB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
  if (PIB_OK_TYPES.includes(file.type) && file.size <= 3 * 1024 * 1024) return { name: file.name, media_type: file.type, base64: await asB64(file) };
  // too big or an unsupported type (e.g. HEIC): redraw as JPEG, max 2400px wide/tall
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  return { name: file.name, media_type: 'image/jpeg', base64: await asB64(blob) };
}
async function pibAddFiles(files) {
  const err = document.getElementById('pib-err');
  for (const f of [...files]) {
    if (pibImages.length >= 20) { err.textContent = 'Up to 20 screenshots per post'; break; }
    try { pibImages.push(await pibPrepImage(f)); } catch (e) { err.textContent = `Could not read ${f.name || 'image'}`; }
  }
  pibDrawThumbs();
}
function pibDrawThumbs() {
  const box = document.getElementById('pib-thumbs'); if (!box) return;
  box.innerHTML = pibImages.map((im, i) => `<div class="pib-thumb"><img src="data:${im.media_type};base64,${im.base64}" alt=""><button onclick="pibRemoveImage(${i})">×</button></div>`).join('');
}
function pibRemoveImage(i) { pibImages.splice(i, 1); pibDrawThumbs(); }

async function pibSubmit() {
  if (pibBusy) return;
  const text = document.getElementById('pib-text').value.trim();
  const err = document.getElementById('pib-err'), btn = document.getElementById('pib-go');
  err.textContent = '';
  if (text.length < 40) { err.textContent = 'Paste the post text first (the screenshots alone are not enough)'; return; }
  pibBusy = true; btn.disabled = true; btn.textContent = 'Extracting… (can take a minute)';
  const d = await pibCall('/prospect-extract', {
    text, title: document.getElementById('pib-title').value.trim() || null,
    publishedAt: document.getElementById('pib-date').value || null,
    images: pibImages.map(({ media_type, base64 }) => ({ media_type, base64 }))
  });
  pibBusy = false;
  if (d.error) { pibMsg = ''; btn.disabled = false; btn.textContent = 'Extract'; err.textContent = d.error; return; }
  if (d.duplicate) { btn.disabled = false; btn.textContent = 'Extract'; err.textContent = `You already added this post (${d.status}).`; return; }
  pibImages = []; pibMsg = '';
  await renderProspectInbox();
}

// ── Review cards ──────────────────────────────────────────────────────────────
const PIB_STANCES = ['buy', 'hold', 'sell', 'watch', 'avoid', 'none'];
const pibPost = id => pibPending.find(p => p.post_id === id);
const pibDollars = c => c == null ? '' : (c / 100).toFixed(2);

function pibPostHTML(p) {
  const ex = p.extraction || {}, players = ex.players || [];
  const nTakes = players.filter(x => x.take).length;
  return `
    <div class="intake-card" id="pib-p-${p.post_id}">
      <div class="intake-name">${pibEsc(ex.title || p.title || 'Untitled post')}</div>
      <div class="intake-meta">${pibEsc((ex.post_type || '').replace('_', ' '))} · ${players.length} player${players.length === 1 ? '' : 's'} · ${nTakes} with analysis</div>
      ${p.usage ? `<div class="intake-meta">Cost of this extraction: ${pibEsc(pibUsageLine(p.usage))}</div>` : ''}
      <div class="intake-row" style="align-items:center;margin-top:6px">
        <span class="intake-meta" style="margin:0">Post date</span>
        <input class="intake-in" type="date" style="margin-top:0;max-width:150px" value="${pibEsc(ex.published_date || '')}" onchange="pibSetPost('${p.post_id}','published_date',this.value)">
      </div>
      ${ex.summary ? `<div class="pib-sum">${pibEsc(ex.summary)}</div>` : ''}
      ${pibFlagsHTML(p)}
      ${players.map((pl, i) => pibPlayerHTML(p, pl, i)).join('')}
      <div class="intake-err" id="pib-e-${p.post_id}"></div>
      <div class="intake-row">
        <button class="intake-btn" onclick="pibReject('${p.post_id}')">Reject</button>
        <button class="intake-btn primary" onclick="pibConfirm('${p.post_id}')">Confirm</button>
      </div>
    </div>`;
}

// Review checks from the server: warnings (check before confirming) and notes.
function pibFlagsHTML(p) {
  const fl = p.flags || [];
  if (!fl.length) return '<div class="pib-flags ok">Checks passed: nothing unusual found.</div>';
  const warns = fl.filter(f => f.level === 'warn').length;
  return `<div class="pib-flags${warns ? ' warn' : ''}">
    <div class="pib-flags-hd">${warns ? `${warns} thing${warns === 1 ? '' : 's'} to check before confirming` : 'Notes'}</div>
    ${fl.map(f => `<div class="pib-flag ${f.level}">${f.level === 'warn' ? '⚠ ' : '• '}${pibEsc(f.text)}</div>`).join('')}
  </div>`;
}
const pibFlaggedNames = p => new Set((p.flags || []).filter(f => f.level === 'warn').flatMap(f => f.players || []));

// A spelling that looks like a player already on file: one tap says they are the same person (and the spelling is remembered).
function pibLinkHTML(id, i, m) {
  const pid = m.status === 'linked' ? m.prospect_id : m.suggestion.prospect_id, nm = m.status === 'linked' ? m.linked_to : m.suggestion.name;
  const on = m.status === 'linked';
  return `<div class="intake-meta"><button class="intake-btn" data-pid="${pibEsc(pid)}" data-nm="${pibEsc(nm)}" onclick="pibLinkSame('${id}',${i},this)">${on ? 'Same player as ' + pibEsc(nm) + ' (tap to undo)' : 'Same player as ' + pibEsc(nm) + ' (on file)'}</button></div>`;
}
function pibLinkSame(id, i, btn) {
  const pl = pibPost(id).extraction.players[i], pid = btn.dataset.pid, nm = btn.dataset.nm;
  const m = (pibPost(id).matches || [])[i] || {};
  if (pl.match_id === pid) { delete pl.match_id; m.status = 'suggest'; m.suggestion = { prospect_id: pid, name: nm }; btn.textContent = 'Same player as ' + nm + ' (on file)'; }
  else { pl.match_id = pid; btn.textContent = 'Linked to ' + nm + ' (tap to undo)'; }
}

function pibPlayerHTML(p, pl, i) {
  const m = (p.matches || [])[i] || {};
  const badge = m.status === 'existing' ? '<span class="pib-badge">on file</span>'
    : m.status === 'ambiguous' ? '<span class="pib-badge warn">name matches several</span>'
    : m.status === 'linked' ? `<span class="pib-badge">same as ${pibEsc(m.linked_to)}</span>`
    : m.status === 'suggest' ? `<span class="pib-badge warn">looks like ${pibEsc(m.suggestion.name)}</span>`
    : '<span class="pib-badge new">new</span>';
  const id = p.post_id;
  const ranks = (pl.rankings || []).map(r => `${pibEsc(r.list)} #${r.rank}`).join(' · ');
  const facts = [pl.buy_rating != null ? 'Buy Score ' + pl.buy_rating.toFixed(1) : '', pl.action || '', pl.level ? 'Level ' + pl.level : '', pl.age != null ? 'Age ' + pl.age : '']
    .filter(Boolean).map(pibEsc).join(' · ');
  const stats = facts ? `<div class="intake-meta">${facts}</div>` : '';
  const prices = (pl.prices || []).map((x, j) => `
    <div class="pib-price"><span>${pibEsc(x.date)}</span>
      <label>Base auto $<input inputmode="decimal" value="${pibDollars(x.base_auto_cents)}" onchange="pibSetPrice('${id}',${i},${j},'base_auto_cents',this.value)"></label>
      ${x.expected_cents != null ? `<label>Expected $<input inputmode="decimal" value="${pibDollars(x.expected_cents)}" onchange="pibSetPrice('${id}',${i},${j},'expected_cents',this.value)"></label>` : ''}
    </div>`).join('');
  const take = pl.take ? `
    <div class="pib-take">
      <select class="intake-in" style="max-width:120px;margin-top:0" onchange="pibSetTake('${id}',${i},'stance',this.value)">
        ${PIB_STANCES.map(s => `<option${s === pl.take.stance ? ' selected' : ''}>${s}</option>`).join('')}
      </select>
      <textarea class="intake-in" onchange="pibSetTake('${id}',${i},'summary',this.value)">${pibEsc(pl.take.summary)}</textarea>
      ${(pl.take.key_points || []).length ? `<ul class="intake-list">${pl.take.key_points.map(k => `<li>${pibEsc(k)}</li>`).join('')}</ul>` : ''}
      ${pl.take.analysis ? `<details><summary class="intake-meta" style="cursor:pointer">His full analysis (saved as written)</summary><div style="font-size:12px;line-height:1.5;white-space:pre-wrap;margin-top:4px">${pibEsc(pl.take.analysis)}</div></details>` : ''}
    </div>` : '';
  return `
    <details class="pib-player" id="pib-pl-${id}-${i}">
      <summary>
        <input type="checkbox" checked onclick="event.stopPropagation()" onchange="pibSetInclude('${id}',${i},this.checked)">
        <b>${pibEsc(pl.name)}</b> <span class="intake-meta" style="margin:0">${pibEsc(pl.team || '')}${pl.age ? ' · ' + pl.age : ''}</span> ${badge}${pibFlaggedNames(p).has(pl.name) ? '<span class="pib-badge warn">check</span>' : ''}
        ${pl.take && pl.take.stance !== 'none' ? `<span class="pib-badge stance">${pibEsc(pl.take.stance)}</span>` : ''}${pl.action ? `<span class="pib-badge stance">${pibEsc(pl.action)}</span>` : ''}
      </summary>
      ${m.status === 'suggest' || m.status === 'linked' ? pibLinkHTML(id, i, m) : ''}
      ${ranks ? `<div class="intake-meta">${ranks}</div>` : ''}
      ${prices}${stats}${take}
    </details>`;
}

// Edits go straight into the in-memory extraction; Confirm sends that object.
function pibSetPost(id, k, v) { const p = pibPost(id); if (p) p.extraction[k] = v || null; }
function pibSetPrice(id, i, j, k, v) {
  const x = pibPost(id).extraction.players[i].prices[j], n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  x[k] = isNaN(n) ? null : Math.round(n * 100);
}
function pibSetTake(id, i, k, v) { pibPost(id).extraction.players[i].take[k] = v; }
function pibSetInclude(id, i, on) { pibPost(id).extraction.players[i]._skip = !on; }

async function pibConfirm(id) {
  const p = pibPost(id), err = document.getElementById('pib-e-' + id);
  const ex = { ...p.extraction, players: p.extraction.players.filter(x => !x._skip).map(({ _skip, ...rest }) => rest) };
  if (!ex.players.length) { err.textContent = 'Every player is unchecked. Reject the post instead.'; return; }
  if (!ex.published_date) { err.textContent = 'Set the post date first (it dates the prices).'; return; }
  err.textContent = '';
  if (typeof ppLoaded !== 'undefined') ppLoaded = false;   // Posts list refreshes next time it opens
  const d = await pibCall('/prospect-confirm', { post_id: id, extraction: ex });
  if (d.error) { err.textContent = d.error; return; }
  const c = d.counts || {};
  document.getElementById('pib-p-' + id).innerHTML = `<div class="intake-done">Saved · ${c.prospects || 0} players · ${c.takes || 0} takes · ${c.prices || 0} prices · ${c.rankings || 0} ranks</div>`;
  pibPending = pibPending.filter(x => x.post_id !== id);
  pibCount = pibPending.length; pibUpdateBadges();
}
async function pibReject(id) {
  if (!confirm('Discard this post? Nothing from it will be saved.')) return;
  const d = await pibCall('/prospect-reject', { post_id: id });
  if (d.error) { document.getElementById('pib-e-' + id).textContent = d.error; return; }
  document.getElementById('pib-p-' + id).innerHTML = '<div class="intake-meta">Rejected</div>';
  pibPending = pibPending.filter(x => x.post_id !== id);
  pibCount = pibPending.length; pibUpdateBadges();
}

// Load the count once at startup so the Inbox tab label and the Home banner are right
pibRefreshCounts();
