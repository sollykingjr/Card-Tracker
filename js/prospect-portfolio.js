// Prospects > Portfolio: the prospect cards you hold, one row per player, with his Buy Score and an estimated value for your cards.
// Estimated value per card, same method as before: an auto = current base auto price x its parallel's multiplier; anything else = what you paid
// moved by how his base auto price changed since the purchase date (nearest price in his history).
let pfCache = null;

function pfBuild() {
  const byName = new Map((phData || []).map(p => [normName(p.name), p]));
  const mine = new Map(), sold = [];
  (typeof cards !== 'undefined' ? cards : []).forEach(c => {
    const row = byName.get(normName(c.player)); if (!row) return;
    if (c.salePrice) { sold.push(c); return; }
    const k = row.prospect_id;
    if (!mine.has(k)) mine.set(k, { row, cards: [], cost: 0, evCost: 0, ev: 0, evCards: 0 });
    const h = mine.get(k); h.cards.push(c); h.cost += safeNum(c.purchasePrice);
  });
  for (const h of mine.values()) {
    const now = h.row.price_cents != null ? h.row.price_cents / 100 : 0, hist = phHist[h.row.prospect_id] || [];
    for (const c of h.cards) {
      const cost = safeNum(c.purchasePrice); if (cost <= 0 || now <= 0) continue;
      const mult = getParallelMultiplier(c.fullCard, c.player);
      let ev = null;
      if (mult !== null) ev = now * mult;
      else {
        const t = parseDate(c.datePurchased || c.transactionDate);
        if (t && hist.length) {
          const near = hist.reduce((a, b) => Math.abs(phTime(b[0]) - t) < Math.abs(phTime(a[0]) - t) ? b : a);
          if (near[1] > 0) ev = cost * (1 + (h.row.price_cents - near[1]) / near[1]);
        }
      }
      if (ev != null) { h.evCost += cost; h.ev += ev; h.evCards++; }
    }
    h.pct = h.evCost > 0 ? (h.ev - h.evCost) / h.evCost * 100 : null;
    h.change = h.row.buy_rating != null && h.row.prev_buy_rating != null ? Number(h.row.buy_rating) - Number(h.row.prev_buy_rating) : null;
  }
  return { holdings: [...mine.values()], sold };
}

function pfRow(h) {
  const r = h.row, bs = r.buy_rating != null ? Number(r.buy_rating) : null;
  const dir = h.pct == null ? '' : h.pct >= 0 ? 'up' : 'down';
  const partial = h.evCards && h.evCards < h.cards.length ? ` on ${h.evCards} of ${h.cards.length} cards` : '';
  return `<div class="pf-row ${dir}" data-ph="${pibEsc(r.name)}">
    <div class="pf-bs ph-t-${phTone(bs)}">${bs != null ? phBs(bs) : '—'}</div>
    <div class="pf-main"><div class="pf-name">${pibEsc(r.name)}</div>
      <div class="pf-sub">${phWho(r)} · ${h.cards.length} owned · $${h.cost.toFixed(0)} in</div>
      <div class="pf-sub">${r.prev_buy_rating != null && bs != null && Number(r.prev_buy_rating) !== bs ? `score was ${phBs(r.prev_buy_rating)}` : (bs != null ? 'score unchanged' : 'no Buy Score')}${r.action ? ' · ' + pibEsc(r.action) : ''}</div></div>
    <div class="pf-val">${h.pct != null ? `<b class="${dir}">${h.pct > 0 ? '+' : ''}${Math.round(h.pct)}%</b><small>est. ${phMoney(Math.round(h.ev * 100))}${pibEsc(partial)}</small>` : '<small>no estimate</small>'}</div>
  </div>`;
}

function renderProspectPortfolio() {
  const listEl = document.getElementById('list');
  listEl.classList.remove('grid-2');
  document.getElementById('cntlbl').textContent = '';
  if (!phData) { listEl.innerHTML = '<div class="spin"><div class="spin-ring"></div>Loading portfolio…</div>'; phLoad(); return; }
  let { holdings, sold } = pfBuild();
  const ql = (typeof q === 'string' ? q : '').trim().toLowerCase();
  if (ql) {   // top search box narrows the whole tab to matching players
    const hit = t => String(t || '').toLowerCase().includes(ql);
    holdings = holdings.filter(h => hit(h.row.name) || hit(h.row.team));
    sold = sold.filter(c => hit(c.player) || hit(c.playerDisplay) || hit(c.fullCard));
  }
  phLoadHist(holdings.map(h => h.row.prospect_id));
  const owned = holdings.reduce((n, h) => n + h.cards.length, 0), invested = holdings.reduce((s, h) => s + h.cost, 0);
  const evCost = holdings.reduce((s, h) => s + h.evCost, 0), ev = holdings.reduce((s, h) => s + h.ev, 0), evPct = evCost > 0 ? (ev - evCost) / evCost * 100 : null;
  const soldFor = sold.reduce((s, c) => s + safeNum(c.salePrice), 0), net = sold.reduce((s, c) => s + safeNum(c.netProfit, true), 0);
  const sortKey = ['default', 'up', 'down', 'invested'].includes(sortBy) ? sortBy : 'default';
  const buyAsc = (a, b) => (a.row.buy_rating ?? 9) - (b.row.buy_rating ?? 9);
  const sorted = holdings.slice().sort(sortKey === 'up' ? (a, b) => (b.pct ?? -1e9) - (a.pct ?? -1e9)
    : sortKey === 'down' ? (a, b) => (a.pct ?? 1e9) - (b.pct ?? 1e9)
    : sortKey === 'invested' ? (a, b) => b.cost - a.cost
    : (a, b) => (a.change ?? 0) - (b.change ?? 0) || buyAsc(a, b));   // needs attention: biggest score drops first, then lowest scores
  const tile = (l, v, s, cls) => `<div class="scard"><div class="slbl">${l}</div><div class="sval ${cls || ''}">${v}</div><div class="ph-m-tilesub">${s || ''}</div></div>`;
  const sgn = n => (n >= 0 ? '+' : '-') + '$' + Math.abs(n).toFixed(2);
  const tiles = `<div class="ph-m-tiles">
    ${tile('Invested', '$' + invested.toFixed(0), owned + ' cards, ' + holdings.length + ' players')}
    ${tile('Est. value', evCost > 0 ? '$' + ev.toFixed(0) : '—', evPct != null ? `<span class="${evPct >= 0 ? 'up' : 'dn'}">${evPct >= 0 ? '+' : ''}${evPct.toFixed(0)}% vs cost</span>` : '')}
    ${tile('Sold for', '$' + soldFor.toFixed(0), sold.length + ' cards')}
    ${tile('Realized profit', sgn(net), '', net >= 0 ? 'up' : 'dn')}
  </div>`;
  // His Expected Value against the newest price, only for players you hold
  const gaps = holdings.filter(h => h.row.expected_cents != null && h.row.price_cents > 0).map(h => ({ h, pct: (h.row.expected_cents - h.row.price_cents) / h.row.price_cents * 100 }))
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 8);
  const gapHtml = gaps.length ? `<section class="ph-s"><h2>Price vs his Expected Value</h2><p>For players you hold: his Expected Value against the newest price</p>${gaps.map(g => `<div class="pf-gap" data-ph="${pibEsc(g.h.row.name)}"><span>${pibEsc(g.h.row.name)}</span><span>${phMoney(g.h.row.price_cents)} → ${phMoney(g.h.row.expected_cents)}</span><b class="${g.pct >= 0 ? 'up' : 'dn'}">${g.pct >= 0 ? '+' : ''}${Math.round(g.pct)}%</b></div>`).join('')}</section>` : '';
  const recentBuys = holdings.flatMap(h => h.cards).filter(c => c.datePurchased || c.transactionDate).sort((a, b) => parseDate(b.datePurchased || b.transactionDate) - parseDate(a.datePurchased || a.transactionDate)).slice(0, 5);
  const recentSales = sold.filter(c => c.transactionDate).sort((a, b) => parseDate(b.transactionDate) - parseDate(a.transactionDate)).slice(0, 5);
  const recent = `<div class="ph-cols"><section class="ph-s"><h2>Recent purchases</h2>${recentBuys.map(c => `<div class="recent-row" style="cursor:pointer" onclick="ctOpenOwned('${String(c.itemId || '').replace(/'/g, "\\'")}')"><div class="recent-info"><div class="rc-name">${pibEsc(c.fullCard || '—')}</div><div class="rc-date">${fmtShortDate(c.datePurchased || c.transactionDate)}</div></div><div class="recent-price">$${safeNum(c.purchasePrice).toFixed(2)}</div></div>`).join('') || '<div class="intake-meta">None yet</div>'}</section>
    <section class="ph-s"><h2>Recent sales</h2>${recentSales.map(c => { const n = safeNum(c.netProfit, true); return `<div class="recent-row"><div class="recent-info"><div class="rc-name">${pibEsc(c.fullCard || '—')}</div><div class="rc-date">${fmtShortDate(c.transactionDate)}</div></div><div class="recent-sale"><div class="rs-price">$${safeNum(c.salePrice).toFixed(2)}</div><div class="rs-net ${n >= 0 ? 'up' : 'dn'}">${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}</div></div></div>`; }).join('') || '<div class="intake-meta">None yet</div>'}</section></div>`;
  document.getElementById('cntlbl').textContent = `${holdings.length} player${holdings.length === 1 ? '' : 's'}`;
  listEl.innerHTML = tiles + `<section class="ph-s"><h2>Your holdings</h2><p>${{ default: 'Needs attention first: biggest score drops, then lowest scores', up: 'Biggest estimated gain first', down: 'Biggest estimated loss first', invested: 'Most invested first' }[sortKey]}</p>${sorted.map(pfRow).join('') || '<div class="empty-msg">No prospect cards owned</div>'}</section>`
    + `<div class="ph-cols">${gapHtml}</div>` + recent;
}
