// Prospects home (the "All" tab): search plus a few short lists of what needs attention, read from /prospect-current (one row per player).
// Worth a look (score rose to 4+) · Your players (their score changed) · From his latest posts. No full list of everyone: search finds anyone.
let phData = null, phLoading = false, phErr = null;
const PH_CACHE_KEY = 'phCurrentCache';
const phMoney = c => c == null ? '' : '$' + (c / 100).toFixed(c % 100 ? 2 : 0);
const phDate = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${+m[2]}/${+m[3]}/${m[1].slice(2)}` : ''; };
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
    const k = normName(c.player), o = m.get(k) || { n: 0, cost: 0 };
    o.n++; o.cost += safeNum(c.purchasePrice); m.set(k, o);
  });
  return m;
}

// brief = the home lists (name, team, price, score and what changed); the full card is for search results.
function phCard(p, owned, brief) {
  const bs = p.buy_rating != null ? Number(p.buy_rating) : null;
  const prev = p.prev_buy_rating != null ? Number(p.prev_buy_rating) : null;
  const o = owned.get(normName(p.name));
  const bits = (brief ? [p.side === 'pitcher' ? 'Pitcher' : p.side === 'hitter' ? 'Hitter' : '', p.team || '']
    : [p.side === 'pitcher' ? 'Pitcher' : p.side === 'hitter' ? 'Hitter' : '', p.team || '', p.rank != null ? '#' + p.rank : '', p.age != null ? 'age ' + p.age : '', p.level || ''])
    .filter(Boolean).map(pibEsc).join('</span><span>');
  const chg = brief && prev != null && bs != null && prev !== bs
    ? `<span class="ph-chg ${bs > prev ? 'up' : 'down'}">${phBs(prev)} → ${phBs(bs)}</span>` : '';
  const sub = !brief && bs != null && p.scored_dated ? 'BS ' + phDate(p.scored_dated) : '';
  const snip = brief && brief.note ? `<div class="ph-note">${pibEsc(brief.note)}</div>` : '';
  return `<div class="card" data-ph="${pibEsc(p.name)}" ${snip ? 'style="align-items:flex-start"' : ''}>
    <div class="cbody">
      <div class="r1"><span class="pname">${pibEsc(p.name)}</span>${p.graduated ? '<span class="ph-grad">Graduated</span>' : ''}</div>
      <div class="r2"><span>${bits}</span>${o ? `<span class="inv-badge ${invTier(o.cost)}">${o.n} owned · $${o.cost.toFixed(0)}</span>` : ''}</div>
      ${sub ? `<div class="r2" style="color:var(--tx3)">${pibEsc(sub)}</div>` : ''}${snip}
    </div>
    <div style="display:flex;align-items:center;gap:7px;flex-shrink:0">
      ${chg}
      ${!brief && p.expected_cents != null ? `<span class="ph-exp">exp ${phMoney(p.expected_cents)}</span>` : ''}
      ${p.price_cents != null ? `<div class="pbox">${phMoney(p.price_cents)}</div>` : '<div class="pbox empty">—</div>'}
      ${bs != null ? `<span class="hs-row-bs bs-${Math.floor(bs)}">${phBs(bs)}</span>` : '<span class="hs-row-bs bs-1">—</span>'}
    </div>
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
  const buys = data.filter(p => !p.graduated && !own(p) && p.buy_rating >= 4 && p.scored_dated >= scoreSince && (p.prev_buy_rating == null || p.buy_rating > p.prev_buy_rating)).sort(byBs).slice(0, 8);
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
    const sec = (title, sub, rows, mk) => rows.length ? `<div class="ph-sec"><span>${title}</span>${sub ? `<small>${sub}</small>` : ''}</div>${rows.map(mk).join('')}` : '';
    html = sec('Worth a look', 'Buy Score went up to 4+, not owned', L.buys, p => phCard(p, owned, { note: L.noteFor(p) }))
      + sec('Your players', 'Buy Score changed', L.mine, p => phCard(p, owned, { note: L.noteFor(p) }))
      + sec('From his latest posts', L.newestNote ? 'notes since ' + phDate(phDaysAgo(L.newestNote, 7)) : '', L.notes, p => phCard(p, owned, { note: p.latest_note }));
    html = (html || '<div class="empty-msg">Nothing new right now</div>') + `<div class="ph-foot">Search above to find any of the ${phData.length} players</div>`;
  }
  listEl.innerHTML = html;
}

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
  const c = e.target.closest('.card[data-ph]'); if (c) phOpen(c.dataset.ph);
});
