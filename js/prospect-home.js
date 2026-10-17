// Prospects home (the "All" tab): search plus a few short lists of what needs attention, read from /prospect-current (one row per player).
// Worth a look (score rose to 4+) · Your players (their score changed) · From his latest posts. No full list of everyone: search finds anyone.
let phData = null, phLoading = false, phErr = null;
const PH_CACHE_KEY = 'phCurrentCache';
const phMoney = c => c == null ? '' : '$' + (c / 100).toFixed(c % 100 ? 2 : 0);
const phDate = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${+m[2]}/${+m[3]}/${m[1].slice(2)}` : ''; };
// Green / yellow / red by the score itself.
const phTone = n => n == null ? '' : n >= 4.5 ? 'hi' : n >= 3 ? 'mid' : 'lo';
const phBs = n => String(Math.round(Number(n) * 100) / 100);

function phCache() {
  try { const c = JSON.parse(localStorage.getItem(PH_CACHE_KEY) || 'null'); return c && Array.isArray(c.players) ? c.players : null; } catch (e) { return null; }
}

// Load once per visit; show the saved copy right away and refresh it in the background.
async function phLoad(force) {
  if (phLoading) return;
  if (!phData || force) { const c = phCache(); if (c && !phData) phData = c; }
  phLoading = true;
  try {
    const d = await pibCall('/prospect-current');
    if (d.error) throw new Error(d.error);
    phData = d.players || []; phErr = null;
    try { localStorage.setItem(PH_CACHE_KEY, JSON.stringify({ t: Date.now(), players: phData })); } catch (e) {}
  } catch (e) { phErr = e.message; }
  phLoading = false;
  if (section === 'prospects' && tab === 'all') renderProspectHome();
}
function phRefresh() { phLoad(true); }

// Players you currently hold cards of, keyed by normalized name (straight from the cards list).
function phOwnedMap() {
  const m = new Map();
  (typeof cards !== 'undefined' ? cards : []).forEach(c => {
    if (c.salePrice) return;
    const k = normName(c.player), o = m.get(k) || { n: 0, cost: 0, buys: [] };
    o.n++; o.cost += safeNum(c.purchasePrice); o.buys.push({ t: parseDate(c.datePurchased), cost: safeNum(c.purchasePrice) }); m.set(k, o);
  });
  return m;
}

// His base auto price when you bought, averaged over your owned cards and weighted by what you paid for each.
// Each card uses the newest price on or before its purchase date (the earliest known price if it was bought before his data starts).
let phHist = {}, phHistAsked = new Set();
function phEntryPrice(o, hist) {
  if (!o || !hist || !hist.length) return null;
  let sum = 0, w = 0, approx = false;
  for (const b of o.buys) {
    let pick = null;
    for (const [d, c] of hist) { if (new Date(d + 'T12:00:00Z').getTime() <= b.t) pick = c; else break; }
    if (pick == null) { pick = hist[0][1]; approx = true; }
    const wt = b.cost > 0 ? b.cost : 1; sum += pick * wt; w += wt;
  }
  return w ? { cents: Math.round(sum / w), approx } : null;
}
async function phLoadHist(ids) {
  const need = ids.filter(i => !phHistAsked.has(i)); if (!need.length) return;
  need.forEach(i => phHistAsked.add(i));
  try { const d = await pibCall('/prospect-price-history?ids=' + need.map(encodeURIComponent).join(',')); Object.assign(phHist, d.prices || {}); } catch (e) {}
  if (section === 'prospects' && tab === 'all' && !q) renderProspectHome();
}

// Search results: the full card (score, price, expected value, rank, age, level).
function phCard(p, owned) {
  const bs = p.buy_rating != null ? Number(p.buy_rating) : null;
  const o = owned.get(normName(p.name));
  const bits = [p.side === 'pitcher' ? 'Pitcher' : p.side === 'hitter' ? 'Hitter' : '', p.team || '', p.rank != null ? '#' + p.rank : '', p.age != null ? 'age ' + p.age : '', p.level || '']
    .filter(Boolean).map(pibEsc).join('</span><span>');
  const sub = bs != null && p.scored_dated ? 'BS ' + phDate(p.scored_dated) : '';
  return `<div class="card" data-ph="${pibEsc(p.name)}">
    <div class="cbody">
      <div class="r1"><span class="pname">${pibEsc(p.name)}</span>${p.graduated ? '<span class="ph-grad">Graduated</span>' : ''}</div>
      <div class="r2"><span>${bits}</span>${o ? `<span class="inv-badge ${invTier(o.cost)}">${o.n} owned · $${o.cost.toFixed(0)}</span>` : ''}</div>
      ${sub ? `<div class="r2" style="color:var(--tx3)">${pibEsc(sub)}</div>` : ''}
    </div>
    <div style="display:flex;align-items:center;gap:7px;flex-shrink:0">
      ${p.expected_cents != null ? `<span class="ph-exp">exp ${phMoney(p.expected_cents)}</span>` : ''}
      ${p.price_cents != null ? `<div class="pbox">${phMoney(p.price_cents)}</div>` : '<div class="pbox empty">—</div>'}
      ${bs != null ? `<span class="hs-row-bs bs-${Math.floor(bs)}">${phBs(bs)}</span>` : '<span class="hs-row-bs bs-1">—</span>'}
    </div>
  </div>`;
}

const phWho = p => [p.side === 'pitcher' ? 'Pitcher' : p.side === 'hitter' ? 'Hitter' : '', p.team || ''].filter(Boolean).map(pibEsc).join(' · ');

// Worth a look: a swipe row of tiles, the score is the biggest thing on each.
function phTile(p, owned) {
  const bs = Number(p.buy_rating), prev = p.prev_buy_rating != null ? Number(p.prev_buy_rating) : null;
  return `<div class="ph-tile" data-ph="${pibEsc(p.name)}">
    <div class="ph-tile-bs t-${phTone(bs)}">${phBs(bs)}</div>
    <div class="ph-tile-name">${pibEsc(p.name)}</div>
    <div class="ph-tile-sub">${phWho(p)}</div>
    <div class="ph-tile-foot"><span>${p.price_cents != null ? phMoney(p.price_cents) : ''}</span><span class="ph-tile-was">${prev != null ? 'was ' + phBs(prev) : 'new score'}</span></div>
  </div>`;
}

// Your players: the headline is how his base auto price moved since you bought (average entry), then his Buy Score move.
function phRow(p, owned) {
  const bs = Number(p.buy_rating), prev = Number(p.prev_buy_rating), o = owned.get(normName(p.name));
  const e = phEntryPrice(o, phHist[p.prospect_id]), now = p.price_cents;
  const pct = e && now != null && e.cents > 0 ? Math.round((now - e.cents) / e.cents * 100) : null;
  const dir = pct != null ? (pct >= 0 ? 'up' : 'down') : (bs > prev ? 'up' : 'down');
  return `<div class="ph-row ${dir}" data-ph="${pibEsc(p.name)}">
    <div class="ph-row-chg">${pct != null ? `<b>${pct > 0 ? '+' : ''}${pct}%</b><small>since you bought</small>` : `<b>${phBs(bs)}</b><small>was ${phBs(prev)}</small>`}</div>
    <div class="ph-row-main"><div class="ph-row-name">${pibEsc(p.name)}</div><div class="ph-row-sub">${phWho(p)} · ${o.n} owned · $${o.cost.toFixed(0)} in</div>
      <div class="ph-row-line">${e && now != null ? `<span>${e.approx ? '~' : ''}${phMoney(e.cents)} → ${phMoney(now)}</span>` : ''}<span class="ph-sc t-${phTone(bs)}">score ${phBs(prev)} → ${phBs(bs)}</span></div>
      ${p.note ? `<div class="ph-note">${pibEsc(p.note)}</div>` : ''}</div>
  </div>`;
}

// From his latest posts: reads like a note, with the score (green up / red down) and the card price on the right.
function phNote(p, owned) {
  const o = owned.get(normName(p.name));
  const bs = p.buy_rating != null ? Number(p.buy_rating) : null, prev = p.prev_buy_rating != null ? Number(p.prev_buy_rating) : null;
  const tone = phTone(bs);
  return `<div class="ph-item" data-ph="${pibEsc(p.name)}">
    <div class="ph-item-head">
      <div class="ph-item-id"><span class="ph-item-name">${pibEsc(p.name)}</span><span class="ph-item-meta">${phWho(p)}${o ? ' · you own' : ''}</span></div>
      <div class="ph-item-nums">${p.price_cents != null ? `<span class="ph-item-price">${phMoney(p.price_cents)}</span>` : ''}${bs != null ? `<span class="ph-item-bs ${tone}">${phBs(bs)}</span>` : ''}</div>
    </div>
    <div class="ph-note">${pibEsc(p.latest_note)}</div>
  </div>`;
}

const phDaysAgo = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - n); return t.toISOString().slice(0, 10); };

// What to show on the home, from the data (kept apart from the drawing so it can be tested).
function phHomeLists(data, owned) {
  const own = p => owned.has(normName(p.name));
  const newestScore = data.reduce((m, p) => p.scored_dated && p.scored_dated > m ? p.scored_dated : m, '');
  const newestNote = data.reduce((m, p) => p.latest_note_dated && p.latest_note_dated > m ? p.latest_note_dated : m, '');
  const scoreSince = newestScore ? phDaysAgo(newestScore, 21) : '';
  const noteSince = newestNote ? phDaysAgo(newestNote, 7) : '';
  const byBs = (a, b) => (b.buy_rating ?? -1) - (a.buy_rating ?? -1) || (b.price_cents ?? -1) - (a.price_cents ?? -1);
  // Score went up (or was first given) and is now a 4+, and not already someone you own
  const buys = data.filter(p => !p.graduated && !own(p) && p.buy_rating >= 4 && p.scored_dated >= scoreSince && (p.prev_buy_rating == null || p.buy_rating > p.prev_buy_rating)).sort(byBs).slice(0, 16);   // the screen trims this to two full rows
  // Players you hold whose score moved (drops first)
  const mine = data.filter(p => own(p) && p.prev_buy_rating != null && p.buy_rating != null && p.buy_rating !== p.prev_buy_rating && p.scored_dated >= phDaysAgo(newestScore || '2000-01-01', 45))
    .sort((a, b) => (a.buy_rating - a.prev_buy_rating) - (b.buy_rating - b.prev_buy_rating)).slice(0, 10);
  // His newest notes on players that matter to you (owned, or a 4+ score)
  const shown = new Set([...buys, ...mine].map(p => p.prospect_id));   // those cards already carry his newest note
  const notes = data.filter(p => !shown.has(p.prospect_id) && p.latest_note && p.latest_note_dated >= noteSince && (own(p) || p.buy_rating >= 4))
    .sort((a, b) => (own(b) - own(a)) || byBs(a, b)).slice(0, 8);
  const noteFor = p => p.latest_note && p.latest_note_dated >= noteSince ? p.latest_note : '';
  return { buys, mine, notes, noteFor, newestScore, newestNote };
}

function renderProspectHome() {
  const listEl = document.getElementById('list');
  listEl.classList.remove('grid-2');
  document.getElementById('cntlbl').textContent = '';
  if (!phData) {
    if (phErr) { listEl.innerHTML = `<div class="err"><strong>Could not load prospects</strong><br>${pibEsc(phErr)}<br><br>Tap refresh to try again.</div>`; return; }
    listEl.innerHTML = '<div class="spin"><div class="spin-ring"></div>Loading prospects…</div>'; phLoad(); return;
  }
  const owned = phOwnedMap();
  let html = '';
  if (q) {
    const rows = phData.filter(p => matchQ(p.name, p.team)).sort((a, b) => (b.buy_rating ?? -1) - (a.buy_rating ?? -1) || (b.price_cents ?? -1) - (a.price_cents ?? -1)).slice(0, 100);
    document.getElementById('cntlbl').textContent = `${rows.length}${rows.length === 100 ? '+' : ''} player${rows.length === 1 ? '' : 's'}`;
    html = rows.length ? rows.map(p => phCard(p, owned)).join('') : '<div class="empty-msg">No players match</div>';
  } else {
    const L = phHomeLists(phData, owned);
    const sec = (title, sub, inner, go) => inner ? `<section class="ph-s"><h2${go ? ` class="ph-go" data-go="${go}"` : ''}>${title}</h2>${sub ? `<p>${sub}</p>` : ''}${inner}</section>` : '';
    phLoadHist(L.mine.map(p => p.prospect_id));
    const withNote = p => ({ ...p, note: L.noteFor(p) });
    html = sec('Worth a look', 'Buy Score rose to 4 or higher on players you don\'t own', L.buys.length ? `<div class="ph-tiles">${L.buys.map(p => phTile(p, owned)).join('')}</div>` : '')
      + `<div class="ph-cols">`
      + sec('Your players', 'Buy Score changed since his previous score', L.mine.map(p => phRow(withNote(p), owned)).join(''), 'port')
      + sec('From his latest posts', L.newestNote ? 'notes since ' + phDate(phDaysAgo(L.newestNote, 7)) : '', L.notes.map(p => phNote(p, owned)).join(''), 'posts')
      + `</div>`;
    html = (html || '<div class="empty-msg">Nothing new right now</div>') + `<div class="ph-foot">Search above to find any of the ${phData.length} players</div>`;
  }
  listEl.innerHTML = html;
  phFitTiles();
}

// On a wide screen the tiles form a grid: show exactly two full rows, never a lone tile on a third.
function phFitTiles() {
  const t = document.querySelector('#list .ph-tiles'); if (!t) return;
  const kids = [...t.children]; kids.forEach(k => k.style.display = '');
  if (window.innerWidth < 768) return;
  const cols = (getComputedStyle(t).gridTemplateColumns || '').split(' ').filter(Boolean).length;
  if (cols > 0) kids.forEach((k, i) => { if (i >= cols * 2) k.style.display = 'none'; });
}
window.addEventListener('resize', () => { if (section === 'prospects' && tab === 'all') phFitTiles(); });

async function phOpen(name) {
  if (prospectDataReady !== true) {
    document.getElementById('mcontent').innerHTML = '<div class="spin"><div class="spin-ring"></div>Loading…</div>';
    document.getElementById('mwrap').classList.add('on');
    await phWaitOld();
    if (prospectDataReady !== true) { document.getElementById('mcontent').innerHTML = '<div class="err">Could not load the player details. Tap refresh and try again.</div>'; return; }
  }
  showDetail({ name }, 'player');
}

document.getElementById('list').addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g) { const t = document.querySelector(`#tabs .tab[data-t="${g.dataset.go}"]`); if (t) t.click(); return; }   // section titles open Portfolio / Posts
  const c = e.target.closest('[data-ph]'); if (c) phOpen(c.dataset.ph);
});
