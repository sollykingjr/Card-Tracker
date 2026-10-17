// Player modal: score first, then price, expected value, your cards, his notes and history. Reads /prospect (history) and the current-state row.
let phHot = null;   // {id: [times, straight, lastDate]} from /prospect-hotsheet, loaded once
let phModal = null; // state for the open modal (id, detail) so the Graduated toggle can redraw it

const phTime = d => new Date(d + 'T12:00:00Z').getTime();

// One history chart: Buy Score dots on top (colored by the scale, labeled), base auto price line below with $ axis; tap to read a date.
let phChartRows = [];
function phHistoryRows(m) {
  const by = new Map();
  const at = d => { if (!by.has(d)) by.set(d, { date: d, price: null, score: null, exp: null, action: null, rank: null }); return by.get(d); };
  (m.prices || []).forEach(x => { if (x.base_auto_cents != null) at(x.dated).price = x.base_auto_cents; });
  // Hobby rank and the Top 200 / Top 100 lists are one ranking; if both are on a date, the Top list wins.
  (m.rankings || []).filter(x => ['hobby rank', 'top 200 hitters', 'top 100 pitchers'].includes(x.list_name)).forEach(x => { const r = at(x.dated); if (r.rank == null || x.list_name !== 'hobby rank') r.rank = x.rank; });
  (m.snapshots || []).forEach(x => { if (x.buy_rating != null) { const r = at(x.dated); r.score = Number(x.buy_rating); r.exp = x.expected_cents; r.action = x.action; } });
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function phChart(rows) {
  const pr = rows.filter(r => r.price != null), sc = rows.filter(r => r.score != null), rk = rows.filter(r => r.rank != null);
  if (rows.length < 2) return `<div class="srow ph-m-chart"><div class="srow-t">History</div><div class="intake-meta" style="margin:4px 0 0">Not enough history yet</div></div>`;
  const W = 320, H = 330, L = 44, R = 12, t0 = phTime(rows[0].date), t1 = phTime(rows[rows.length - 1].date), sp = (t1 - t0) || 1;
  const X = d => L + (phTime(d) - t0) / sp * (W - L - R);
  const sv = sc.map(r => r.score), slo = Math.min(...sv), shi = Math.max(...sv), sspan = Math.max(shi - slo, 1), smid = (slo + shi) / 2;
  const sy = v => 78 - ((v - (smid - sspan / 2)) / sspan) * 56;                          // score lane, scaled to his range for this player -> y 78..22
  const pv = pr.map(r => r.price), lo = Math.min(...pv), hi = Math.max(...pv), pad = (hi - lo) * 0.08 || hi * 0.1 || 1;
  const a = lo - pad, b = hi + pad, py = v => 218 - (v - a) / (b - a) * 90;              // price lane -> y 218..128
  const ticks = [lo, (lo + hi) / 2, hi];
  const grid = ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${py(v).toFixed(1)}" y2="${py(v).toFixed(1)}" class="ph-c-grid"/><text x="${L - 6}" y="${(py(v) + 3).toFixed(1)}" text-anchor="end" class="ph-c-lbl">${phMoney(Math.round(v))}</text>`).join('');
  const line = pr.length > 1 ? `<polyline class="ph-c-line" points="${pr.map(r => X(r.date).toFixed(1) + ',' + py(r.price).toFixed(1)).join(' ')}"/>` : '';
  const dots = pr.map(r => `<circle cx="${X(r.date).toFixed(1)}" cy="${py(r.price).toFixed(1)}" r="2.4" class="ph-c-dot"/>`).join('');
  const lastP = pr[pr.length - 1];
  const endLbl = lastP ? `<circle cx="${X(lastP.date).toFixed(1)}" cy="${py(lastP.price).toFixed(1)}" r="4" class="ph-c-dot"/><text x="${Math.min(W - R, X(lastP.date)).toFixed(1)}" y="${(py(lastP.price) - 8).toFixed(1)}" text-anchor="end" class="ph-c-val">${phMoney(lastP.price)}</text>` : '';
  const hiI = sc.findIndex(r => r.score === shi), loI = sc.findIndex(r => r.score === slo);
  const labeled = new Set([0, sc.length - 1, hiI, loI]);   // only the first, latest, highest and lowest get a number; the rest are in the tap readout and the table
  const scores = sc.map((r, i) => `<circle cx="${X(r.date).toFixed(1)}" cy="${sy(r.score).toFixed(1)}" r="5" class="ph-c-s t-${phTone(r.score)}"/>${labeled.has(i) ? `<text x="${Math.min(W - R, Math.max(L, X(r.date))).toFixed(1)}" y="${(sy(r.score) - 9).toFixed(1)}" text-anchor="middle" class="ph-c-val t-${phTone(r.score)}">${phBs(r.score)}</text>` : ''}`).join('');
  let rankLane = '';
  if (rk.length) {
    const rv = rk.map(r => r.rank), rlo = Math.min(...rv), rhi = Math.max(...rv), rsp = Math.max(rhi - rlo, 1);
    const ry = v => 258 + (v - rlo) / rsp * 52;                                           // best (lowest number) at the top
    const lastR = rk[rk.length - 1];
    rankLane = `<text x="${L}" y="240" class="ph-c-lbl">Rank (up is better)</text>
      <line x1="${L}" x2="${W - R}" y1="${ry(rlo).toFixed(1)}" y2="${ry(rlo).toFixed(1)}" class="ph-c-grid"/><text x="${L - 6}" y="${(ry(rlo) + 3).toFixed(1)}" text-anchor="end" class="ph-c-lbl">#${rlo}</text>
      ${rhi !== rlo ? `<line x1="${L}" x2="${W - R}" y1="${ry(rhi).toFixed(1)}" y2="${ry(rhi).toFixed(1)}" class="ph-c-grid"/><text x="${L - 6}" y="${(ry(rhi) + 3).toFixed(1)}" text-anchor="end" class="ph-c-lbl">#${rhi}</text>` : ''}
      ${rk.length > 1 ? `<polyline class="ph-c-rank" points="${rk.map(r => X(r.date).toFixed(1) + ',' + ry(r.rank).toFixed(1)).join(' ')}"/>` : ''}
      ${rk.map(r => `<circle cx="${X(r.date).toFixed(1)}" cy="${ry(r.rank).toFixed(1)}" r="2.4" class="ph-c-rdot"/>`).join('')}
      <circle cx="${X(lastR.date).toFixed(1)}" cy="${ry(lastR.rank).toFixed(1)}" r="4" class="ph-c-rdot"/><text x="${Math.min(W - R, X(lastR.date)).toFixed(1)}" y="${(ry(lastR.rank) - 8).toFixed(1)}" text-anchor="end" class="ph-c-val">#${lastR.rank}</text>`;
  }
  const mid = rows[Math.floor(rows.length / 2)].date;
  const axis = [[rows[0].date, 'start'], [mid, 'middle'], [rows[rows.length - 1].date, 'end']].map(([d, an]) => `<text x="${X(d).toFixed(1)}" y="${H - 4}" text-anchor="${an}" class="ph-c-lbl">${phDate(d)}</text>`).join('');
  phChartRows = rows.map(r => ({ ...r, x: X(r.date) }));
  return `<div class="srow ph-m-chart"><div class="srow-t">History</div>
    <div class="ph-m-read" id="ph-read">Tap the chart to read a date</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Buy Score and base auto price over time" id="ph-chart">
      <text x="${L}" y="9" class="ph-c-lbl">Buy Score</text><text x="${L}" y="116" class="ph-c-lbl">Base auto price</text>
      ${grid}${line}${dots}${scores}${endLbl}${rankLane}${axis}<line id="ph-guide" x1="0" x2="0" y1="10" y2="${H - 14}" class="ph-c-guide" style="display:none"/></svg></div>`;
}
function phChartPoint(e) {
  const svg = document.getElementById('ph-chart'); if (!svg || !phChartRows.length) return;
  const box = svg.getBoundingClientRect(), x = (e.clientX - box.left) / box.width * 320;
  const r = phChartRows.reduce((best, c) => Math.abs(c.x - x) < Math.abs(best.x - x) ? c : best);
  const g = document.getElementById('ph-guide'); g.setAttribute('x1', r.x); g.setAttribute('x2', r.x); g.style.display = '';
  document.getElementById('ph-read').innerHTML = `<b>${phDate(r.date)}</b>` + (r.score != null ? ` · score <b class="ph-t-${phTone(r.score)}">${phBs(r.score)}</b>${r.action ? ' ' + pibEsc(r.action) : ''}` : '') + (r.price != null ? ` · price <b>${phMoney(r.price)}</b>` : '') + (r.exp != null ? ` · expected <b>${phMoney(r.exp)}</b>` : '') + (r.rank != null ? ` · rank <b>#${r.rank}</b>` : '');
}
document.addEventListener('pointerdown', e => { if (e.target.closest && e.target.closest('#ph-chart')) phChartPoint(e); });
document.addEventListener('pointermove', e => { if (e.buttons && e.target.closest && e.target.closest('#ph-chart')) phChartPoint(e); });

// Every date he gave numbers for, newest first, so the chart's points can be read as plain numbers.
function phHistoryTable(rows) {
  if (!rows.length) return '';
  const rev = rows.slice().reverse();
  const row = r => `<div class="ph-h-row"><span class="ph-h-d">${phDate(r.date)}</span><span class="ph-h-s ph-t-${phTone(r.score)}">${r.score != null ? phBs(r.score) : ''}</span><span>${r.price != null ? phMoney(r.price) : ''}</span><span>${r.exp != null ? phMoney(r.exp) : ''}</span><span>${r.rank != null ? '#' + r.rank : ''}</span></div>`;
  return `<div class="srow"><div class="srow-t">Every update</div><div class="ph-h-row ph-h-head"><span class="ph-h-d">Date</span><span class="ph-h-s">Score</span><span>Price</span><span>Expected</span><span>Rank</span></div>
    ${rev.slice(0, 8).map(row).join('')}${rev.length > 8 ? `<div id="ph-h-more" style="display:none">${rev.slice(8).map(row).join('')}</div><button class="ph-m-more" onclick="document.getElementById('ph-h-more').style.display='block';this.remove()">Show ${rev.length - 8} older</button>` : ''}</div>`;
}

function phNoteHtml(t) {
  const text = t.summary || t.analysis;
  if (!text) return '';
  const stance = t.stance && t.stance !== 'none' ? ` <span class="pib-badge stance">${pibEsc(t.stance)}</span>` : '';
  return `<div class="ph-m-note"><div class="ph-m-notehead"><b>${phDate(t.dated)}</b><span>${pibEsc(t.title || '')}</span>${stance}</div>
    <div class="ph-m-notetext">${pibEsc(text)}</div>
    ${t.summary && t.analysis ? `<details><summary>His full analysis</summary><div class="ph-m-notetext">${pibEsc(t.analysis)}</div></details>` : ''}</div>`;
}

function phModalHtml(name, row, m, owned, hot) {
  const snaps = (m ? m.snapshots : []).slice();            // newest first
  const scored = snaps.filter(s => s.buy_rating != null);
  const prevScore = scored.length > 1 ? scored.find(s => s.dated < scored[0].dated) : null;
  const prices = (m ? m.prices : []).slice().reverse();    // oldest first
  const hist = prices.map(p => [p.dated, p.base_auto_cents]);
  const bs = row && row.buy_rating != null ? Number(row.buy_rating) : null;
  const grad = row && row.graduated;
  const o = owned.get(normName(name));
  const side = row && row.side ? (row.side === 'pitcher' ? 'Pitcher' : 'Hitter') : '';
  const sub = [side, row && row.team, row && row.age != null ? 'age ' + row.age : '', row && row.level, row && row.rank != null ? `#${row.rank} (${phDate(row.rank_dated)})` : ''].filter(Boolean).map(pibEsc).join(' · ');
  const hotTile = `<div class="scard"><div class="slbl">Hot Sheet</div><div class="sval">${hot ? hot[0] + '×' : '—'}</div><div class="ph-m-tilesub">${hot ? (hot[1] > 1 ? hot[1] + ' in a row · ' : '') + 'last ' + phDate(hot[2]) : 'not on one yet'}</div></div>`;
  const tiles = `<div class="ph-m-tiles">
      <div class="scard"><div class="slbl">Buy Score</div><div class="sval ph-t-${phTone(bs)}">${bs != null ? phBs(bs) : '—'}</div>
        <div class="ph-m-tilesub">${bs != null ? pibEsc([row.action, phDate(row.scored_dated)].filter(Boolean).join(' · ')) : 'not scored'}${prevScore ? `<br>was ${phBs(prevScore.buy_rating)} (${phDate(prevScore.dated)})` : ''}</div></div>
      <div class="scard"><div class="slbl">Price</div><div class="sval">${row && row.price_cents != null ? phMoney(row.price_cents) : '—'}</div>
        <div class="ph-m-tilesub">${row && row.price_dated ? 'base auto, ' + phDate(row.price_dated) : ''}</div></div>
      <div class="scard"><div class="slbl">Expected Value</div><div class="sval">${row && row.expected_cents != null ? phMoney(row.expected_cents) : '—'}</div>
        <div class="ph-m-tilesub">${row && row.expected_cents != null ? (row.price_at_score_cents != null ? 'price then ' + phMoney(row.price_at_score_cents) : 'with the score') : 'none with this score'}</div></div>
      ${hotTile}
    </div>`;
  const e = o ? phEntryPrice(o, hist) : null, now = row ? row.price_cents : null;
  const entryLine = e && now != null && e.cents > 0 ? (() => { const pct = Math.round((now - e.cents) / e.cents * 100); return `<div class="ph-m-entry ${pct >= 0 ? 'up' : 'down'}"><b>${pct > 0 ? '+' : ''}${pct}%</b> since you bought <span>${e.approx ? '~' : ''}${phMoney(e.cents)} avg → ${phMoney(now)}</span></div>`; })() : '';
  const takes = (m ? m.takes : []).filter(t => t.summary || t.analysis);
  const keep = grad && !o ? 1 : 3;
  const noteBlock = takes.length ? `<div class="srow"><div class="srow-t">His notes${grad && !o ? ' (graduated: latest only)' : ''}</div>${takes.slice(0, keep).map(phNoteHtml).join('')}
      ${takes.length > keep ? `<div id="ph-more" style="display:none">${takes.slice(keep).map(phNoteHtml).join('')}</div><button class="ph-m-more" onclick="document.getElementById('ph-more').style.display='block';this.remove()">Show ${takes.length - keep} older note${takes.length - keep === 1 ? '' : 's'}</button>` : ''}</div>` : '';
  return `<div class="ph-m-top"><div><div class="mname">${pibEsc(name)}</div><div class="msub">${sub}</div></div>
      ${row ? `<button class="ph-m-grad${grad ? ' on' : ''}" onclick="phToggleGrad()">${grad ? 'Graduated' : 'Mark graduated'}</button>` : ''}</div>
    ${row ? tiles : '<div class="srow"><div class="intake-meta" style="margin:0">No prospect data for this player.</div></div>'}
    ${row && row.buy_rating != null ? '<div id="ph-m-search"><button class="ph-m-listbtn" onclick="phSearchListings()">Search listings</button></div>' : ''}
    <div id="ph-m-cards">${o ? `<div class="srow" style="margin-bottom:9px"><div class="srow-t">My cards</div>${entryLine}<div class="intake-meta" style="margin:4px 0 0">${o.n} owned · $${o.cost.toFixed(0)} invested</div></div>` : ''}</div>
    ${noteBlock}
    ${m ? phChart(phHistoryRows(m)) + phHistoryTable(phHistoryRows(m)) : ''}`;
}

async function phShowModal(name, backHtml) {
  const mc = document.getElementById('mcontent');
  mc.innerHTML = '<div class="spin"><div class="spin-ring"></div>Loading…</div>';
  document.getElementById('mwrap').classList.add('on');
  if (!phData) { phLoad(); while (phLoading) await new Promise(r => setTimeout(r, 100)); }
  const row = (phData || []).find(p => normName(p.name) === normName(name)) || null;
  const [d, h] = await Promise.all([pibCall('/prospect?name=' + encodeURIComponent(name)), phHot ? Promise.resolve(phHot) : pibCall('/prospect-hotsheet').catch(() => ({}))]);
  if (d.error) { mc.innerHTML = `<div class="err">${pibEsc(d.error)}</div>`; return; }
  if (!phHot && h && h.hot) phHot = h.hot;
  const m = d.found ? (d.matches.find(x => row && x.prospect.prospect_id === row.prospect_id) || d.matches[0]) : null;
  phModal = { name, row, m, back: backHtml || '' };
  phDrawModal();
}

function phDrawModal() {
  const { name, row, m, back } = phModal;
  const owned = phOwnedMap();
  const html = (back ? '<button class="ph-m-back" onclick="phBack()">← Back</button>' : '') + phModalHtml(name, row, m, owned, row && phHot ? phHot[row.prospect_id] : null);
  _modalMainHtml = html; _modalCurrentPlayer = name;
  document.getElementById('mcontent').innerHTML = html;
  // Card details and sold history come from the older card cache; add them once it is ready.
  if (owned.get(normName(name)) || getCardStats(name).sold.length) {
    const box = document.getElementById('ph-m-cards');
    const more = box && typeof modalCards === 'function' ? modalCards(name) : '';
    if (more) { box.insertAdjacentHTML('beforeend', more); _modalMainHtml = document.getElementById('mcontent').innerHTML; }
  }

}

// His manual switch: graduated on/off. The automatic rule still applies until he flips it.
async function phToggleGrad() {
  if (!phModal || !phModal.row) return;
  const row = phModal.row, next = !row.graduated;
  const r = await pibCall('/prospect-graduate', { prospect_id: row.prospect_id, graduated: next });
  if (r.error) return;
  row.graduated = next ? 1 : 0; row.graduated_manual = next ? 1 : 0;
  phDrawModal();
  if (section === 'prospects' && tab === 'all') renderProspectHome();
}

function phBack() { if (phModal && phModal.back) { document.getElementById('mcontent').innerHTML = phModal.back; _modalMainHtml = phModal.back; } }

// "Search listings": open the Buy Score search that covers this player (BIN or Auction) with the results already filtered to him.
async function phSearchListings() {
  if (!phModal || !phModal.row) return;
  const row = phModal.row, name = row.name, box = document.getElementById('ph-m-search');
  const say = (html) => { if (box) box.innerHTML = html; };
  say('<div class="intake-meta">Looking for his listings…</div>');
  try {
    const data = await (await fetch(`${API_BASE}/search-alerts`)).json();
    const side = row.side || 'hitter', bs = row.buy_rating;
    const cands = (data.searches || []).filter(s => s.prospectList && (s.prospectList.side || 'hitter') === side && bs >= s.prospectList.min && bs <= s.prospectList.max);
    const hits = [];
    for (const s of cands) {
      const l = await pibCall(`/prospect-buy-list?min=${s.prospectList.min}&max=${s.prospectList.max}&side=${side}`);
      if ((l.players || []).some(p => normName(p.name) === normName(name))) hits.push(s);
    }
    if (!hits.length) { say('<div class="intake-meta">No Buy Score search covers him right now. Add one in Search Results (BS list), or he is not on the current list.</div>'); return; }
    window._phListHits = { hits, groups: data.groups || [], name };
    if (hits.length === 1) return phOpenListings(0);
    say('<div class="ph-m-listrow">' + hits.map((s, i) => `<button class="ph-m-listbtn" onclick="phOpenListings(${i})">${pibEsc(s.label)}</button>`).join('') + '</div>');
  } catch (e) { say('<div class="intake-meta">Could not load searches. Try again.</div>'); }
}
function phOpenListings(i) {
  const { hits, groups, name } = window._phListHits || {}; const s = hits && hits[i]; if (!s) return;
  const g = s.groupId ? groups.find(x => x.id === s.groupId) : null;
  window._pendingDigest = g ? g.digestKey : s.digestKey;
  window._pendingDigestLabel = s.label;
  window._pendingResume = { searchId: g ? s.id : null, filterText: name.toLowerCase(), showAll: true };
  document.getElementById('mwrap').classList.remove('on');
  setSection('searchresults');
}
