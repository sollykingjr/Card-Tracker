// ── Card Tracker ──────────────────────────────────────────────────────────────
let ctQuery = '';

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
        <div class="si">
          <input id="ct-search" placeholder="Search name, set, year, item ID..." autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
          <button id="ct-clear">&times;</button>
        </div>
      </div>
      <div id="ct-body"></div>
    </div>
  `;

  const input = document.getElementById('ct-search');
  const clearBtn = document.getElementById('ct-clear');
  input.value = ctQuery;
  clearBtn.classList.toggle('on', ctQuery.length > 0);

  input.addEventListener('input', e => {
    ctQuery = e.target.value;
    clearBtn.classList.toggle('on', ctQuery.length > 0);
    ctRenderBody();
  });
  clearBtn.addEventListener('click', () => {
    ctQuery = '';
    input.value = '';
    clearBtn.classList.remove('on');
    input.focus();
    ctRenderBody();
  });

  ctRenderBody();
}

function ctRenderBody() {
  const body = document.getElementById('ct-body');
  if (!body) return;

  const q = ctQuery.trim().toLowerCase();

  if (q) {
    const matches = cards.filter(c => ctMatches(c, q)).slice(0, 150);
    body.innerHTML = `
      <div class="srow" style="margin:16px">
        <div class="srow-t">${matches.length} result${matches.length===1?'':'s'}</div>
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
            <div class="recent-info">
              <div class="rc-name">${c.fullCard || '—'}</div>
              <div class="rc-date">${dateLine}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
              <div class="recent-price">$${safeNum(c.purchasePrice).toFixed(2)}</div>
              <button onclick="event.stopPropagation();ctCopyId('${(c.itemId||'').replace(/'/g,"\\'")}', this)" style="padding:6px 10px;border:1px solid var(--bdr2);border-radius:8px;background:var(--surf2);color:var(--tx2);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">Copy ID</button>
            </div>
          </div>`;
        }).join('') : '<div style="font-size:12px;color:var(--tx3);padding:8px 0">No matching cards</div>'}
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
