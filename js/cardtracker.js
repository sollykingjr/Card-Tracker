// ── Card Tracker ──────────────────────────────────────────────────────────────
let ctView = 'dashboard';

function renderCardTracker() {
  const root = document.getElementById('cardtracker-root');

  const owned = cards.filter(c => !c.salePrice);
  const sold  = cards.filter(c =>  c.salePrice);
  const totalInvested     = owned.reduce((s,c) => s + safeNum(c.purchasePrice), 0);
  const totalRecovered    = sold.reduce((s,c) => s + safeNum(c.salePrice), 0);
  const realizedNetProfit = sold.reduce((s,c) => s + safeNum(c.netProfit, true), 0);
  const netCashPosition   = totalInvested - realizedNetProfit;

  const navHtml = `
    <div style="display:flex;gap:8px;padding:16px 16px 0">
      <button onclick="ctView='dashboard';renderCardTracker()" style="flex:1;padding:10px;border:.5px solid var(--bdr2);border-radius:8px;background:${ctView==='dashboard'?'var(--acc-bg)':'var(--surf)'};color:${ctView==='dashboard'?'var(--acc)':'var(--tx)'};font-size:13px;font-weight:500;cursor:pointer;font-family:inherit">Dashboard</button>
      <button onclick="ctView='list';renderCardTracker()" style="flex:1;padding:10px;border:.5px solid var(--bdr2);border-radius:8px;background:${ctView==='list'?'var(--acc-bg)':'var(--surf)'};color:${ctView==='list'?'var(--acc)':'var(--tx)'};font-size:13px;font-weight:500;cursor:pointer;font-family:inherit">Card List</button>
    </div>
  `;

  if (ctView === 'list') {
    root.innerHTML = navHtml + renderCardListView();
    return;
  }

  const recent = [...cards]
    .filter(c => c.datePurchased || c.transactionDate)
    .sort((a,b) => parseDate(b.transactionDate || b.datePurchased) - parseDate(a.transactionDate || a.datePurchased))
    .slice(0, 8);

  const statHtml = `
    <div class="srow" style="margin:16px">
      <div class="srow-t">Overview</div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;text-align:center;margin-top:8px">
        <div><div class="sc-l">Cards owned</div><div class="sc-v">${owned.length}</div></div>
        <div><div class="sc-l">Total invested</div><div class="sc-v">$${totalInvested.toFixed(0)}</div></div>
        <div><div class="sc-l">Cards sold</div><div class="sc-v">${sold.length}</div></div>
        <div><div class="sc-l">Total recovered</div><div class="sc-v">$${totalRecovered.toFixed(0)}</div></div>
        <div><div class="sc-l">Net cash position</div><div class="sc-v"><span class="${netCashPosition>=0?'up':'dn'}">${netCashPosition>=0?'+':''}$${netCashPosition.toFixed(0)}</span></div></div>
        <div><div class="sc-l">Realized profit</div><div class="sc-v"><span class="${realizedNetProfit>=0?'up':'dn'}">${realizedNetProfit>=0?'+':''}$${realizedNetProfit.toFixed(2)}</span></div></div>
      </div>
    </div>
  `;

  const recentHtml = `
    <div class="srow" style="margin:16px">
      <div class="srow-t">Recent
