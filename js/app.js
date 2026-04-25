// ── App state ─────────────────────────────────────────────────────────────────
let section = 'prospects';
let tab = 'all', brf = 'all', posf = 'all', q = '', sortBy = 'default';

// ── Search helper ─────────────────────────────────────────────────────────────
const matchQ = (name, team) => {
  if (!q) return true;
  const t = q.toLowerCase();
  return (name || '').toLowerCase().includes(t) ||
         (team || '').toLowerCase().includes(t) ||
         (TEAM_NAMES[team || ''] || '').toLowerCase().includes(t);
};

// ── Section switcher ──────────────────────────────────────────────────────────
function setSection(s) {
  section = s;
  document.querySelectorAll('.top-tab').forEach(x => x.classList.remove('on'));
  document.querySelector(`.top-tab[data-s="${s}"]`).classList.add('on');

  const isWatch = s === 'watchlist';
  document.getElementById('prospects-section').style.display = isWatch ? 'none' : '';
  document.getElementById('hdr').style.display = '';
  document.getElementById('chips').style.display = 'none';
  document.getElementById('chips2').style.display = 'none';
  document.getElementById('sortchips').innerHTML = '';

  window.scrollTo(0, 0);

  if (isWatch) {
    document.getElementById('cntlbl').textContent = '';
    if (!watchlistLoaded) {
      loadWatchlist();
    } else {
      renderWatchlist();
    }
  } else {
    render();
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
document.getElementById('chips').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  document.querySelectorAll('#chips .chip').forEach(x => x.classList.remove('on'));
  c.classList.add('on'); brf = c.dataset.f; render();
});
document.getElementById('chips2').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  document.querySelectorAll('#chips2 .chip').forEach(x => x.classList.remove('on'));
  c.classList.add('on'); posf = c.dataset.p; render();
});
document.getElementById('search').addEventListener('input', e => {
  q = e.target.value.trim();
  document.getElementById('clear').classList.toggle('on', q.length > 0);
  render();
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
    loadWatchlist();
  } else {
    loadAll();
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadAll();
