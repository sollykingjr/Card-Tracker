// ── Home ──────────────────────────────────────────────────────────────────────
let homeQuery = '';

function homeOpenSearchById(id) {
  const search = srData.searches.find(s => s.id === id);
  if (!search) return;
  window._pendingDigest = search.digestKey;
  window._pendingDigestLabel = search.label;
  setSection('searchresults');
}

function renderHome() {
  const root = document.getElementById('home-root');

  root.innerHTML = `
    <div class="sr-wrap">
      <div style="padding:16px 16px 0">
        <div class="si">
          <input id="home-search" placeholder="Search your collection..." autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
          <button id="home-clear">&times;</button>
        </div>
      </div>
      <div id="home-body"></div>
    </div>
  `;

  const input = document.getElementById('home-search');
  const clearBtn = document.getElementById('home-clear');
  input.value = homeQuery;
  clearBtn.classList.toggle('on', homeQuery.length > 0);

  input.addEventListener('input', e => {
    homeQuery = e.target.value;
    clearBtn.classList.toggle('on', homeQuery.length > 0);
    homeRenderBody();
  });
  clearBtn.addEventListener('click', () => {
    homeQuery = '';
    input.value = '';
    clearBtn.classList.remove('on');
    input.focus();
    homeRenderBody();
  });

  homeRenderBody();
  homeLoadQuickLinks();
}

function homeRenderBody() {
  const body = document.getElementById('home-body');
  if (!body) return;

  const q = homeQuery.trim().toLowerCase();

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

  const recent = [...cards]
    .filter(c => c.datePurchased || c.transactionDate)
    .sort((a,b) => parseDate(b.transactionDate || b.datePurchased) - parseDate(a.transactionDate || a.datePurchased))
    .slice(0, 10);

  const recentHtml = `
    <div class="srow" style="margin:16px">
      <div class="srow-t">Recent activity</div>
      ${recent.length ? recent.map(c => {
        const isSold = !!c.salePrice;
        const date = fmtShortDate(c.transactionDate || c.datePurchased);
        return `<div class="recent-row" style="cursor:pointer" onclick="ctOpenCard(${cards.indexOf(c)})">
          <div class="recent-info"><div class="rc-name">${c.fullCard || '—'}</div><div class="rc-date">${date}${isSold ? ' · Sold' : ' · Purchased'}</div></div>
          <div class="${isSold ? 'recent-sale' : 'recent-price'}">${isSold ? `$${safeNum(c.salePrice).toFixed(2)}` : `$${safeNum(c.purchasePrice).toFixed(2)}`}</div>
        </div>`;
      }).join('') : '<div style="font-size:12px;color:var(--tx3);padding:4px 0">No activity yet</div>'}
    </div>
  `;

  body.innerHTML = `
    <div class="srow" style="margin:16px">
      <div class="srow-t">Quick searches</div>
      <div id="home-quick-links"><div style="font-size:12px;color:var(--tx3);padding:4px 0">Loading...</div></div>
    </div>
    ${recentHtml}
  `;
}

async function homeLoadQuickLinks() {
  try {
    await loadData();
  } catch(e) {}
  const container = document.getElementById('home-quick-links');
  if (!container) return;
  const pinned = srData.searches.filter(s => s.showOnHome);
  if (!pinned.length) {
    container.innerHTML = '<div style="font-size:12px;color:var(--tx3);padding:4px 0">No searches pinned yet — open a search in Search Results and turn on "Show on Home Page."</div>';
    return;
  }
  container.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
      ${pinned.map(s => `<button class="sr-chip-btn" onclick="homeOpenSearchById('${s.id}')">${s.label}</button>`).join('')}
    </div>
  `;
}
