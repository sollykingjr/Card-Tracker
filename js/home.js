// ── Home ──────────────────────────────────────────────────────────────────────
let homeQuery = '';
let homeCountdownInterval = null;

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
      <div class="srow-t">Closing soon</div>
      <div id="home-closing-soon"><div style="font-size:12px;color:var(--tx3);padding:4px 0">Loading...</div></div>
    </div>
    <div class="srow" style="margin:16px">
      <div class="srow-t">Quick searches</div>
      <div id="home-quick-links"><div style="font-size:12px;color:var(--tx3);padding:4px 0">Loading...</div></div>
    </div>
    ${recentHtml}
  `;

  homeLoadClosingSoon();
  homeLoadQuickLinks();
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

async function homeLoadClosingSoon() {
  const container = document.getElementById('home-closing-soon');
  if (!container) return;
  try {
    const res = await fetch(`${WORKER_URL}/watchlist`);
    const data = await res.json();
    if (data.error) {
      container.innerHTML = '<div style="font-size:12px;color:var(--tx3);padding:4px 0">eBay not connected</div>';
      return;
    }
    const items = data.items || [];
    const withEnd = items.filter(i => i.endTime && new Date(i.endTime).getTime() > Date.now());
    const soon = withEnd.sort((a,b) => new Date(a.endTime) - new Date(b.endTime)).slice(0, 5);
    if (!soon.length) {
      container.innerHTML = '<div style="font-size:12px;color:var(--tx3);padding:4px 0">Nothing closing soon</div>';
      return;
    }
    container.innerHTML = soon.map(item => {
      const { text, cls } = getCountdown(item.endTime);
      const price = item.currentPrice ? `$${parseFloat(item.currentPrice).toFixed(2)}` : '';
      const rawTitle = item.savedTitle || item.title || '';
      const safeTitle = rawTitle.replace(/&amp;/g,'&').replace(/&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
      const ebayUrl = `https://www.ebay.com/itm/${item.itemId}`;
      return `
        <div class="recent-row" style="align-items:flex-start">
          <div class="recent-info">
            <div class="rc-name">${safeTitle.slice(0,70)}${safeTitle.length>70?'…':''}</div>
            <div class="rc-date"><span class="wl-countdown ${cls}" data-end="${item.endTime}">${text}</span>${price ? ' · ' + price : ''}</div>
          </div>
          <a href="${ebayUrl}" target="_blank" style="flex-shrink:0;padding:6px 10px;border:1px solid var(--acc-bdr);border-radius:8px;background:var(--acc-bg);color:var(--acc);font-size:11px;font-weight:700;text-decoration:none">View</a>
        </div>
      `;
    }).join('');
    startHomeCountdownTick();
  } catch(e) {
    container.innerHTML = '<div style="font-size:12px;color:var(--tx3);padding:4px 0">Could not load watchlist</div>';
  }
}

function startHomeCountdownTick() {
  if (homeCountdownInterval) clearInterval(homeCountdownInterval);
  homeCountdownInterval = setInterval(() => {
    if (section !== 'home') { clearInterval(homeCountdownInterval); return; }
    document.querySelectorAll('#home-closing-soon .wl-countdown').forEach(el => {
      const { text, cls } = getCountdown(el.dataset.end);
      el.textContent = text;
      el.className = `wl-countdown ${cls}`;
    });
  }, 1000);
}
