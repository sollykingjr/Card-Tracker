// ── App state ─────────────────────────────────────────────────────────────────
let section = 'prospects';
let tab = 'all', brf = 'all', posf = 'all', q = '', sortBy = 'default';

// ── Search helper ─────────────────────────────────────────────────────────────
const matchQ = (name, team) => {
  if (!q) return true;
  const t = foldText(q);
  return foldText(name).includes(t) ||
         foldText(team).includes(t) ||
         foldText(TEAM_NAMES[team || '']).includes(t);
};

// ── Section switcher ──────────────────────────────────────────────────────────
function clearInactiveSection(prevSection, newSection) {
  if (prevSection === newSection) return;
  const roots = {
    home: 'home-root',
    cardtracker: 'cardtracker-root',
    portfolio: 'portfolio-root',
    settings: 'settings-root',
    ebaylistings: 'ebaylistings-root',
    searchresults: 'sr-root',
    searchbuilder: 'sb-root',
    prospects: 'list',
    watchlist: 'list'
  };
  const rootId = roots[prevSection];
  if (rootId) {
    const el = document.getElementById(rootId);
    if (el) el.innerHTML = '';
  }
  if (prevSection === 'watchlist') {
    document.getElementById('list').classList.remove('wl-grid');
    document.getElementById('wl-toolbar')?.remove();
    document.getElementById('wl-filters')?.remove();
  }
}

function setSection(s) {
  const prevSection = section;
  clearInactiveSection(prevSection, s);
  section = s;
  document.querySelectorAll('.top-tab').forEach(x => x.classList.remove('on'));
  document.querySelector(`.top-tab[data-s="${s}"]`).classList.add('on');

  const isWatch = s === 'watchlist';
  const isSB    = s === 'searchbuilder';
  const isSR    = s === 'searchresults';
  const isHome  = s === 'home';
  const isCT    = s === 'cardtracker';
  const isPort  = s === 'portfolio';
  const isSet   = s === 'settings';
  const isEL    = s === 'ebaylistings';
  document.getElementById('prospects-section').style.display = (isWatch || isSB || isSR || isHome || isCT || isPort || isSet || isEL) ? 'none' : '';
  document.getElementById('sb-root').style.display = isSB ? 'block' : 'none';
  document.getElementById('sr-root').style.display = isSR ? 'block' : 'none';
  document.getElementById('home-root').style.display = isHome ? 'block' : 'none';
  document.getElementById('cardtracker-root').style.display = isCT ? 'block' : 'none';
  document.getElementById('portfolio-root').style.display = isPort ? 'block' : 'none';
  document.getElementById('settings-root').style.display = isSet ? 'block' : 'none';
  document.getElementById('ebaylistings-root').style.display = isEL ? 'block' : 'none';
  document.getElementById('list').style.display = (isSB || isSR || isHome || isCT || isPort || isSet || isEL) ? 'none' : '';
  document.querySelector('.meta').style.display = (isSB || isSR || isHome || isCT || isPort || isSet || isEL) ? 'none' : '';
  document.getElementById('sortchips').innerHTML = '';

  window.scrollTo(0, 0);

  if (isWatch) {
    document.getElementById('cntlbl').textContent = '';
    if (!watchlistLoaded) {
      loadWatchlist();
    } else {
      renderWatchlist();
    }
  } else if (isSB) {
    document.getElementById('cntlbl').textContent = '';
    sbShow();
  } else if (isSR) {
    document.getElementById('cntlbl').textContent = '';
    initSearchResults();
  } else if (isHome) {
    document.getElementById('cntlbl').textContent = '';
    renderHome();
  } else if (isCT) {
    document.getElementById('cntlbl').textContent = '';
    renderCardTracker();
  } else if (isPort) {
    document.getElementById('cntlbl').textContent = '';
    renderPortfolio();
  } else if (isSet) {
    document.getElementById('cntlbl').textContent = '';
    renderSettings();
  } else if (isEL) {
    document.getElementById('cntlbl').textContent = '';
    renderEbayListings();
  } else {
    document.getElementById('cntlbl').textContent = '';
    if (!prospectDataLoaded) {
      loadProspectData();
    } else {
      render();
    }
  }
}

// ── Top tab events ────────────────────────────────────────────────────────────
document.getElementById('toptabs').addEventListener('click', e => {
  const t = e.target.closest('.top-tab'); if (!t) return;
  setSection(t.dataset.s);
});

// ── Prospect sub-tab events ───────────────────────────────────────────────────
document.getElementById('tabs').addEventListener('click', e => {
  const t = e.target.closest('.tab'); if (!t) return;
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('on'));
  t.classList.add('on');
  tab = t.dataset.t;
  sortBy = 'default';
  window.scrollTo(0, 0);
  render();
});

document.getElementById('sortchips').addEventListener('click', e => {
  const c = e.target.closest('.schip'); if (!c) return;
  sortBy = c.dataset.s; render();
});
const debouncedRender = debounce(render, 150);
document.getElementById('search').addEventListener('input', e => {
  q = e.target.value.trim();
  document.getElementById('clear').classList.toggle('on', q.length > 0);
  debouncedRender();
});
document.getElementById('clear').addEventListener('click', () => {
  document.getElementById('search').value = ''; q = '';
  document.getElementById('clear').classList.remove('on'); render();
});
document.getElementById('closebtn').addEventListener('click', () => document.getElementById('mwrap').classList.remove('on'));
document.getElementById('mwrap').addEventListener('click', e => {
  if (e.target === document.getElementById('mwrap')) document.getElementById('mwrap').classList.remove('on');
});
document.getElementById('rfab').addEventListener('click', () => {
  if (section === 'watchlist') {
    watchlistLoaded = false;
    loadWatchlist(true);
  } else if (section === 'home') {
    homeClosingSoonLoaded = false;
    homeLoadClosingSoon();
  } else {
    loadCardData();
    if (prospectDataLoaded) {
      prospectDataLoaded = false;
      loadProspectData();
    }
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
hydrateCardsFromCache();
const urlParams = new URLSearchParams(window.location.search);
const digestParam = urlParams.get('digest');
if (digestParam) {
  window._pendingDigest = digestParam;
  setSection('searchresults');
} else {
  // If the app was reloaded while a listing view was open, reopen it where it was left
  const resume = typeof srLoadResume === 'function' ? srLoadResume() : null;
  if (resume) {
    window._pendingDigest = resume.digestKey;
    window._pendingDigestLabel = resume.label;
    window._pendingResume = resume;
    setSection('searchresults');
  } else {
    setSection('home');
  }
}
loadCardData();
// Check the photo index version once at startup, so a refresh from another device shows up.
if (typeof ctLoadScanIndex === 'function') ctLoadScanIndex(false);
