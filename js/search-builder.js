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
  { id: 'rc',     label: 'RC',     ebay: 'feature', comc: 'kw', ebayParam: 'Features=Rookie' },
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

const SB_WORKER = 'https://card-app.maxcsolomon.workers.dev';

// =============================================================================
// SECTION 3: PLAYER DATA HELPERS (~133-185)
// =============================================================================

function sbGetProspectNames() {
  return (players || []).map(p => ({ name: p.name || '', source: 'prospect' })).filter(p => p.name);
}

function sbGetPortfolioNames() {
  const seen = new Set();
  return (cards || [])
    .filter(c => c.player)
    .map(c => {
      const matched = players.find(p => normName(p.name) === normName(c.player));
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

function sbGetBuyScorePlayers(minScore) {
  if (!CACHE) return [];
  const results = [];
  const seen = new Set();
  CACHE.forEach((entry, normNameKey) => {
    const bs = parseFloat(entry.buy);
    if (!isNaN(bs) && bs >= minScore) {
      const player = players.find(p => normName(p.name) === normNameKey);
      const name = player ? player.name : normNameKey;
      if (name && !seen.has(name)) { seen.add(name); results.push({ name, source: 'prospect' }); }
    }
  });
  return results;
}

// =============================================================================
// SECTION 4: URL / STRING BUILDERS (~188-310)
// =============================================================================

function sbKwsForMode(mode) {
  return SB_KEYWORDS.filter(k => SB.kwState[k.id] === mode);
}

function sbBuildEbayURL() {
  const pNames = SB.players.map(p => p.name);
  if (!pNames.length) return '';

  const playerStr = pNames.length === 1 ? pNames[0] : '(' + pNames.join(',') + ')';

  const kwIncl = sbKwsForMode('include').filter(k => k.ebay === 'kw').map(k => k.id);
  const kwExcl = sbKwsForMode('exclude').filter(k => k.ebay === 'kw').map(k => k.id);
  const customIncl = SB.kwCustomInclude;
  const customExcl = SB.kwCustomExclude;

  let kwStr = '';
  const allIncl = [...kwIncl, ...customIncl];
  if (allIncl.length) {
    kwStr = SB.kwLogic === 'OR' && allIncl.length > 1
      ? '(' + allIncl.join(',') + ')'
      : allIncl.join(' ');
  }
  const exclStr = [...kwExcl, ...customExcl].map(k => '-' + k).join(' ');

  const nkwParts = [playerStr, kwStr, exclStr].filter(Boolean);
  const params = new URLSearchParams();
  params.set('_nkw', nkwParts.join(' '));
  params.set('_from', 'R40');
  params.set('_fss', '1');
  params.set('_dcat', '261328');

  if (SB.ebayListingType === 'auction') params.set('LH_Auction', '1');
  if (SB.ebayListingType === 'bin')     params.set('LH_BIN', '1');
  if (SB.ebayUSOnly)                    params.set('LH_PrefLoc', '1');
  if (SB.ebaySort === 'newest')         params.set('_sop', '10');
  if (SB.ebaySort === 'ending')         params.set('_sop', '1');
  if (SB.ebayPriceMin)                  params.set('_udlo', SB.ebayPriceMin);
  if (SB.ebayPriceMax)                  params.set('_udhi', SB.ebayPriceMax);

  const inclSellers = SB.ebaySellers.filter(s => !s.exclude);
  const exclSellers = SB.ebaySellers.filter(s => s.exclude);
  if (inclSellers.length) {
    params.set('_sasl', inclSellers.map(s => s.name).join(', '));
    params.set('_saslop', '1');
    params.set('LH_SpecificSeller', '1');
  } else if (exclSellers.length) {
    params.set('_sasl', exclSellers.map(s => s.name).join(', '));
    params.set('_saslop', '2');
    params.set('LH_SpecificSeller', '1');
  }

  // eBay feature filters
  const featureVals = [];
  sbKwsForMode('include').filter(k => k.ebay === 'feature').forEach(k => {
    if (k.ebayParam.startsWith('Features=')) featureVals.push(k.ebayParam.replace('Features=', ''));
    else { const [pk, pv] = k.ebayParam.split('='); params.set(pk, pv); }
  });
  if (featureVals.length) { params.set('Features', featureVals.join('%7C')); params.set('_oaa', '1'); }

  // Sport / Team
  const sportsIncl = SB.sports.filter(s => s.mode === 'include').map(s => s.name);
  const teamsIncl  = SB.teams.filter(t => t.mode === 'include').map(t => t.name);
  if (sportsIncl.length) params.set('Sport', sportsIncl.join('%7C'));
  if (teamsIncl.length)  params.set('Team', teamsIncl.join('%7C').replace(/ /g, '%2520'));

  // Years
  if (SB.yearsInclude.size) { params.set('Season', [...SB.yearsInclude].join('%7C')); params.set('_oaa', '1'); }

  return 'https://www.ebay.com/sch/261328/i.html?' + params.toString();
}

function sbBuildEbayString() {
  const pNames = SB.players.map(p => p.name);
  if (!pNames.length) return '';
  const playerStr = pNames.length === 1 ? pNames[0] : '(' + pNames.join(', ') + ')';
  const kwIncl = sbKwsForMode('include').filter(k => k.ebay === 'kw').map(k => k.label);
  const kwExcl = sbKwsForMode('exclude').filter(k => k.ebay === 'kw').map(k => '-' + k.label);
  const setIncl = Object.entries(SB.setSelected).filter(([,v])=>v==='include').map(([k])=>k);
  const setExcl = Object.entries(SB.setSelected).filter(([,v])=>v==='exclude').map(([k])=>'-'+k);
  return [playerStr, ...kwIncl, ...SB.kwCustomInclude, ...setIncl, ...SB.setCustomInclude, ...kwExcl, ...SB.kwCustomExclude.map(k=>'-'+k), ...setExcl, ...SB.setCustomExclude.map(s=>'-'+s)].filter(Boolean).join(' ');
}

function sbBuildComcQuery() {
  const pNames = SB.players.map(p => p.name);
  if (!pNames.length) return '';

  const playerParts = pNames.map(n => n.includes(' ') ? `"${n}"` : n);
  const playerStr = playerParts.length === 1 ? playerParts[0] : '(' + playerParts.join(' | ') + ')';
  const parts = [playerStr];

  const kwIncl = sbKwsForMode('include').filter(k => k.comc === 'kw').map(k => k.id);
  const kwExcl = sbKwsForMode('exclude').filter(k => k.comc === 'kw').map(k => k.id);
  const allIncl = [...kwIncl, ...SB.kwCustomInclude];

  if (allIncl.length) {
    if (SB.kwLogic === 'OR' && allIncl.length > 1) parts.push('(' + allIncl.join('|') + ')');
    else allIncl.forEach(k => parts.push(k));
  }

  SB.sports.filter(s => s.mode === 'include').forEach(s => parts.push(s.name.toLowerCase()));
  SB.teams.filter(t => t.mode === 'include').forEach(t => parts.push(t.name.includes(' ') ? `"${t.name}"` : t.name));

  // Decades / years include
  const dyParts = [];
  SB.decadesInclude.forEach(d => dyParts.push(d + '*'));
  SB.yearsInclude.forEach(y => dyParts.push(y));
  if (SB.yearRangeInclude.from && SB.yearRangeInclude.to) {
    for (let y = parseInt(SB.yearRangeInclude.from); y <= parseInt(SB.yearRangeInclude.to); y++) dyParts.push(String(y));
  }
  if (dyParts.length === 1) parts.push(dyParts[0]);
  else if (dyParts.length > 1) parts.push('(' + dyParts.join('|') + ')');

 // Sets
  const setIncl = Object.entries(SB.setSelected).filter(([,v])=>v==='include').map(([k])=>k);
  const setExcl = Object.entries(SB.setSelected).filter(([,v])=>v==='exclude').map(([k])=>k);
  if (setIncl.length) {
    if (SB.setLogic === 'OR' && setIncl.length > 1) parts.push('(' + setIncl.join('|') + ')');
    else setIncl.forEach(s => parts.push(s));
  }
  [...SB.setCustomInclude].forEach(s => parts.push(s));

  // Exclusions
  [...kwExcl, ...SB.kwCustomExclude].forEach(k => parts.push('-' + k));
  setExcl.forEach(s => parts.push('-' + s));
  [...SB.setCustomExclude].forEach(s => parts.push('-' + s));
  SB.sports.filter(s => s.mode === 'exclude').forEach(s => parts.push('-' + s.name.toLowerCase()));
  SB.teams.filter(t => t.mode === 'exclude').forEach(t => parts.push('-' + (t.name.includes(' ') ? `"${t.name}"` : t.name)));
  SB.decadesExclude.forEach(d => parts.push('-' + d + '*'));
  SB.yearsExclude.forEach(y => parts.push('-' + y));
  if (SB.comcExcludeQuality) parts.push('-COMC');

  return parts.join(' ');
}

function sbBuildComcURL() {
  const query = sbBuildComcQuery();
  if (!query) return '';
  const encoded = sbEncodeComc(query);
  let url = 'https://www.comc.com/Cards,sr,';
  if (SB.comcListingType === 'all')          url += `+(${encoded}),i100`;
  if (SB.comcListingType === 'bin')          url += `+(${encoded}),fb,i100`;
  if (SB.comcListingType === 'auction')      url += `+(${encoded}),fa,i100`;
  if (SB.comcListingType === 'soldout')      url += `+(${encoded}),ot,i100`;
  if (SB.comcListingType === 'auctionsoldout') url += `+(${encoded}),ot,fa,i100`;
  return url;
}

function sbEncodeComc(query) {
  return query
    .replace(/"/g,  '~22')
    .replace(/\|/g, '~7c')
    .replace(/\*/g, '{42}')
    .replace(/\./g, '%7B46%7D')
    .replace(/ /g,  '+');
}

// =============================================================================
// SECTION 5: CLOUDFLARE KV SYNC (~313-365)
// =============================================================================

async function sbLoadFromKV() {
  try {
    const res = await fetch(`${SB_WORKER}/sb-data`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.savedSearches) SB.savedSearches = data.savedSearches;
    if (data.favSellers)    SB.ebayFavSellers = data.favSellers;
  } catch(e) {}
}

async function sbSaveToKV() {
  try {
    await fetch(`${SB_WORKER}/sb-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ savedSearches: SB.savedSearches, favSellers: SB.ebayFavSellers })
    });
  } catch(e) {}
}

// =============================================================================
// SECTION 6: SAVED SEARCHES (~368-420)
// =============================================================================

function sbSerializeState() {
  return {
    players: SB.players,
    kwState: SB.kwState,
    kwLogic: SB.kwLogic,
    kwCustomInclude: SB.kwCustomInclude,
    kwCustomExclude: SB.kwCustomExclude,
    decadesInclude: [...SB.decadesInclude],
    decadesExclude: [...SB.decadesExclude],
    yearsInclude: [...SB.yearsInclude],
    yearsExclude: [...SB.yearsExclude],
    yearRangeInclude: SB.yearRangeInclude,
    teams: SB.teams,
    sports: SB.sports,
    setSelected: SB.setSelected,
    setLogic: SB.setLogic,
    setCustomInclude: SB.setCustomInclude,
    setCustomExclude: SB.setCustomExclude,
    ebayListingType: SB.ebayListingType,
    ebayUSOnly: SB.ebayUSOnly,
    ebaySort: SB.ebaySort,
    ebayPriceMin: SB.ebayPriceMin,
    ebayPriceMax: SB.ebayPriceMax,
    ebaySellers: SB.ebaySellers,
    comcListingType: SB.comcListingType,
    comcExcludeQuality: SB.comcExcludeQuality,
  };
}

function sbRestoreState(s) {
  SB.players          = s.players || [];
  SB.kwState          = s.kwState || {};
  SB.kwLogic          = s.kwLogic || 'OR';
  SB.kwCustomInclude  = s.kwCustomInclude || [];
  SB.kwCustomExclude  = s.kwCustomExclude || [];
  SB.decadesInclude   = new Set(s.decadesInclude || []);
  SB.decadesExclude   = new Set(s.decadesExclude || []);
  SB.yearsInclude     = new Set(s.yearsInclude || []);
  SB.yearsExclude     = new Set(s.yearsExclude || []);
  SB.yearRangeInclude = s.yearRangeInclude || { from:'', to:'' };
  SB.teams            = s.teams || [];
  SB.sports           = s.sports || [];
  SB.setSelected      = s.setSelected || {};
  SB.setLogic         = s.setLogic || 'OR';
  SB.setCustomInclude = s.setCustomInclude || [];
  SB.setCustomExclude = s.setCustomExclude || [];
  SB.ebayListingType  = s.ebayListingType || 'all';
  SB.ebayUSOnly       = s.ebayUSOnly || false;
  SB.ebaySort         = s.ebaySort || 'newest';
  SB.ebayPriceMin     = s.ebayPriceMin || '';
  SB.ebayPriceMax     = s.ebayPriceMax || '';
  SB.ebaySellers      = s.ebaySellers || [];
  SB.comcListingType  = s.comcListingType || 'all';
  SB.comcExcludeQuality = s.comcExcludeQuality || false;
}

function sbSaveSearch() {
  const name = prompt('Name this search:');
  if (!name || !name.trim()) return;
  SB.savedSearches.push({ name: name.trim(), state: sbSerializeState(), ts: Date.now() });
  sbSaveToKV();
  sbRender();
}

function sbLoadSearch(i) {
  sbRestoreState(SB.savedSearches[i].state);
  sbRender();
}

function sbDeleteSearch(i) {
  SB.savedSearches.splice(i, 1);
  sbSaveToKV();
  sbRender();
}

// =============================================================================
// SECTION 7: RENDER (~423-600)
// =============================================================================

function sbRender() {
  const el = document.getElementById('sb-root');
  if (!el) return;

  const decMode = SB.decadeMode;

  el.innerHTML = `
    <div class="sb-sticky-reset">
      <button onclick="sbReset()">Reset All</button>
    </div>
    <div class="sb-wrap">

      <!-- Presets & Saved Searches -->
      <div class="sb-section">
        <div class="sb-section-title">Presets & Saved Searches</div>
        <div class="sb-presets">
          <button class="sb-preset-btn" onclick="sbApplyPreset(5.0)">BS ≥ 5.0</button>
          <button class="sb-preset-btn" onclick="sbApplyPreset(4.5)">BS ≥ 4.5</button>
          <button class="sb-preset-btn" onclick="sbApplyPreset(4.0)">BS ≥ 4.0</button>
        </div>
        ${SB.savedSearches.length ? `
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
            ${SB.savedSearches.map((s,i) => `
              <div style="display:flex;align-items:center;gap:4px;background:var(--acc-bg);border-radius:20px;padding:4px 10px">
                <button style="background:none;border:none;color:var(--acc);font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;padding:0" onclick="sbLoadSearch(${i})">${s.name}</button>
                <button style="background:none;border:none;color:var(--tx3);font-size:13px;cursor:pointer;padding:0;line-height:1" onclick="sbDeleteSearch(${i})">×</button>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>

      <!-- Player Pool -->
      <div class="sb-section">
        <div class="sb-section-title">Player Pool</div>
        <div class="sb-typeahead">
          <input id="sb-search" placeholder="Search or type player name, press Enter to add…"
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
            oninput="sbOnSearch(this.value)"
            onkeydown="if(event.key==='Enter'){sbAddFromInput();}"
            onblur="sbHideDD()">
          <div class="sb-dropdown" id="sb-dd" style="display:none"></div>
        </div>
        <div class="sb-pool" id="sb-pool">
          ${SB.players.length
            ? SB.players.map((p,i) => `<span class="sb-chip">${p.name}<button class="sb-chip-x" onclick="sbRemovePlayer(${i})">×</button></span>`).join('')
            : '<span class="sb-empty">No players added yet</span>'
          }
        </div>
      </div>

      <!-- Keywords -->
      <div class="sb-section">
        <div class="sb-section-title">Keywords</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <div class="sb-and-or">
            <button class="${SB.kwMode==='include'?'on':''}" onclick="SB.kwMode='include';sbRender()">Include</button>
            <button class="${SB.kwMode==='exclude'?'on':''}" onclick="SB.kwMode='exclude';sbRender()">Exclude</button>
          </div>
          <span style="font-size:10px;color:var(--tx3);margin-left:4px">then tap keywords</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span class="sb-label">Logic:</span>
          <div class="sb-and-or">
            <button class="${SB.kwLogic==='OR'?'on':''}" onclick="sbSetLogic('OR')">OR</button>
            <button class="${SB.kwLogic==='AND'?'on':''}" onclick="sbSetLogic('AND')">AND</button>
          </div>
        </div>
        <div class="sb-kw-grid">
          ${SB_KEYWORDS.map(k => {
            const st = SB.kwState[k.id];
            const cls = st === 'include' ? 'on' : st === 'exclude' ? 'excl' : '';
            const note = k.comc === null ? ' ⓔ' : k.ebay === null ? ' ⓒ' : '';
            return `<button class="sb-kw-btn ${cls}" onclick="sbToggleKw('${k.id}')">${k.label}${note}</button>`;
          }).join('')}
        </div>
        <div class="sb-row">
          <input class="sb-input" id="sb-kw-custom" placeholder="Custom keyword…" autocorrect="off" autocapitalize="off">
          <button class="sb-preset-btn" onclick="sbAddCustomKw(SB.kwMode)">Add</button>
        </div>
        ${SB.kwCustomInclude.length || SB.kwCustomExclude.length ? `
          <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">
            ${SB.kwCustomInclude.map((k,i) => `<span class="sb-chip">${k}<button class="sb-chip-x" onclick="sbRemoveCustomKw('include',${i})">×</button></span>`).join('')}
            ${SB.kwCustomExclude.map((k,i) => `<span class="sb-chip" style="background:#FCEBEB;color:var(--dn)">-${k}<button class="sb-chip-x" style="color:var(--dn)" onclick="sbRemoveCustomKw('exclude',${i})">×</button></span>`).join('')}
          </div>
        ` : ''}
      </div>

      <!-- Set -->
      <div class="sb-section">
        <div class="sb-section-title">Set</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <div class="sb-and-or">
            <button class="${SB.kwMode==='include'?'on':''}" onclick="SB.kwMode='include';sbRender()">Include</button>
            <button class="${SB.kwMode==='exclude'?'on':''}" onclick="SB.kwMode='exclude';sbRender()">Exclude</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span class="sb-label">Logic:</span>
          <div class="sb-and-or">
            <button class="${SB.setLogic==='OR'?'on':''}" onclick="SB.setLogic='OR';sbRender()">OR</button>
            <button class="${SB.setLogic==='AND'?'on':''}" onclick="SB.setLogic='AND';sbRender()">AND</button>
          </div>
        </div>
        <div class="sb-kw-grid">
          ${['Topps','Bowman','Chrome','Sapphire','Prizm','Optic','Mosaic','Select','Finest','Heritage','Stadium Club','Phoenix'].map(s => {
            const st = SB.setSelected[s];
            const cls = st === 'include' ? 'on' : st === 'exclude' ? 'excl' : '';
            return `<button class="sb-kw-btn ${cls}" onclick="sbToggleSet('${s}')">${s}</button>`;
          }).join('')}
        </div>
        <div class="sb-row" style="margin-top:8px">
          <input class="sb-input" id="sb-set-custom" placeholder="Custom set…" autocorrect="off" autocapitalize="words">
          <button class="sb-preset-btn" onclick="sbAddCustomSet()">Add</button>
        </div>
        ${SB.setCustomInclude.length || SB.setCustomExclude.length ? `
          <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">
            ${SB.setCustomInclude.map((s,i) => `<span class="sb-chip">${s}<button class="sb-chip-x" onclick="sbRemoveCustomSet('include',${i})">×</button></span>`).join('')}
            ${SB.setCustomExclude.map((s,i) => `<span class="sb-chip" style="background:#FCEBEB;color:var(--dn)">-${s}<button class="sb-chip-x" style="color:var(--dn)" onclick="sbRemoveCustomSet('exclude',${i})">×</button></span>`).join('')}
          </div>
        ` : ''}
      </div>

      <!-- Sport & Team -->
      <div class="sb-section">
        <button class="sb-collapse-btn" onclick="SB.teamOpen=!SB.teamOpen;sbRender()">
          <span>Sport & Team</span><span>${SB.teamOpen?'▲':'▼'}</span>
        </button>
        <div style="${SB.teamOpen?'margin-top:10px':'display:none'}">
        <div class="sb-and-or" style="margin-bottom:10px">
          <button class="${SB.tagMode==='include'?'on':''}" onclick="SB.tagMode='include';sbRender()">Include</button>
          <button class="${SB.tagMode==='exclude'?'on':''}" onclick="SB.tagMode='exclude';sbRender()">Exclude</button>
        </div>
        ${sbRenderTagSection('sport', 'Sport', SB.sports, SB_SPORT_OPTIONS)}
        ${sbRenderTagSection('team', 'Team', SB.teams, SB_TEAM_OPTIONS)}
        </div>
      </div>

      <!-- Year / Decade -->
      <div class="sb-section">
        <button class="sb-collapse-btn" onclick="SB.yearOpen=!SB.yearOpen;sbRender()">
          <span>Year / Decade</span><span>${SB.yearOpen?'▲':'▼'}</span>
        </button>
        <div style="${SB.yearOpen?'margin-top:10px':'display:none'}">
        <div class="sb-and-or" style="margin-bottom:10px">
          <button class="${decMode==='include'?'on':''}" onclick="SB.decadeMode='include';sbRender()">Include</button>
          <button class="${decMode==='exclude'?'on':''}" onclick="SB.decadeMode='exclude';sbRender()">Exclude</button>
        </div>
        <div class="sb-year-chips">
          ${SB_DECADES.map(d => {
            const active = decMode === 'include' ? SB.decadesInclude.has(d.val) : SB.decadesExclude.has(d.val);
            return `<button class="sb-year-chip ${active?'on':''}" onclick="sbToggleDecade('${d.val}')">${d.label}</button>`;
          }).join('')}
        </div>
        <div class="sb-row" style="margin-top:8px">
          <input class="sb-input" id="sb-yr-inp" placeholder="Years e.g. 2021,2022" style="flex:1" autocorrect="off">
          <button class="sb-preset-btn" onclick="sbAddYears()">Add</button>
        </div>
        <div class="sb-year-chips" style="margin-top:4px">
          ${[...SB.yearsInclude].map(y=>`<span class="sb-chip" style="font-size:11px">${y}<button class="sb-chip-x" onclick="SB.yearsInclude.delete('${y}');sbRender()">×</button></span>`).join('')}
          ${[...SB.yearsExclude].map(y=>`<span class="sb-chip" style="font-size:11px;background:#FCEBEB;color:var(--dn)">-${y}<button class="sb-chip-x" style="color:var(--dn)" onclick="SB.yearsExclude.delete('${y}');sbRender()">×</button></span>`).join('')}
        </div>
        <div class="sb-row" style="margin-top:6px">
          <span class="sb-label">Range</span>
          <input class="sb-input" id="sb-yr-from" placeholder="From" style="width:70px;flex:none" value="${SB.yearRangeInclude.from}" autocorrect="off">
          <span class="sb-label">–</span>
          <input class="sb-input" id="sb-yr-to" placeholder="To" style="width:70px;flex:none" value="${SB.yearRangeInclude.to}" autocorrect="off">
          <button class="sb-preset-btn" onclick="sbSetRange()">Set</button>
          ${SB.yearRangeInclude.from ? `<button class="sb-preset-btn" style="color:var(--tx3)" onclick="SB.yearRangeInclude={from:'',to:''};sbRender()">Clear</button>` : ''}
        </div>
        </div>
      </div>

      <!-- Platform Filters -->
      <div class="sb-section">
        <button class="sb-collapse-btn" onclick="SB.platformOpen=!SB.platformOpen;sbRender()">
          <span>Platform Filters</span><span>${SB.platformOpen?'▲':'▼'}</span>
        </button>
        <div style="${SB.platformOpen?'margin-top:10px':'display:none'}">
        <div class="sb-and-or" style="margin-bottom:12px">
          <button class="${SB.ebayOpen?'on':''}" onclick="SB.ebayOpen=!SB.ebayOpen;sbRender()">eBay Filters</button>
          <button class="${SB.comcOpen?'on':''}" onclick="SB.comcOpen=!SB.comcOpen;sbRender()">COMC Filters</button>
        </div>
        <div style="${SB.ebayOpen?'':'display:none'}">
        ${SB.ebayOpen ? `
          <div style="margin-top:10px">
            <div class="sb-row">
              <span class="sb-label">Listing</span>
              <select class="sb-select" onchange="SB.ebayListingType=this.value;sbUpdateOutput()">
                <option value="all" ${SB.ebayListingType==='all'?'selected':''}>All</option>
                <option value="auction" ${SB.ebayListingType==='auction'?'selected':''}>Auction</option>
                <option value="bin" ${SB.ebayListingType==='bin'?'selected':''}>Buy It Now</option>
              </select>
              <span class="sb-label">Sort</span>
              <select class="sb-select" onchange="SB.ebaySort=this.value;sbUpdateOutput()">
                <option value="newest" ${SB.ebaySort==='newest'?'selected':''}>Newest</option>
                <option value="ending" ${SB.ebaySort==='ending'?'selected':''}>Ending</option>
              </select>
            </div>
            <div class="sb-toggle-row">
              <span class="sb-toggle-label">US Only</span>
              <label class="sb-toggle"><input type="checkbox" ${SB.ebayUSOnly?'checked':''} onchange="SB.ebayUSOnly=this.checked;sbUpdateOutput()"><span class="sb-toggle-slider"></span></label>
            </div>
            <div class="sb-row" style="margin-top:8px">
              <span class="sb-label">Price</span>
              <input class="sb-input" placeholder="Min $" style="width:70px;flex:none" type="number" value="${SB.ebayPriceMin}" onchange="SB.ebayPriceMin=this.value;sbUpdateOutput()">
              <span class="sb-label">–</span>
              <input class="sb-input" placeholder="Max $" style="width:70px;flex:none" type="number" value="${SB.ebayPriceMax}" onchange="SB.ebayPriceMax=this.value;sbUpdateOutput()">
            </div>
            <div class="sb-section-title" style="margin-top:10px">Sellers</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
              ${SB.ebaySellers.map((s,i)=>`
                <span class="sb-seller-chip" style="${s.exclude?'background:#FCEBEB;color:var(--dn)':''}">
                  ${s.exclude?'excl: ':''}${s.name}
                  <button class="sb-seller-x" onclick="sbRemoveSeller(${i})">×</button>
                </span>
              `).join('')}
            </div>
            <div class="sb-row">
              <select class="sb-select" id="sb-seller-fav">
                <option value="">Favorites…</option>
                ${SB.ebayFavSellers.map(s=>`<option value="${s}">${s}</option>`).join('')}
              </select>
              <select class="sb-select" id="sb-seller-mode" style="width:90px;flex:none">
                <option value="include">Include</option>
                <option value="exclude">Exclude</option>
              </select>
              <button class="sb-preset-btn" onclick="sbAddSellerFromFav()">Add</button>
            </div>
            <div class="sb-row" style="margin-top:4px">
              <input class="sb-input" id="sb-seller-custom" placeholder="Custom seller…" autocorrect="off" autocapitalize="off">
              <select class="sb-select" id="sb-seller-cmode" style="width:90px;flex:none">
                <option value="include">Include</option>
                <option value="exclude">Exclude</option>
              </select>
              <button class="sb-preset-btn" onclick="sbAddSellerCustom()">Add</button>
            </div>
            <div class="sb-row" style="margin-top:4px">
              <button class="sb-preset-btn" style="font-size:11px;color:var(--tx3)" onclick="sbSaveFavSeller()">⭐ Save as favorite</button>
            </div>
          </div>
        ` : ''}
      </div>

      <div style="${SB.comcOpen?'margin-top:12px':'display:none'}">
            <div class="sb-row">
              <span class="sb-label">Listing</span>
              <select class="sb-select" onchange="SB.comcListingType=this.value;sbUpdateOutput()">
                <option value="all" ${SB.comcListingType==='all'?'selected':''}>All</option>
                <option value="auction" ${SB.comcListingType==='auction'?'selected':''}>Auction</option>
                <option value="bin" ${SB.comcListingType==='bin'?'selected':''}>Buy It Now</option>
                <option value="soldout" ${SB.comcListingType==='soldout'?'selected':''}>All + Sold Out</option>
                <option value="auctionsoldout" ${SB.comcListingType==='auctionsoldout'?'selected':''}>Auction + Sold Out</option>
              </select>
            </div>
            <div class="sb-toggle-row" style="margin-top:8px">
              <span class="sb-toggle-label">Exclude COMC Quality (-COMC)</span>
              <label class="sb-toggle"><input type="checkbox" ${SB.comcExcludeQuality?'checked':''} onchange="SB.comcExcludeQuality=this.checked;sbUpdateOutput()"><span class="sb-toggle-slider"></span></label>
            </div>
          </div>
       </div>
       </div>
      </div>

      <!-- Output -->
      <div class="sb-output">
        <div class="sb-and-or" style="margin-bottom:10px">
          <button class="${SB.outputPlatform==='ebay'?'on':''}" onclick="SB.outputPlatform='ebay';sbRender()">eBay</button>
          <button class="${SB.outputPlatform==='comc'?'on':''}" onclick="SB.outputPlatform='comc';sbRender()">COMC</button>
        </div>
        <div class="sb-output-string" id="sb-out-str">—</div>
        <div class="sb-output-btns">
          <button class="sb-out-btn sb-copy" onclick="sbCopy(SB.outputPlatform)">Copy String</button>
          <button class="sb-out-btn ${SB.outputPlatform==='ebay'?'sb-open-ebay':'sb-open-comc'}" onclick="sbOpen(SB.outputPlatform)">Open in ${SB.outputPlatform==='ebay'?'eBay':'COMC'}</button>
        </div>
      </div>
      <button class="sb-preset-btn" style="width:100%;margin-bottom:20px;background:var(--acc-bg);color:var(--acc);border-color:var(--acc)" onclick="sbSaveSearch()">💾 Save This Search</button>

    </div>
  `;

  sbUpdateOutput();
}

// =============================================================================
// SECTION 8: TAG SECTION HELPER (~603-640)
// =============================================================================

function sbRenderTagSection(id, label, arr, options) {
  return `
    <div style="margin-bottom:12px">
      <div class="sb-section-title" style="margin-bottom:6px">${label}</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px">
        ${arr.map((v,i) => `
          <span class="sb-seller-chip" style="${v.mode==='exclude'?'background:#FCEBEB;color:var(--dn)':'background:var(--acc-bg);color:var(--acc)'}">
            ${v.mode==='exclude'?'-':''}${v.name}
            <button class="sb-seller-x" style="${v.mode==='exclude'?'color:var(--dn)':'color:var(--acc)'}" onclick="sbRemoveTag('${id}',${i})">×</button>
          </span>
        `).join('')}
      </div>
      <div class="sb-row">
        <select class="sb-select" id="sb-sel-${id}">
          <option value="">Select…</option>
          ${options.map(o=>`<option value="${o}">${o}</option>`).join('')}
        </select>
        <button class="sb-preset-btn" onclick="sbAddTag('${id}')">Add</button>
      </div>
      <div class="sb-row" style="margin-top:4px">
        <input class="sb-input" id="sb-inp-${id}" placeholder="Or type manually…" autocorrect="off" autocapitalize="words">
        <button class="sb-preset-btn" onclick="sbAddTag('${id}','manual')">Add</button>
      </div>
    </div>
  `;
}

// =============================================================================
// SECTION 9: PLAYER POOL HANDLERS (~643-690)
// =============================================================================

let _sbAllPlayers = null;
let _sbDDTimeout = null;

function sbOnSearch(val) {
  clearTimeout(_sbDDTimeout);
  const dd = document.getElementById('sb-dd');
  if (!dd) return;
  if (!val || val.length < 2) { dd.style.display = 'none'; return; }
  if (!_sbAllPlayers) _sbAllPlayers = sbGetAllPlayerNames();
  const q = val.toLowerCase();
  const matches = _sbAllPlayers.filter(p => p.name.toLowerCase().includes(q)).slice(0, 20);
  if (!matches.length) { dd.style.display = 'none'; return; }
  dd.innerHTML = matches.map(p =>
    `<div class="sb-dd-item" onmousedown="sbAddPlayer('${p.name.replace(/'/g,"\\'")}','${p.source}')">
      ${p.name} <span class="sb-dd-badge">${p.source}</span>
    </div>`
  ).join('');
  dd.style.display = 'block';
}

function sbHideDD() {
  _sbDDTimeout = setTimeout(() => {
    const dd = document.getElementById('sb-dd');
    if (dd) dd.style.display = 'none';
  }, 200);
}

function sbAddFromInput() {
  const inp = document.getElementById('sb-search');
  if (!inp || !inp.value.trim()) return;
  if (!_sbAllPlayers) _sbAllPlayers = sbGetAllPlayerNames();
  const names = inp.value.split(',').map(n => n.trim()).filter(Boolean);
  names.forEach(name => {
    const match = _sbAllPlayers.find(p => p.name.toLowerCase() === name.toLowerCase());
    sbAddPlayer(match ? match.name : name, match ? match.source : 'manual');
  });
  inp.value = '';
  const dd = document.getElementById('sb-dd');
  if (dd) dd.style.display = 'none';
}

function sbAddPlayer(name, source) {
  name = name.trim();
  if (!name) return;
  if (SB.players.find(p => p.name.toLowerCase() === name.toLowerCase())) return;
  SB.players.push({ name, source });
  sbUpdatePool();
  sbUpdateOutput();
}

function sbRemovePlayer(i) {
  SB.players.splice(i, 1);
  sbUpdatePool();
  sbUpdateOutput();
}

function sbUpdatePool() {
  const el = document.getElementById('sb-pool');
  if (!el) return;
  if (!SB.players.length) { el.innerHTML = '<span class="sb-empty">No players added yet</span>'; return; }
  el.innerHTML = SB.players.map((p,i) =>
    `<span class="sb-chip">${p.name}<button class="sb-chip-x" onclick="sbRemovePlayer(${i})">×</button></span>`
  ).join('');
}

function sbApplyPreset(minScore) {
  SB.players = sbGetBuyScorePlayers(minScore);
  sbUpdatePool();
  sbUpdateOutput();
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
