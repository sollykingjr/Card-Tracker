// =============================================================================
// SECTION 1: STATE (~1-65)
// =============================================================================

const SB = {
  players: [],

// Keywords — each kw has state: null | 'include' | 'exclude'
  kwState: {},        // e.g. { auto: 'include', graded: 'exclude' }
  kwLogic: 'OR',
  kwMode: 'include',  // current mode toggle: 'include' | 'exclude'

  // Custom keywords
  kwCustomInclude: [],
  kwCustomExclude: [],

  // Sets
  setSelected: {},
  setLogic: 'OR',
  setCustomInclude: [],
  setCustomExclude: [],

  // Decade/year — single include/exclude mode toggle
  decadeMode: 'include',
  decadesInclude: new Set(),
  decadesExclude: new Set(),
  yearsInclude: new Set(),
  yearsExclude: new Set(),
  yearRangeInclude: { from: '', to: '' },

// Team / Sport — unified include/exclude per item
  tagMode: 'include',
  teams: [],    // { name, mode: 'include'|'exclude' }
  sports: [],   // { name, mode: 'include'|'exclude' }

  // eBay filters
  ebayListingType: 'all',
  ebayUSOnly: false,
  ebaySort: 'newest',
  ebayPriceMin: '',
  ebayPriceMax: '',
  ebaySellers: [],   // { name, exclude: bool }
  ebayFavSellers: ['dcsports87', 'comc_consignment'],

  // COMC filters
  comcListingType: 'all',
  comcExcludeQuality: false,

// Saved searches & filter panel state
  savedSearches: [],
  outputPlatform: 'ebay',
  ebayOpen: false,
  comcOpen: false,
  yearOpen: false,
  teamOpen: false,
  platformOpen: false,
};

// =============================================================================
// SECTION 2: KEYWORD & OPTION DEFINITIONS (~68-130)
// =============================================================================

const SB_KEYWORDS = [
  { id: 'auto',   label: 'Auto',   ebay: 'kw',      comc: 'kw', ebayParam: null },
  { id: 'hof',    label: 'HOF',    ebay: 'kw',      comc: 'kw', ebayParam: null },
  { id: 'rc',     label: 'RC',     ebay: 'kw',      comc: 'kw', ebayParam: null },
  { id: 'serial', label: 'Serial', ebay: 'feature', comc: 'kw', ebayParam: 'Features=Serial%2520Numbered' },
  { id: 'graded', label: 'Graded', ebay: 'feature', comc: 'kw', ebayParam: 'Graded=Yes' },
];

const SB_SPORT_OPTIONS = ['Baseball','Basketball','Football','Hockey','Soccer','Golf','MMA','Wrestling'];

const SB_TEAM_OPTIONS = [
  // MLB
  'Arizona Diamondbacks','Atlanta Braves','Baltimore Orioles','Boston Red Sox',
  'Chicago Cubs','Chicago White Sox','Cincinnati Reds','Cleveland Guardians',
  'Colorado Rockies','Detroit Tigers','Houston Astros','Kansas City Royals',
  'Los Angeles Angels','Los Angeles Dodgers','Miami Marlins','Milwaukee Brewers',
  'Minnesota Twins','New York Mets','New York Yankees','Oakland Athletics',
  'Philadelphia Phillies','Pittsburgh Pirates','San Diego Padres','San Francisco Giants',
  'Seattle Mariners','St. Louis Cardinals','Tampa Bay Rays','Texas Rangers',
  'Toronto Blue Jays','Washington Nationals',
  // NFL
  'Arizona Cardinals','Atlanta Falcons','Baltimore Ravens','Buffalo Bills',
  'Carolina Panthers','Chicago Bears','Cincinnati Bengals','Cleveland Browns',
  'Dallas Cowboys','Denver Broncos','Detroit Lions','Green Bay Packers',
  'Houston Texans','Indianapolis Colts','Jacksonville Jaguars','Kansas City Chiefs',
  'Las Vegas Raiders','Los Angeles Chargers','Los Angeles Rams','Miami Dolphins',
  'Minnesota Vikings','New England Patriots','New Orleans Saints','New York Giants',
  'New York Jets','Philadelphia Eagles','Pittsburgh Steelers','San Francisco 49ers',
  'Seattle Seahawks','Tampa Bay Buccaneers','Tennessee Titans','Washington Commanders',
  // NBA
  'Atlanta Hawks','Boston Celtics','Brooklyn Nets','Charlotte Hornets',
  'Chicago Bulls','Cleveland Cavaliers','Dallas Mavericks','Denver Nuggets',
  'Detroit Pistons','Golden State Warriors','Houston Rockets','Indiana Pacers',
  'Los Angeles Clippers','Los Angeles Lakers','Memphis Grizzlies','Miami Heat',
  'Milwaukee Bucks','Minnesota Timberwolves','New Orleans Pelicans','New York Knicks',
  'Oklahoma City Thunder','Orlando Magic','Philadelphia 76ers','Phoenix Suns',
  'Portland Trail Blazers','Sacramento Kings','San Antonio Spurs','Toronto Raptors',
  'Utah Jazz','Washington Wizards',
  // NHL
  'Anaheim Ducks','Arizona Coyotes','Boston Bruins','Buffalo Sabres',
  'Calgary Flames','Carolina Hurricanes','Chicago Blackhawks','Colorado Avalanche',
  'Columbus Blue Jackets','Dallas Stars','Detroit Red Wings','Edmonton Oilers',
  'Florida Panthers','Los Angeles Kings','Minnesota Wild','Montreal Canadiens',
  'Nashville Predators','New Jersey Devils','New York Islanders','New York Rangers',
  'Ottawa Senators','Philadelphia Flyers','Pittsburgh Penguins','San Jose Sharks',
  'Seattle Kraken','St. Louis Blues','Tampa Bay Lightning','Toronto Maple Leafs',
  'Utah Hockey Club','Vancouver Canucks','Vegas Golden Knights','Washington Capitals',
  'Winnipeg Jets',
];

const SB_DECADES = [
  { label: '1980s', val: '198' },
  { label: '1990s', val: '199' },
  { label: '2000s', val: '200' },
  { label: '2010s', val: '201' },
  { label: '2020s', val: '202' },
];

const SB_WORKER = API_BASE;

// =============================================================================
// SECTION 3: PLAYER DATA HELPERS (~133-185)
// =============================================================================

function sbGetProspectNames() {
  return (phData || []).map(p => ({ name: p.name || '', source: 'prospect' })).filter(p => p.name);
}

function sbGetPortfolioNames() {
  const seen = new Set();
  return (cards || [])
    .filter(c => c.player)
    .map(c => {
      const matched = (phData || []).find(p => normName(p.name) === normName(c.player));
      return matched ? matched.name : c.player;
    })
    .filter(n => { if (seen.has(n)) return false; seen.add(n); return true; })
    .map(n => ({ name: n, source: 'portfolio' }));
}

function sbGetAllPlayerNames() {
  const seen = new Set();
  const out = [];
  [...sbGetProspectNames(), ...sbGetPortfolioNames()].forEach(p => {
    const key = p.name.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(p); }
  });
  return out;
}

// The current Buy Score lists come from the backend (GET /prospect-buy-list): scores since the last Top Rankings post, graduated left out.
async function sbGetBuyScorePlayers(min, max) {
  const d = await pibCall('/prospect-buy-list?min=' + encodeURIComponent(min) + '&max=' + encodeURIComponent(max == null ? 5 : max));
  return (d.players || []).map(p => ({ name: p.name, source: 'prospect' }));
}

function sbUpdatePool() {
  const el = document.getElementById('sb-pool');
  if (!el) return;
  if (!SB.players.length) { el.innerHTML = '<span class="sb-empty">No players added yet</span>'; return; }
  el.innerHTML = SB.players.map((p,i) =>
    `<span class="sb-chip">${p.name}<button class="sb-chip-x" onclick="sbRemovePlayer(${i})">×</button></span>`
  ).join('');
}

async function sbApplyPreset(minScore) {
  SB.players = await sbGetBuyScorePlayers(minScore);
  sbUpdatePool();
  sbUpdateOutput();
}

async function sbApplyPresetRange(min, max) {
  const results = await sbGetBuyScorePlayers(min, max);

  // Merge into existing pool
  results.forEach(p => {
    if (!SB.players.find(x => x.name.toLowerCase() === p.name.toLowerCase())) {
      SB.players.push(p);
    }
  });
  // Auto-add Bowman to set
  SB.setSelected['Bowman'] = 'include';
  sbUpdatePool();
  sbUpdateOutput();
  sbRender();
}

// =============================================================================
// SECTION 10: KEYWORD HANDLERS (~693-720)
// =============================================================================

function sbToggleKw(id) {
  if (SB.kwState[id] === SB.kwMode) delete SB.kwState[id];
  else SB.kwState[id] = SB.kwMode;
  sbRender();
}

function sbSetLogic(val) { SB.kwLogic = val; sbRender(); }

function sbAddCustomKw(mode) {
  const inp = document.getElementById('sb-kw-custom');
  if (!inp || !inp.value.trim()) return;
  const val = inp.value.trim();
  if (mode === 'include' && !SB.kwCustomInclude.includes(val)) SB.kwCustomInclude.push(val);
  if (mode === 'exclude' && !SB.kwCustomExclude.includes(val)) SB.kwCustomExclude.push(val);
  inp.value = '';
  sbRender();
}

function sbRemoveCustomKw(mode, i) {
  if (mode === 'include') SB.kwCustomInclude.splice(i, 1);
  else SB.kwCustomExclude.splice(i, 1);
  sbRender();
}

function sbToggleSet(name) {
  if (SB.setSelected[name] === SB.kwMode) delete SB.setSelected[name];
  else SB.setSelected[name] = SB.kwMode;
  sbRender();
}

function sbAddCustomSet() {
  const inp = document.getElementById('sb-set-custom');
  if (!inp || !inp.value.trim()) return;
  const val = inp.value.trim();
  if (SB.kwMode === 'include' && !SB.setCustomInclude.includes(val)) SB.setCustomInclude.push(val);
  if (SB.kwMode === 'exclude' && !SB.setCustomExclude.includes(val)) SB.setCustomExclude.push(val);
  inp.value = '';
  sbRender();
}

function sbRemoveCustomSet(mode, i) {
  if (mode === 'include') SB.setCustomInclude.splice(i, 1);
  else SB.setCustomExclude.splice(i, 1);
  sbRender();
}

// =============================================================================
// SECTION 11: SPORT / TEAM TAG HANDLERS (~723-755)
// =============================================================================

function sbAddTag(type, manual) {
  const arr = type === 'sport' ? SB.sports : SB.teams;
  let val;
  if (manual === 'manual') {
    const inp = document.getElementById(`sb-inp-${type}`);
    val = inp ? inp.value.trim() : '';
    if (inp) inp.value = '';
  } else {
    const sel = document.getElementById(`sb-sel-${type}`);
    val = sel ? sel.value : '';
  }
  if (!val) return;
  if (!arr.find(x => x.name === val)) arr.push({ name: val, mode: SB.tagMode });
  sbRender();
}

function sbRemoveTag(type, i) {
  if (type === 'sport') SB.sports.splice(i, 1);
  else SB.teams.splice(i, 1);
  sbRender();
}

// =============================================================================
// SECTION 12: YEAR / DECADE HANDLERS (~758-790)
// =============================================================================

function sbToggleDecade(val) {
  const incl = SB.decadeMode === 'include';
  const set = incl ? SB.decadesInclude : SB.decadesExclude;
  set.has(val) ? set.delete(val) : set.add(val);
  sbRender();
}

function sbAddYears() {
  const inp = document.getElementById('sb-yr-inp');
  if (!inp) return;
  inp.value.split(',').map(y => y.trim()).filter(Boolean).forEach(y => {
    if (SB.decadeMode === 'include') SB.yearsInclude.add(y);
    else SB.yearsExclude.add(y);
  });
  inp.value = '';
  sbRender();
}

function sbSetRange() {
  const from = (document.getElementById('sb-yr-from')||{}).value;
  const to   = (document.getElementById('sb-yr-to')||{}).value;
  if (!from || !to) return;
  SB.yearRangeInclude = { from, to };
  sbRender();
}

// =============================================================================
// SECTION 13: SELLER HANDLERS (~793-840)
// =============================================================================

function sbRemoveSeller(i) { SB.ebaySellers.splice(i, 1); sbRender(); }

function sbAddSellerFromFav() {
  const sel  = document.getElementById('sb-seller-fav');
  const mode = document.getElementById('sb-seller-mode');
  if (!sel || !sel.value) return;
  const exclude = mode && mode.value === 'exclude';
  if (!SB.ebaySellers.find(s => s.name === sel.value)) SB.ebaySellers.push({ name: sel.value, exclude });
  sbRender();
}

function sbAddSellerCustom() {
  const inp  = document.getElementById('sb-seller-custom');
  const mode = document.getElementById('sb-seller-cmode');
  if (!inp || !inp.value.trim()) return;
  const exclude = mode && mode.value === 'exclude';
  const name = inp.value.trim();
  if (!SB.ebaySellers.find(s => s.name === name)) SB.ebaySellers.push({ name, exclude });
  inp.value = '';
  sbRender();
}

function sbSaveFavSeller() {
  const inp = document.getElementById('sb-seller-custom');
  if (!inp || !inp.value.trim()) return;
  const name = inp.value.trim().toLowerCase();
  if (!SB.ebayFavSellers.includes(name)) {
    SB.ebayFavSellers.push(name);
    sbSaveToKV();
  }
  sbRender();
}

// =============================================================================
// SECTION 14: OUTPUT UPDATE & ACTIONS (~843-890)
// =============================================================================

function sbUpdateOutput() {
  const str = document.getElementById('sb-out-str');
  if (!str) return;
  const text = SB.players.length
    ? (SB.outputPlatform === 'ebay' ? sbBuildEbayString() : sbBuildComcQuery()) || '—'
    : '—';
  str.textContent = text;
}

function sbCopy(platform) {
  let text = platform === 'ebay' ? sbBuildEbayString() : sbBuildComcQuery();
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const btn = event.target;
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = orig, 1500);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  });
}

function sbOpen(platform) {
  const url = platform === 'ebay' ? sbBuildEbayURL() : sbBuildComcURL();
  if (url) window.open(url, '_blank');
}

// =============================================================================
// SECTION 15: RESET & INIT (~893-930)
// =============================================================================

function sbReset() {
  SB.players          = [];
  SB.kwState          = {};
  SB.kwLogic          = 'OR';
  SB.kwCustomInclude  = [];
  SB.kwCustomExclude  = [];
  SB.decadeMode       = 'include';
  SB.decadesInclude   = new Set();
  SB.decadesExclude   = new Set();
  SB.yearsInclude     = new Set();
  SB.yearsExclude     = new Set();
  SB.yearRangeInclude = { from:'', to:'' };
  SB.teams            = [];
  SB.sports           = [];
  SB.setSelected      = {};
  SB.setLogic         = 'OR';
  SB.setCustomInclude = [];
  SB.setCustomExclude = [];
  SB.ebayListingType  = 'all';
  SB.ebayUSOnly       = false;
  SB.ebaySort         = 'newest';
  SB.ebayPriceMin     = '';
  SB.ebayPriceMax     = '';
  SB.ebaySellers      = [];
  SB.comcListingType  = 'all';
  SB.comcExcludeQuality = false;
  SB.ebayOpen         = false;
  SB.comcOpen         = false;
  SB.yearOpen         = false;
  SB.teamOpen         = false;
  SB.platformOpen     = false;
  _sbAllPlayers       = null;
  sbRender();
}

async function sbInit() {
  _sbAllPlayers = null;
  await sbLoadFromKV();
}

async function sbShow() {
  await sbInit();
  const root = document.getElementById('sb-root');
  if (!root) return;
  sbRender();
}
