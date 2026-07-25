// ── Card Tracker ──────────────────────────────────────────────────────────────
let ctQuery = '';
let ctSearchActive = false;
let ctSort = 'default';
let ctSortDir = 'desc';
let ctPage = 1;
const CT_PAGE_SIZE = 50;

function ctOpenSearch(query) {
  ctQuery = query;
  ctSearchActive = true;
  ctPage = 1;
}

function ctSetSort(key) {
  if (ctSort !== key) {
    ctSort = key;
    ctSortDir = 'desc';
  } else if (ctSortDir === 'desc') {
    ctSortDir = 'asc';
  } else {
    ctSort = 'default';
    ctSortDir = 'desc';
  }
  ctPage = 1;
  ctRenderBody();
}

function ctSetPage(p) {
  ctPage = p;
  ctRenderBody();
  document.getElementById('ct-body')?.scrollIntoView({ block: 'start' });
}

let ctScanCache = {};

async function ctFetchScansForPage(itemIds) {
  const needed = [...new Set(itemIds.filter(id => id && !(id in ctScanCache)))];
  if (!needed.length) return;
  try {
    const res = await fetch(`${WORKER_URL}/scan-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds: needed })
    });
    const data = await res.json();
    Object.assign(ctScanCache, data);
  } catch (e) {
    needed.forEach(id => { if (!(id in ctScanCache)) ctScanCache[id] = { front: null, back: null }; });
  }
  ctRenderBody();
}

function ctThumbHTML(itemId) {
  const scan = itemId ? ctScanCache[itemId] : null;
  const src = scan?.front?.thumb;
  if (src) {
    return `<img src="${src}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;border:1px solid var(--bdr2);flex-shrink:0" loading="lazy">`;
  }
  return `<div style="width:44px;height:44px;border-radius:8px;background:var(--surf2);border:1px solid var(--bdr);flex-shrink:0"></div>`;
}

function ctPaginationHTML(page, totalPages) {
  if (totalPages <= 1) return '';
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0;gap:8px">
      <button onclick="ctSetPage(${page - 1})" ${page <= 1 ? 'disabled' : ''} style="padding:8px 16px;border:1px solid var(--bdr2);border-radius:8px;background:var(--surf2);color:var(--tx);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;opacity:${page <= 1 ? '0.4' : '1'}">← Prev</button>
      <div style="font-size:12px;color:var(--tx3)">Page ${page} of ${totalPages}</div>
      <button onclick="ctSetPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''} style="padding:8px 16px;border:1px solid var(--bdr2);border-radius:8px;background:var(--surf2);color:var(--tx);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;opacity:${page >= totalPages ? '0.4' : '1'}">Next →</button>
    </div>
  `;
}

const CT_SORT_OPTS = [
  { k: 'purchaseDate', l: 'Purchase Date' },
  { k: 'saleDate', l: 'Sale Date' },
  { k: 'purchasePrice', l: 'Purchase Price' },
  { k: 'salePrice', l: 'Sale Price' }
];

function ctSortMatches(matches) {
  if (ctSort === 'default') return matches;
  const arr = matches.slice();
  const dir = ctSortDir === 'asc' ? 1 : -1;
  if (ctSort === 'purchaseDate') arr.sort((a, b) => dir * (new Date(a.datePurchased || 0) - new Date(b.datePurchased || 0)));
  else if (ctSort === 'saleDate') arr.sort((a, b) => dir * (new Date(a.transactionDate || 0) - new Date(b.transactionDate || 0)));
  else if (ctSort === 'purchasePrice') arr.sort((a, b) => dir * (safeNum(a.purchasePrice) - safeNum(b.purchasePrice)));
  else if (ctSort === 'salePrice') arr.sort((a, b) => dir * (safeNum(a.salePrice) - safeNum(b.salePrice)));
  return arr;
}

function ctMatches(c, q) {
  const hay = [c.playerDisplay, c.fullCard, c.itemId, c.serialNo, c.sport, c.year, c.set, c.variation, c.version, c.cardNo, c.grade]
    .filter(Boolean).join(' ').toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  return words.every(w => hay.includes(w));
}

function ctCopyId(id, btn) {
  if (!id) return;
  navigator.clipboard.writeText(id).then(() => {
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1200);
    }
  }).catch(()=>{});
}

function ctOpenCard(idx) {
  const c = cards[idx];
  if (!c) return;
  const date = c.transactionDate || c.datePurchased;
  document.getElementById('mcontent').innerHTML = `
    <div class="mname">${c.fullCard || c.playerDisplay || '—'}</div>
    <div class="msub">${[c.year, c.sport].filter(Boolean).join(' ')}${c.grade ? ' · Graded ' + c.grade : ''}</div>
    <div class="sgrid">
      <div class="scard"><div class="slbl">Item ID</div><div class="sval">${c.itemId || '—'}</div></div>
      <div class="scard"><div class="slbl">Serial No</div><div class="sval">${c.serialNo || '—'}</div></div>
      <div class="scard"><div class="slbl">Purchase price</div><div class="sval">$${safeNum(c.purchasePrice).toFixed(2)}</div></div>
      <div class="scard"><div class="slbl">Sale price</div><div class="sval">${c.salePrice ? '$'+safeNum(c.salePrice).toFixed(2) : '—'}</div></div>
      <div class="scard"><div class="slbl">Net profit</div><div class="sval"><span class="${safeNum(c.netProfit,true)>=0?'up':'dn'}">${safeNum(c.netProfit,true)>=0?'+':''}$${safeNum(c.netProfit,true).toFixed(2)}</span></div></div>
      <div class="scard"><div class="slbl">Date</div><div class="sval">${fmtShortDate(date)}</div></div>
    </div>
     <button onclick="ctCopyId('${(c.itemId||'').replace(/'/g,"\\'")}', this)" style="width:100%;height:40px;border:1px solid var(--acc-bdr);border-radius:10px;background:var(--acc-bg);color:var(--acc);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:4px">Copy Item ID</button>
    <div id="ct-scans" style="margin-top:14px"></div>
  `;
  document.getElementById('mwrap').classList.add('on');
  if (c.itemId) ctLoadScans(c.itemId);
}

async function ctLoadScans(itemId) {
  const box = document.getElementById('ct-scans');
  if (!box) return;
  box.innerHTML = `<div style="font-size:12px;color:var(--tx3);padding:8px 0">Loading scans...</div>`;
  try {
    const res = await fetch(`${WORKER_URL}/scan?id=${encodeURIComponent(itemId)}`);
    const data = await res.json();
    if (!document.getElementById('ct-scans')) return;
    const shots = [data.front, data.back].filter(Boolean);
    if (!shots.length) {
      box.innerHTML = `<div style="font-size:12px;color:var(--tx3);padding:8px 0">No scans found</div>`;
      return;
    }
    box.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(${shots.length},1fr);gap:8px">
        ${shots.map(s => `
          <a href="${s.link}" target="_blank" rel="noopener" style="display:block">
            <img src="${s.thumb}" style="width:100%;border-radius:10px;border:1px solid var(--bdr2);display:block" loading="lazy">
          </a>
        `).join('')}
      </div>
    `;
  } catch (e) {
    box.innerHTML = `<div style="font-size:12px;color:var(--tx3);padding:8px 0">Couldn't load scans</div>`;
  }
}

function renderCardTracker() {
  const root = document.getElementById('cardtracker-root');

  root.innerHTML = `
    <div class="sr-wrap">
      <div style="padding:16px 16px 0">
        ${searchBarHTML('ct', 'Search name, set, year, item ID...')}
      </div>
      <div id="ct-body"></div>
    </div>
  `;

  wireSearchBar('ct', () => ctQuery, v => ctQuery = v, () => {
    const q = ctQuery.trim().toLowerCase();
    if (ctSearchActive) {
      if (!q) ctSearchActive = false;
      ctPage = 1;
      ctRenderBody();
    } else {
      renderSearchDropdown('ct', q ? cards.filter(c => ctMatches(c, q)) : []);
    }
  }, () => {
    ctSearchActive = true;
    ctPage = 1;
    renderSearchDropdown('ct', []);
    ctRenderBody();
  });

  ctRenderBody();
}

function ctRenderBody() {
  const body = document.getElementById('ct-body');
  if (!body) return;

  const q = ctQuery.trim().toLowerCase();

  if (ctSearchActive) {
    const allMatches = ctSortMatches(q ? cards.filter(c => ctMatches(c, q)) : []);
    const totalPages = Math.max(1, Math.ceil(allMatches.length / CT_PAGE_SIZE));
    if (ctPage > totalPages) ctPage = totalPages;
    const startIdx = (ctPage - 1) * CT_PAGE_SIZE;
    const matches = allMatches.slice(startIdx, startIdx + CT_PAGE_SIZE);
    ctFetchScansForPage(matches.map(c => c.itemId));
    body.innerHTML = `
      <div class="sort-chips" style="margin:16px 16px 0">
        ${CT_SORT_OPTS.map(o => `<button class="schip${ctSort===o.k?' on':''}" onclick="ctSetSort('${o.k}')">${o.l}${ctSort===o.k ? (ctSortDir==='asc' ? ' ↑' : ' ↓') : ''}</button>`).join('')}
      </div>
      <div class="srow" style="margin:16px">
        <div class="srow-t">${allMatches.length} result${allMatches.length===1?'':'s'}${totalPages > 1 ? ` · Page ${ctPage} of ${totalPages}` : ''}</div>
        ${ctPaginationHTML(ctPage, totalPages)}
        ${matches.length ? matches.map(c => {
          const pDate = fmtShortDate(c.datePurchased);
          const sDate = c.salePrice ? fmtShortDate(c.transactionDate) : null;
          const dateLine = [
            c.itemId ? 'ID: ' + c.itemId : 'No item ID',
            pDate !== '—' ? 'Purchased ' + pDate : null,
            sDate && sDate !== '—' ? 'Sold ' + sDate : null
          ].filter(Boolean).join(' · ');
          return `
          <div class="recent-row" style="cursor:pointer;align-items:flex-start" onclick="ctOpenCard(${cards.indexOf(c)})">
            ${ctThumbHTML(c.itemId)}
            <div class="recent-info">
              <div style="font-size:14px;font-weight:700">${c.fullCard || '—'}</div>
              <div style="font-size:13px;color:var(--tx2);font-weight:500;margin-top:3px">${dateLine}</div>
            </div>
            <div style="display:flex;gap:16px;flex-shrink:0">
              <div style="text-align:right">
                <div style="font-size:11px;color:var(--tx3);font-weight:600">Purchase Price</div>
                <div style="font-size:14px;color:var(--tx);font-weight:700">$${safeNum(c.purchasePrice).toFixed(2)}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:11px;color:var(--tx3);font-weight:600">Sale Price</div>
                <div style="font-size:14px;color:var(--tx);font-weight:700">${c.salePrice ? '$' + safeNum(c.salePrice).toFixed(2) : 'Not sold'}</div>
              </div>
            </div>
          </div>`;
        }).join('') : '<div style="font-size:12px;color:var(--tx3);padding:8px 0">No matching cards</div>'}
        ${ctPaginationHTML(ctPage, totalPages)}
      </div>
    `;
    return;
  }

  const sold  = cards.filter(c =>  c.salePrice);
  const purchased = cards.filter(c => c.purchasePrice);
  const owned = purchased.filter(c => !c.salePrice);
  const totalPurchasesCount = purchased.length;
  const totalInvested     = purchased.reduce((s,c) => s + safeNum(c.purchasePrice), 0);
  const totalRecovered    = sold.reduce((s,c) => s + safeNum(c.salePrice, true) - safeNum(c.saleFees, true), 0);
  const realizedNetProfit = cards.reduce((s,c) => s + safeNum(c.netProfit, true), 0);

  const ownedCostBasis  = owned.reduce((s,c) => s + safeNum(c.purchasePrice), 0);
  const soldCostBasis   = sold.reduce((s,c) => s + safeNum(c.purchasePrice), 0);
  const realizedPnL     = sold.reduce((s,c) => s + safeNum(c.netProfit, true), 0);
  const sellThroughRate = totalPurchasesCount ? (sold.length / totalPurchasesCount * 100) : 0;
  const wins            = sold.filter(c => safeNum(c.netProfit, true) > 0).length;
  const winRate         = sold.length ? (wins / sold.length * 100) : 0;
  const avgROI          = soldCostBasis > 0 ? (realizedPnL / soldCostBasis * 100) : 0;

  const flipCutoff = Date.now() - 30*24*60*60*1000;
  const recentSold = sold.filter(c => parseDate(c.transactionDate || c.datePurchased) >= flipCutoff);
  const bestFlip  = recentSold.reduce((best,c)  => (!best  || safeNum(c.netProfit,true) > safeNum(best.netProfit,true))  ? c : best,  null);
  const worstFlip = recentSold.reduce((worst,c) => (!worst || safeNum(c.netProfit,true) < safeNum(worst.netProfit,true)) ? c : worst, null);

  const recent = [...cards]
    .filter(c => c.datePurchased || c.transactionDate)
    .sort((a,b) => parseDate(b.transactionDate || b.datePurchased) - parseDate(a.transactionDate || a.datePurchased))
    .slice(0, 8);

  const heroHtml = `
    <div class="srow" style="margin:16px;display:flex;gap:16px;text-align:center">
      <div style="flex:1">
        <div class="sc-l">Net position</div>
        <div style="font-size:28px;font-weight:700;margin-top:6px"><span class="${realizedNetProfit>=0?'up':'dn'}">${realizedNetProfit>=0?'+':''}$${realizedNetProfit.toFixed(2)}</span></div>
      </div>
      <div style="flex:1;border-left:1px solid var(--bdr);padding-left:16px">
        <div class="sc-l">Realized P&amp;L</div>
        <div style="font-size:28px;font-weight:700;margin-top:6px"><span class="${realizedPnL>=0?'up':'dn'}">${realizedPnL>=0?'+':''}$${realizedPnL.toFixed(2)}</span></div>
      </div>
    </div>
  `;

  const purchasesHtml = `
    <div class="srow" style="margin:16px">
      <div class="srow-t">Purchases</div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;text-align:center;margin-top:8px">
        <div><div class="sc-l">Total purchases</div><div class="sc-v">${totalPurchasesCount}</div></div>
        <div><div class="sc-l">Purchases</div><div class="sc-v">$${totalInvested.toFixed(2)}</div></div>
        <div><div class="sc-l">Cards owned</div><div class="sc-v">${owned.length}</div></div>
        <div><div class="sc-l">Owned cost basis</div><div class="sc-v">$${ownedCostBasis.toFixed(2)}</div></div>
      </div>
    </div>
  `;

  const salesHtml = `
    <div class="srow" style="margin:16px">
      <div class="srow-t">Sales</div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;text-align:center;margin-top:8px">
        <div><div class="sc-l">Total sales</div><div class="sc-v">${sold.length}</div></div>
        <div><div class="sc-l">Net sales</div><div class="sc-v">$${totalRecovered.toFixed(2)}</div></div>
        <div><div class="sc-l">Sell-through</div><div class="sc-v">${sellThroughRate.toFixed(1)}%</div></div>
        <div><div class="sc-l">Win rate</div><div class="sc-v">${winRate.toFixed(1)}%</div></div>
        <div><div class="sc-l">Avg ROI</div><div class="sc-v"><span class="${avgROI>=0?'up':'dn'}">${avgROI>=0?'+':''}${avgROI.toFixed(1)}%</span></div></div>
      </div>
    </div>
  `;

  const flipHtml = `
    <div class="srow" style="margin:16px">
      <div class="srow-t">Best &amp; worst flip (last 30 days)</div>
      <div class="recent-row">
        <div class="recent-info"><div class="rc-name">${bestFlip ? (bestFlip.fullCard || '—') : 'No sales in the last 30 days'}</div><div class="rc-date">Best flip</div></div>
        ${bestFlip ? `<div class="recent-sale"><span class="up">+$${safeNum(bestFlip.netProfit, true).toFixed(2)}</span></div>` : ''}
      </div>
      <div class="recent-row">
        <div class="recent-info"><div class="rc-name">${worstFlip ? (worstFlip.fullCard || '—') : 'No sales in the last 30 days'}</div><div class="rc-date">Worst flip</div></div>
        ${worstFlip ? `<div class="recent-sale"><span class="${safeNum(worstFlip.netProfit,true)>=0?'up':'dn'}">${safeNum(worstFlip.netProfit,true)>=0?'+':''}$${safeNum(worstFlip.netProfit, true).toFixed(2)}</span></div>` : ''}
      </div>
    </div>
  `;

  const recentHtml = `
    <div class="srow" style="margin:16px">
      <div class="srow-t">Recent activity</div>
      ${recent.length ? recent.map(c => {
        const isSold = !!c.salePrice;
        const date = fmtShortDate(c.transactionDate || c.datePurchased);
        return `<div class="recent-row">
          <div class="recent-info"><div class="rc-name">${c.fullCard || '—'}</div><div class="rc-date">${date}${isSold ? ' · Sold' : ' · Purchased'}</div></div>
          <div class="${isSold ? 'recent-sale' : 'recent-price'}">${isSold ? `$${safeNum(c.salePrice).toFixed(2)}` : `$${safeNum(c.purchasePrice).toFixed(2)}`}</div>
        </div>`;
      }).join('') : '<div style="font-size:12px;color:var(--tx3);padding:4px 0">No activity yet</div>'}
    </div>
  `;

  body.innerHTML = `${heroHtml}${purchasesHtml}${salesHtml}${flipHtml}${recentHtml}`;
}
