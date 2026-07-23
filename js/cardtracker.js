// ── Card Tracker ──────────────────────────────────────────────────────────────
let ctView = 'dashboard';

function renderCardTracker() {
  const root = document.getElementById('cardtracker-root');

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
  const navHtml = `
    <div style="display:flex;gap:8px;padding:16px 16px 0">
      <button onclick="ctView='dashboard';renderCardTracker()" style="flex:1;padding:10px;border:.5px solid var(--bdr2);border-radius:8px;background:${ctView==='dashboard'?'var(--acc-bg)':'var(--surf)'};color:${ctView==='dashboard'?'var(--acc)':'var(--tx)'};font-size:13px;font-weight:500;cursor:pointer;font-family:inherit">Dashboard</button>
      <button onclick="ctView='list';renderCardTracker()" style="flex:1;padding:10px;border:.5px solid var(--bdr2);border-radius:8px;background:${ctView==='list'?'var(--acc-bg)':'var(--surf)'};color:${ctView==='list'?'var(--acc)':'var(--tx)'};font-size:13px;font-weight:500;cursor:pointer;font-family:inherit">Card List</button>
    </div>
  `;

  if (ctView === 'list') {
    root.innerHTML = `<div class="sr-wrap">${navHtml}${renderCardListView()}</div>`;
    return;
  }

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

  root.innerHTML = `<div class="sr-wrap">${navHtml}${heroHtml}${purchasesHtml}${salesHtml}${flipHtml}${recentHtml}</div>`;
}

function renderCardListView() {
  return `<div style="padding:16px;color:var(--tx3);font-size:13px">Card List view coming next.</div>`;
}
