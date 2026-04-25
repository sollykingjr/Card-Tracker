// ── Watchlist state ───────────────────────────────────────────────────────────
const WORKER_URL = 'https://card-app.maxcsolomon.workers.dev';
let watchlistItems = [];
let watchlistLoaded = false;
let countdownInterval = null;

// ── Search URLs ───────────────────────────────────────────────────────────────
const searchUrl = {
  cardladder: q => `https://app.cardladder.com/sales-history?q=${encodeURIComponent(q)}&direction=desc`,
  comc:       q => `https://www.comc.com/Cards,sr,=${q.replace(/ /g,'+')},i100`,
  ebay:       q => `https://www.ebay.com/sch/212/i.html?_nkw=${encodeURIComponent(q)}&_from=R40`,
};

// ── Fetch watchlist from Worker ───────────────────────────────────────────────
async function loadWatchlist() {
  document.getElementById('list').innerHTML = '<div class="spin"><div class="spin-ring"></div>Loading watchlist...</div>';
  document.getElementById('cntlbl').textContent = 'Loading...';
  document.getElementById('rfab').classList.add('spin');

  try {
    const res = await fetch(`${WORKER_URL}/watchlist`);
    const data = await res.json();

    if (data.error === 'not_authenticated' || data.error === 'refresh_failed') {
      document.getElementById('list').innerHTML = `
        <div style="text-align:center;padding:40px 20px">
          <div style="font-size:14px;color:var(--tx2);margin-bottom:16px">eBay connection expired</div>
          <a href="${WORKER_URL}/auth" target="_blank" style="display:inline-block;padding:10px 20px;background:var(--acc);color:#fff;border-radius:10px;font-size:14px;font-weight:500;text-decoration:none">Connect eBay</a>
        </div>`;
      document.getElementById('cntlbl').textContent = 'Not connected';
      return;
    }

    watchlistItems = data.items || [];
    watchlistLoaded = true;
    renderWatchlist();
  } catch(e) {
    document.getElementById('list').innerHTML = `<div class="err"><strong>Could not load watchlist</strong><br>${e.message}</div>`;
    document.getElementById('cntlbl').textContent = 'Error';
  }

  document.getElementById('rfab').classList.remove('spin');
}

// ── Countdown helpers ─────────────────────────────────────────────────────────
function getCountdown(endTime) {
  if (!endTime) return { text: 'No end time', cls: '' };
  const ms = new Date(endTime).getTime() - Date.now();
  if (ms <= 0) return { text: 'Ended', cls: 'wl-ended' };

  const totalSecs = Math.floor(ms / 1000);
  const hrs  = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  let text, cls;
  if (hrs < 3) {
    text = `${hrs}h ${mins}m ${secs}s`;
    cls = 'wl-urgent';
  } else if (hrs < 24) {
    text = `${hrs}h ${mins}m`;
    cls = 'wl-soon';
  } else {
    const days = Math.floor(hrs / 24);
    const remHrs = hrs % 24;
    text = days > 0 ? `${days}d ${remHrs}h` : `${hrs}h ${mins}m`;
    cls = '';
  }
  return { text, cls };
}

function startCountdownTick() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    if (tab !== 'watch') { clearInterval(countdownInterval); return; }
    document.querySelectorAll('.wl-countdown').forEach(el => {
      const endTime = el.dataset.end;
      const { text, cls } = getCountdown(endTime);
      el.textContent = text;
      el.className = `wl-countdown ${cls}`;
    });
  }, 1000);
}

// ── Copy helper ───────────────────────────────────────────────────────────────
function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    btn.style.background = 'var(--b5-bg)';
    btn.style.color = 'var(--b5-tx)';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.background = '';
      btn.style.color = '';
    }, 1200);
  });
}

// ── Save title to Worker ──────────────────────────────────────────────────────
async function saveTitle(itemId, title, btn) {
  btn.textContent = '...';
  btn.disabled = true;
  try {
    const res = await fetch(`${WORKER_URL}/save-title`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId, title })
    });
    const data = await res.json();
    if (data.ok) {
      btn.textContent = 'Saved!';
      btn.style.background = 'var(--b5-bg)';
      btn.style.color = 'var(--b5-tx)';
      setTimeout(() => {
        btn.textContent = 'Save';
        btn.style.background = '';
        btn.style.color = '';
        btn.disabled = false;
      }, 1500);
    } else {
      btn.textContent = 'Error';
      btn.disabled = false;
    }
  } catch(e) {
    btn.textContent = 'Error';
    btn.disabled = false;
  }
}
