// =============================================================================
// SECTION 1: STATE (lines ~1-60)
// =============================================================================

const SB = {
  players: [],        // { name, source } — current player pool
  presets: [
    { label: 'Buy Score ≥ 5.0', minScore: 5.0 },
    { label: 'Buy Score ≥ 4.5', minScore: 4.5 },
    { label: 'Buy Score ≥ 4.0', minScore: 4.0 },
  ],

  // Keywords — shared
  kwInclude: new Set(),   // e.g. 'auto', 'serial', 'rc'
  kwExclude: new Set(),

  kwLogic: 'OR',          // 'AND' | 'OR' for include keywords

  // Decade/year
  decadesInclude: new Set(),   // e.g. '198', '199', '200', '201', '202'
  decadesExclude: new Set(),
  yearsInclude: new Set(),     // e.g. '2021', '2022'
  yearsExclude: new Set(),
  yearRangeInclude: { from: '', to: '' },
  yearRangeExclude: { from: '', to: '' },

  // Team / Sport (COMC keyword, eBay filter)
  teamsInclude: [],
  teamsExclude: [],
  sportsInclude: [],
  sportsExclude: [],

  // eBay-only filters
  ebayListingType: 'all',     // 'all' | 'auction' | 'bin'
  ebaySoldOnly: false,
  ebayUSOnly: false,
  ebaySort: 'newest',         // 'newest' | 'ending'
  ebayPriceMin: '',
  ebayPriceMax: '',
  ebaySellers: [],            // { name, exclude: bool }
  ebayFavSellers: ['dcsports87', 'comc_consignment'],

  // COMC-only filters
  comcListingType: 'all',     // 'all' | 'auction' | 'bin' | 'soldout'
  comcExcludeQuality: false,  // adds -COMC keyword

  // Saved favorites sellers storage key
  FAV_KEY: 'sb_fav_sellers',
};

// =============================================================================
// SECTION 2: KEYWORD DEFINITIONS (lines ~63-110)
// =============================================================================

const SB_KEYWORDS = [
  // Shared keywords (work on both platforms as text)
  { id: 'auto',            label: 'Auto',            both: true },
  { id: 'aftermarketauto', label: 'Aftermarket Auto', comcOnly: true },
  { id: 'hof',             label: 'HOF',             both: true },
  { id: 'mem',             label: 'Mem',             comcOnly: true },
  { id: 'pre',             label: 'Pre-Rookie',      comcOnly: true },
  { id: 'rc',              label: 'RC',              both: true },
  { id: 'rookie-related',  label: 'Rookie Related',  comcOnly: true },
  { id: 'rookie-year',     label: 'Rookie Year',     comcOnly: true },
  { id: 'ungraded',        label: 'Ungraded',        comcOnly: true },
  // eBay URL filters (rendered as toggles, not keyword chips)
  // serial => Features=Serial%2520Numbered (ebay filter)
  // graded => Graded=Yes (ebay filter)
  // autographed => Autographed=Yes (ebay filter)
  // rc => Features=Rookie (ebay filter)
];

// eBay-specific feature toggles (URL params, not keywords)
const SB_EBAY_FEATURES = [
  { id: 'serial',      label: 'Serial Numbered', param: 'Features=Serial%2520Numbered' },
  { id: 'graded',      label: 'Graded',          param: 'Graded=Yes' },
  { id: 'autographed', label: 'Autographed',      param: 'Autographed=Yes' },
  { id: 'rookie',      label: 'Rookie',           param: 'Features=Rookie' },
];

// COMC-specific keyword toggles
const SB_COMC_FEATURES = [
  { id: 'graded',   label: 'Graded' },
  { id: 'serial',   label: 'Serial' },
  { id: 'rc',       label: 'RC' },
  { id: 'ungraded', label: 'Ungraded' },
];

const SB_EBAY_FEATURES_EXCL = new Set();   // ids of excluded ebay features
const SB_EBAY_FEATURES_INCL = new Set();   // ids of included ebay features
const SB_COMC_KW_INCL = new Set();
const SB_COMC_KW_EXCL = new Set();

const SB_SPORT_OPTIONS = ['Baseball','Basketball','Football','Hockey','Soccer','Golf','MMA','Wrestling'];
const SB_TEAM_OPTIONS  = [
  'Arizona Diamondbacks','Atlanta Braves','Baltimore Orioles','Boston Red Sox',
  'Chicago Cubs','Chicago White Sox','Cincinnati Reds','Cleveland Guardians',
  'Colorado Rockies','Detroit Tigers','Houston Astros','Kansas City Royals',
  'Los Angeles Angels','Los Angeles Dodgers','Miami Marlins','Milwaukee Brewers',
  'Minnesota Twins','New York Mets','New York Yankees','Oakland Athletics',
  'Philadelphia Phillies','Pittsburgh Pirates','San Diego Padres','San Francisco Giants',
  'Seattle Mariners','St. Louis Cardinals','Tampa Bay Rays','Texas Rangers',
  'Toronto Blue Jays','Washington Nationals',
  // NFL
  'Buffalo Bills','Dallas Cowboys','Green Bay Packers','Kansas City Chiefs',
  'New England Patriots','San Francisco 49ers',
  // NBA
  'Boston Celtics','Golden State Warriors','Los Angeles Lakers','Miami Heat',
];

const SB_DECADES = [
  { label: '1980s', val: '198' },
  { label: '1990s', val: '199' },
  { label: '2000s', val: '200' },
  { label: '2010s', val: '201' },
  { label: '2020s', val: '202' },
];

// =============================================================================
// SECTION 3: PLAYER DATA HELPERS (lines ~113-165)
// =============================================================================

function sbGetProspectNames() {
  // Pull from window._cache if available (same source as modal buy scores)
  const cache = window._cache || [];
  return cache.map(p => ({ name: p.name || p.Name || '', source: 'prospect' }))
               .filter(p => p.name);
}

function sbGetPortfolioNames() {
  // Pull from window._portfolioPlayers if available
  const port = window._portfolioPlayers || [];
  return port.map(n => ({ name: n, source: 'portfolio' }));
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
  const cache = window._cache || [];
  return cache
    .filter(p => {
      const bs = parseFloat(p.buyScore);
      return !isNaN(bs) && bs >= minScore && p.buyScore !== null && p.buyScore !== undefined;
    })
    .map(p => ({ name: p.name || p.Name || '', source: 'prospect' }))
    .filter(p => p.name);
}

// =============================================================================
// SECTION 4: URL / STRING BUILDERS (lines ~168-280)
// =============================================================================

function sbBuildEbayURL() {
  const players = SB.players.map(p => p.name);
  if (!players.length) return '';

  // Keywords
  const kwParts = [];

  // Player group
  const playerStr = players.length === 1
    ? players[0]
    : '(' + players.join(',') + ')';

  // Shared text keywords (auto, hof, mem — things that go in _nkw as text)
  const sharedKwIncl = [...SB.kwInclude].filter(k => {
    const def = SB_KEYWORDS.find(d => d.id === k);
    return def && (def.both || !def.comcOnly);
  });

  let kwStr = '';
  if (sharedKwIncl.length) {
    if (SB.kwLogic === 'OR') {
      kwStr = sharedKwIncl.length === 1 ? sharedKwIncl[0] : '(' + sharedKwIncl.join(',') + ')';
    } else {
      kwStr = sharedKwIncl.join(' ');
    }
  }

  // Exclusion keywords in _nkw
  const sharedKwExcl = [...SB.kwExclude].filter(k => {
    const def = SB_KEYWORDS.find(d => d.id === k);
    return def && (def.both || !def.comcOnly);
  });
  const exclStr = sharedKwExcl.map(k => '-' + k).join(' ');

  // Teams/sports as keywords in _nkw for eBay? No — eBay uses URL params for team/sport
  // Year/decade as Season param handled separately

  const nkwParts = [playerStr, kwStr, exclStr].filter(Boolean);
  const nkw = nkwParts.join(' ').replace(/ +/g, '+').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/,/g, '+');

  const params = new URLSearchParams();
  params.set('_nkw', nkwParts.join(' '));
  params.set('_from', 'R40');
  params.set('_fss', '1');
  params.set('_dcat', '261328');

  // Listing type
  if (SB.ebayListingType === 'auction') params.set('LH_Auction', '1');
  if (SB.ebayListingType === 'bin') params.set('LH_BIN', '1');

  // US Only
  if (SB.ebayUSOnly) params.set('LH_PrefLoc', '1');

  // Sort
  if (SB.ebaySort === 'newest') params.set('_sop', '10');
  if (SB.ebaySort === 'ending') params.set('_sop', '1');

  // Price
  if (SB.ebayPriceMin) params.set('_udlo', SB.ebayPriceMin);
  if (SB.ebayPriceMax) params.set('_udhi', SB.ebayPriceMax);

  // Seller
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
  SB_EBAY_FEATURES_INCL.forEach(id => {
    const f = SB_EBAY_FEATURES.find(x => x.id === id);
    if (!f) return;
    if (f.param.startsWith('Features=')) featureVals.push(f.param.replace('Features=', ''));
    else {
      const [k, v] = f.param.split('=');
      params.set(k, v);
    }
  });
  if (featureVals.length) params.set('Features', featureVals.join('%7C'));
  if (SB_EBAY_FEATURES_INCL.has('serial') || SB_EBAY_FEATURES_INCL.has('rookie')) params.set('_oaa', '1');

  // Sport
  if (SB.sportsInclude.length) params.set('Sport', SB.sportsInclude.join('%7C'));

  // Team
  if (SB.teamsInclude.length) params.set('Team', SB.teamsInclude.join('%7C').replace(/ /g, '%2520'));

  // Season/Year
  const allYears = [
    ...SB.decadesInclude,  // not used directly for eBay season
    ...SB.yearsInclude,
  ];
  // For eBay, use individual years joined with %7C
  if (SB.yearsInclude.size) {
    params.set('Season', [...SB.yearsInclude].join('%7C'));
    params.set('_oaa', '1');
  }

  return 'https://www.ebay.com/sch/261328/i.html?' + params.toString();
}

function sbBuildEbayString() {
  // Plain text version of the search keywords only
  const players = SB.players.map(p => p.name);
  if (!players.length) return '';
  const playerStr = players.length === 1 ? players[0] : '(' + players.join(', ') + ')';
  const kws = [...SB.kwInclude].map(k => {
    const def = SB_KEYWORDS.find(d => d.id === k);
    return def ? def.label : k;
  });
  const excl = [...SB.kwExclude].map(k => {
    const def = SB_KEYWORDS.find(d => d.id === k);
    return '-' + (def ? def.label : k);
  });
  return [playerStr, ...kws, ...excl].filter(Boolean).join(' ');
}

function sbBuildComcURL() {
  const players = SB.players.map(p => p.name);
  if (!players.length) return '';

  const query = sbBuildComcQuery();
  const encoded = sbEncodeComc(query);

  let url = 'https://www.comc.com/Cards,sr,';
  if (SB.comcListingType === 'all')     url += `i100,=(${encoded})`;
  if (SB.comcListingType === 'bin')     url += `=(${encoded}),fb,i100`;
  if (SB.comcListingType === 'auction') url += `=(${encoded}),fa,i100`;
  if (SB.comcListingType === 'soldout') url += `=(${encoded}),ot,i100`;

  return url;
}

function sbBuildComcQuery() {
  const players = SB.players.map(p => p.name);
  if (!players.length) return '';

  // Player group — multi-word names need quotes
  const playerParts = players.map(n => n.includes(' ') ? `"${n}"` : n);
  const playerStr = playerParts.length === 1
    ? playerParts[0]
    : '(' + playerParts.join(' | ') + ')';

  const parts = [playerStr];

  // Include keywords
  const inclKws = [...SB.kwInclude, ...SB_COMC_KW_INCL];
  if (inclKws.length) {
    if (SB.kwLogic === 'OR' && inclKws.length > 1) {
      parts.push('(' + inclKws.join('|') + ')');
    } else {
      inclKws.forEach(k => parts.push(k));
    }
  }

  // Include teams
  SB.teamsInclude.forEach(t => {
    parts.push(t.includes(' ') ? `"${t}"` : t);
  });

  // Include sports
  SB.sportsInclude.forEach(s => parts.push(s.toLowerCase()));

  // Decade/year include
  const decadeYearParts = [];
  SB.decadesInclude.forEach(d => decadeYearParts.push(d + '*'));
  SB.yearsInclude.forEach(y => decadeYearParts.push(y));
  if (SB.yearRangeInclude.from && SB.yearRangeInclude.to) {
    // Build individual years from range
    const from = parseInt(SB.yearRangeInclude.from);
    const to   = parseInt(SB.yearRangeInclude.to);
    for (let y = from; y <= to; y++) decadeYearParts.push(String(y));
  }
  if (decadeYearParts.length === 1) parts.push(decadeYearParts[0]);
  else if (decadeYearParts.length > 1) parts.push('(' + decadeYearParts.join('|') + ')');

  // Exclusions
  [...SB.kwExclude, ...SB_COMC_KW_EXCL].forEach(k => parts.push('-' + k));
  SB.teamsExclude.forEach(t => parts.push('-' + (t.includes(' ') ? `"${t}"` : t)));
  SB.sportsExclude.forEach(s => parts.push('-' + s.toLowerCase()));

  // Decade/year exclude
  const decYrExcl = [];
  SB.decadesExclude.forEach(d => decYrExcl.push(d + '*'));
  SB.yearsExclude.forEach(y => decYrExcl.push(y));
  decYrExcl.forEach(v => parts.push('-' + v));

  // COMC quality exclusion
  if (SB.comcExcludeQuality) parts.push('-COMC');

  return parts.join(' ');
}

function sbEncodeComc(query) {
  return query
    .replace(/"/g,  '~22')
    .replace(/\|/g, '~7c')
    .replace(/\*/g, '{42}')
    .replace(/ /g,  '+');
}

// =============================================================================
// SECTION 5: RENDER (lines ~283-460)
// =============================================================================

function sbRender() {
  const el = document.getElementById('sb-root');
  if (!el) return;

  el.innerHTML = `
    <div class="sb-wrap">

      <!-- Player Pool -->
      <div class="sb-section">
        <div class="sb-section-title">Player Pool</div>
        <div class="sb-presets">
          ${SB.presets.map(p => `<button class="sb-preset-btn" onclick="sbApplyPreset(${p.minScore})">${p.label}</button>`).join('')}
        </div>
        <div class="sb-typeahead">
          <input id="sb-search" placeholder="Search prospects & portfolio…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" oninput="sbOnSearch(this.value)" onblur="sbHideDD()">
          <div class="sb-dropdown" id="sb-dd" style="display:none"></div>
        </div>
        <div class="sb-row" style="margin-bottom:10px">
          <input class="sb-input" id="sb-manual" placeholder="Add player manually…" style="flex:1" autocorrect="off" autocapitalize="words" spellcheck="false">
          <button class="sb-preset-btn" style="flex-shrink:0" onclick="sbAddManual()">Add</button>
        </div>
        <div class="sb-pool" id="sb-pool">
          <span class="sb-empty">No players added yet</span>
        </div>
      </div>

      <!-- Keywords: Include -->
      <div class="sb-section">
        <div class="sb-section-title">Keywords — Include</div>
        <div class="sb-and-or">
          <button class="${SB.kwLogic==='OR'?'on':''}" onclick="sbSetLogic('OR')">OR</button>
          <button class="${SB.kwLogic==='AND'?'on':''}" onclick="sbSetLogic('AND')">AND</button>
        </div>
        <div class="sb-section-title" style="margin-top:4px;margin-bottom:6px">Shared (eBay + COMC)</div>
        <div class="sb-kw-grid">
          ${SB_KEYWORDS.filter(k=>k.both).map(k=>`
            <button class="sb-kw-btn ${SB.kwInclude.has(k.id)?'on':''}" onclick="sbToggleKw('${k.id}','include')">${k.label}</button>
          `).join('')}
        </div>
        <div class="sb-section-title" style="margin-top:10px;margin-bottom:6px">eBay Filters</div>
        <div class="sb-kw-grid">
          ${SB_EBAY_FEATURES.map(f=>`
            <button class="sb-kw-btn ${SB_EBAY_FEATURES_INCL.has(f.id)?'on':''}" onclick="sbToggleEbayFeature('${f.id}','include')">${f.label}</button>
          `).join('')}
        </div>
        <div class="sb-section-title" style="margin-top:10px;margin-bottom:6px">COMC Only</div>
        <div class="sb-kw-grid">
          ${SB_KEYWORDS.filter(k=>k.comcOnly).map(k=>`
            <button class="sb-kw-btn ${SB.kwInclude.has(k.id)?'on':''}" onclick="sbToggleKw('${k.id}','include')">${k.label}</button>
          `).join('')}
        </div>
      </div>

      <!-- Keywords: Exclude -->
      <div class="sb-section">
        <div class="sb-section-title">Keywords — Exclude</div>
        <div class="sb-section-title" style="margin-top:4px;margin-bottom:6px">Shared (eBay + COMC)</div>
        <div class="sb-kw-grid">
          ${SB_KEYWORDS.filter(k=>k.both).map(k=>`
            <button class="sb-kw-btn ${SB.kwExclude.has(k.id)?'excl':''}" onclick="sbToggleKw('${k.id}','exclude')">${k.label}</button>
          `).join('')}
        </div>
        <div class="sb-section-title" style="margin-top:10px;margin-bottom:6px">eBay Filters</div>
        <div class="sb-kw-grid">
          ${SB_EBAY_FEATURES.map(f=>`
            <button class="sb-kw-btn ${SB_EBAY_FEATURES_EXCL.has(f.id)?'excl':''}" onclick="sbToggleEbayFeature('${f.id}','exclude')">${f.label}</button>
          `).join('')}
        </div>
        <div class="sb-section-title" style="margin-top:10px;margin-bottom:6px">COMC Only</div>
        <div class="sb-kw-grid">
          ${SB_KEYWORDS.filter(k=>k.comcOnly).map(k=>`
            <button class="sb-kw-btn ${SB.kwExclude.has(k.id)?'excl':''}" onclick="sbToggleKw('${k.id}','exclude')">${k.label}</button>
          `).join('')}
        </div>
      </div>

      <!-- Sport & Team -->
      <div class="sb-section">
        <div class="sb-section-title">Sport & Team</div>
        ${sbRenderTagInput('sport','Sport Include',SB.sportsInclude,SB_SPORT_OPTIONS,'sbAddSport','sbRemoveSport')}
        ${sbRenderTagInput('sport-excl','Sport Exclude',SB.sportsExclude,SB_SPORT_OPTIONS,'sbAddSportExcl','sbRemoveSportExcl')}
        ${sbRenderTagInput('team','Team Include',SB.teamsInclude,SB_TEAM_OPTIONS,'sbAddTeam','sbRemoveTeam')}
        ${sbRenderTagInput('team-excl','Team Exclude',SB.teamsExclude,SB_TEAM_OPTIONS,'sbAddTeamExcl','sbRemoveTeamExcl')}
      </div>

      <!-- Year / Decade -->
      <div class="sb-section">
        <div class="sb-section-title">Year / Decade — Include</div>
        <div class="sb-year-chips">
          ${SB_DECADES.map(d=>`<button class="sb-year-chip ${SB.decadesInclude.has(d.val)?'on':''}" onclick="sbToggleDecade('${d.val}','include')">${d.label}</button>`).join('')}
        </div>
        <div class="sb-row" style="margin-top:8px">
          <span class="sb-label">Years</span>
          <input class="sb-input" id="sb-yr-incl" placeholder="e.g. 2021,2022" style="flex:1" autocorrect="off">
          <button class="sb-preset-btn" onclick="sbAddYears('include')">Add</button>
        </div>
        <div class="sb-year-chips" id="sb-yr-incl-chips">
          ${[...SB.yearsInclude].map(y=>`<button class="sb-year-chip on" onclick="sbRemoveYear('${y}','include')">${y} ×</button>`).join('')}
        </div>
        <div class="sb-row" style="margin-top:8px">
          <span class="sb-label">Range</span>
          <input class="sb-input" id="sb-yr-from" placeholder="From" style="width:70px;flex:none" autocorrect="off">
          <span class="sb-label">–</span>
          <input class="sb-input" id="sb-yr-to" placeholder="To" style="width:70px;flex:none" autocorrect="off">
          <button class="sb-preset-btn" onclick="sbSetRange('include')">Set</button>
        </div>
        ${SB.yearRangeInclude.from ? `<div style="font-size:12px;color:var(--acc);margin-top:4px">${SB.yearRangeInclude.from}–${SB.yearRangeInclude.to} <button onclick="sbClearRange('include')" style="background:none;border:none;color:var(--tx3);cursor:pointer;font-size:12px">×</button></div>` : ''}

        <div class="sb-section-title" style="margin-top:12px">Year / Decade — Exclude</div>
        <div class="sb-year-chips">
          ${SB_DECADES.map(d=>`<button class="sb-year-chip ${SB.decadesExclude.has(d.val)?'on':''}" onclick="sbToggleDecade('${d.val}','exclude')">${d.label}</button>`).join('')}
        </div>
        <div class="sb-row" style="margin-top:8px">
          <span class="sb-label">Years</span>
          <input class="sb-input" id="sb-yr-excl" placeholder="e.g. 2019,2020" style="flex:1" autocorrect="off">
          <button class="sb-preset-btn" onclick="sbAddYears('exclude')">Add</button>
        </div>
        <div class="sb-year-chips" id="sb-yr-excl-chips">
          ${[...SB.yearsExclude].map(y=>`<button class="sb-year-chip on" onclick="sbRemoveYear('${y}','exclude')">${y} ×</button>`).join('')}
        </div>
      </div>

      <!-- eBay Filters -->
      <div class="sb-section">
        <div class="sb-section-title">eBay Filters</div>
        <div class="sb-row">
          <span class="sb-label">Listing Type</span>
          <select class="sb-select" onchange="SB.ebayListingType=this.value;sbUpdateOutput()">
            <option value="all" ${SB.ebayListingType==='all'?'selected':''}>All Listings</option>
            <option value="auction" ${SB.ebayListingType==='auction'?'selected':''}>Auction</option>
            <option value="bin" ${SB.ebayListingType==='bin'?'selected':''}>Buy It Now</option>
          </select>
        </div>
        <div class="sb-row">
          <span class="sb-label">Sort</span>
          <select class="sb-select" onchange="SB.ebaySort=this.value;sbUpdateOutput()">
            <option value="newest" ${SB.ebaySort==='newest'?'selected':''}>Newly Listed</option>
            <option value="ending" ${SB.ebaySort==='ending'?'selected':''}>Ending Soonest</option>
          </select>
        </div>
        <div class="sb-toggle-row">
          <span class="sb-toggle-label">US Only</span>
          <label class="sb-toggle"><input type="checkbox" ${SB.ebayUSOnly?'checked':''} onchange="SB.ebayUSOnly=this.checked;sbUpdateOutput()"><span class="sb-toggle-slider"></span></label>
        </div>
        <div class="sb-row" style="margin-top:8px">
          <span class="sb-label">Price</span>
          <input class="sb-input" id="sb-price-min" placeholder="Min $" style="width:70px;flex:none" type="number" value="${SB.ebayPriceMin}" onchange="SB.ebayPriceMin=this.value;sbUpdateOutput()">
          <span class="sb-label">–</span>
          <input class="sb-input" id="sb-price-max" placeholder="Max $" style="width:70px;flex:none" type="number" value="${SB.ebayPriceMax}" onchange="SB.ebayPriceMax=this.value;sbUpdateOutput()">
        </div>
        <div class="sb-section-title" style="margin-top:10px">Sellers</div>
        <div id="sb-seller-chips" class="sb-seller-row" style="flex-wrap:wrap;gap:6px">
          ${SB.ebaySellers.map((s,i)=>`
            <span class="sb-seller-chip" style="${s.exclude?'background:#FCEBEB;color:var(--dn)':''}">
              ${s.exclude?'excl: ':''}${s.name}
              <button class="sb-seller-x" onclick="sbRemoveSeller(${i})">×</button>
            </span>
          `).join('')}
        </div>
        <div class="sb-row" style="margin-top:6px">
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
        <div class="sb-row">
          <input class="sb-input" id="sb-seller-custom" placeholder="Custom seller…" autocorrect="off" autocapitalize="off">
          <select class="sb-select" id="sb-seller-cmode" style="width:90px;flex:none">
            <option value="include">Include</option>
            <option value="exclude">Exclude</option>
          </select>
          <button class="sb-preset-btn" onclick="sbAddSellerCustom()">Add</button>
        </div>
        <div class="sb-row" style="margin-top:2px">
          <button class="sb-preset-btn" style="font-size:11px;color:var(--tx3)" onclick="sbSaveFavSeller()">⭐ Save custom as favorite</button>
        </div>
      </div>

      <!-- COMC Filters -->
      <div class="sb-section">
        <div class="sb-section-title">COMC Filters</div>
        <div class="sb-row">
          <span class="sb-label">Listing Type</span>
          <select class="sb-select" onchange="SB.comcListingType=this.value;sbUpdateOutput()">
            <option value="all" ${SB.comcListingType==='all'?'selected':''}>All Listings</option>
            <option value="auction" ${SB.comcListingType==='auction'?'selected':''}>Auction</option>
            <option value="bin" ${SB.comcListingType==='bin'?'selected':''}>Buy It Now</option>
            <option value="soldout" ${SB.comcListingType==='soldout'?'selected':''}>Include Sold Out</option>
          </select>
        </div>
        <div class="sb-toggle-row" style="margin-top:8px">
          <span class="sb-toggle-label">Exclude COMC Quality Listings (-COMC)</span>
          <label class="sb-toggle"><input type="checkbox" ${SB.comcExcludeQuality?'checked':''} onchange="SB.comcExcludeQuality=this.checked;sbUpdateOutput()"><span class="sb-toggle-slider"></span></label>
        </div>
      </div>

      <!-- Output -->
      <div class="sb-output">
        <div class="sb-output-platform">eBay</div>
        <div class="sb-output-string" id="sb-out-ebay-str">—</div>
        <div class="sb-output-btns">
          <button class="sb-out-btn sb-copy" onclick="sbCopy('ebay')">Copy String</button>
          <button class="sb-out-btn sb-open-ebay" onclick="sbOpen('ebay')">Open in eBay</button>
        </div>
      </div>
      <div class="sb-output">
        <div class="sb-output-platform">COMC</div>
        <div class="sb-output-string" id="sb-out-comc-str">—</div>
        <div class="sb-output-btns">
          <button class="sb-out-btn sb-copy" onclick="sbCopy('comc')">Copy String</button>
          <button class="sb-out-btn sb-open-comc" onclick="sbOpen('comc')">Open in COMC</button>
        </div>
      </div>

    </div>
  `;

  sbUpdatePool();
  sbUpdateOutput();
}

// =============================================================================
// SECTION 6: TAG INPUT HELPER (lines ~463-490)
// =============================================================================

function sbRenderTagInput(id, label, arr, options, addFn, removeFn) {
  return `
    <div style="margin-bottom:10px">
      <div class="sb-section-title" style="margin-bottom:6px">${label}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
        ${arr.map((v,i)=>`<span class="sb-seller-chip">${v}<button class="sb-seller-x" onclick="${removeFn}(${i})">×</button></span>`).join('')}
      </div>
      <div class="sb-row">
        <select class="sb-select" id="sb-sel-${id}">
          <option value="">Select…</option>
          ${options.map(o=>`<option value="${o}">${o}</option>`).join('')}
        </select>
        <button class="sb-preset-btn" onclick="${addFn}()">Add</button>
      </div>
      <div class="sb-row" style="margin-top:4px">
        <input class="sb-input" id="sb-inp-${id}" placeholder="Or type manually…" autocorrect="off" autocapitalize="words">
        <button class="sb-preset-btn" onclick="${addFn}('manual')">Add</button>
      </div>
    </div>
  `;
}

// =============================================================================
// SECTION 7: POOL MANAGEMENT (lines ~493-540)
// =============================================================================

function sbUpdatePool() {
  const el = document.getElementById('sb-pool');
  if (!el) return;
  if (!SB.players.length) {
    el.innerHTML = '<span class="sb-empty">No players added yet</span>';
    return;
  }
  el.innerHTML = SB.players.map((p, i) => `
    <span class="sb-chip">
      ${p.name}
      <button class="sb-chip-x" onclick="sbRemovePlayer(${i})">×</button>
    </span>
  `).join('');
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

function sbApplyPreset(minScore) {
  SB.players = sbGetBuyScorePlayers(minScore);
  sbUpdatePool();
  sbUpdateOutput();
}

function sbAddManual() {
  const el = document.getElementById('sb-manual');
  if (!el) return;
  sbAddPlayer(el.value, 'manual');
  el.value = '';
}

// =============================================================================
// SECTION 8: TYPEAHEAD (lines ~543-590)
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

  dd.innerHTML = matches.map(p => `
    <div class="sb-dd-item" onmousedown="sbAddPlayer('${p.name.replace(/'/g,"\\'")}','${p.source}')">
      ${p.name} <span class="sb-dd-badge">${p.source}</span>
    </div>
  `).join('');
  dd.style.display = 'block';
}

function sbHideDD() {
  _sbDDTimeout = setTimeout(() => {
    const dd = document.getElementById('sb-dd');
    if (dd) dd.style.display = 'none';
    const inp = document.getElementById('sb-search');
    if (inp) inp.value = '';
  }, 200);
}

// =============================================================================
// SECTION 9: KEYWORD TOGGLES (lines ~593-635)
// =============================================================================

function sbToggleKw(id, mode) {
  if (mode === 'include') {
    SB.kwInclude.has(id) ? SB.kwInclude.delete(id) : SB.kwInclude.add(id);
    SB.kwExclude.delete(id); // can't be both
  } else {
    SB.kwExclude.has(id) ? SB.kwExclude.delete(id) : SB.kwExclude.add(id);
    SB.kwInclude.delete(id);
  }
  sbRender();
}

function sbToggleEbayFeature(id, mode) {
  if (mode === 'include') {
    SB_EBAY_FEATURES_INCL.has(id) ? SB_EBAY_FEATURES_INCL.delete(id) : SB_EBAY_FEATURES_INCL.add(id);
    SB_EBAY_FEATURES_EXCL.delete(id);
  } else {
    SB_EBAY_FEATURES_EXCL.has(id) ? SB_EBAY_FEATURES_EXCL.delete(id) : SB_EBAY_FEATURES_EXCL.add(id);
    SB_EBAY_FEATURES_INCL.delete(id);
  }
  sbRender();
}

function sbSetLogic(val) {
  SB.kwLogic = val;
  sbRender();
}

// =============================================================================
// SECTION 10: SPORT / TEAM HANDLERS (lines ~638-690)
// =============================================================================

function sbAddSport(manual) {
  const val = manual === 'manual'
    ? (document.getElementById('sb-inp-sport')||{}).value
    : (document.getElementById('sb-sel-sport')||{}).value;
  if (!val) return;
  if (!SB.sportsInclude.includes(val)) SB.sportsInclude.push(val);
  sbRender();
}
function sbRemoveSport(i) { SB.sportsInclude.splice(i,1); sbRender(); }

function sbAddSportExcl(manual) {
  const val = manual === 'manual'
    ? (document.getElementById('sb-inp-sport-excl')||{}).value
    : (document.getElementById('sb-sel-sport-excl')||{}).value;
  if (!val) return;
  if (!SB.sportsExclude.includes(val)) SB.sportsExclude.push(val);
  sbRender();
}
function sbRemoveSportExcl(i) { SB.sportsExclude.splice(i,1); sbRender(); }

function sbAddTeam(manual) {
  const val = manual === 'manual'
    ? (document.getElementById('sb-inp-team')||{}).value
    : (document.getElementById('sb-sel-team')||{}).value;
  if (!val) return;
  if (!SB.teamsInclude.includes(val)) SB.teamsInclude.push(val);
  sbRender();
}
function sbRemoveTeam(i) { SB.teamsInclude.splice(i,1); sbRender(); }

function sbAddTeamExcl(manual) {
  const val = manual === 'manual'
    ? (document.getElementById('sb-inp-team-excl')||{}).value
    : (document.getElementById('sb-sel-team-excl')||{}).value;
  if (!val) return;
  if (!SB.teamsExclude.includes(val)) SB.teamsExclude.push(val);
  sbRender();
}
function sbRemoveTeamExcl(i) { SB.teamsExclude.splice(i,1); sbRender(); }

// =============================================================================
// SECTION 11: YEAR / DECADE HANDLERS (lines ~693-735)
// =============================================================================

function sbToggleDecade(val, mode) {
  const set = mode === 'include' ? SB.decadesInclude : SB.decadesExclude;
  set.has(val) ? set.delete(val) : set.add(val);
  sbRender();
}

function sbAddYears(mode) {
  const id = mode === 'include' ? 'sb-yr-incl' : 'sb-yr-excl';
  const el = document.getElementById(id);
  if (!el) return;
  const set = mode === 'include' ? SB.yearsInclude : SB.yearsExclude;
  el.value.split(',').map(y => y.trim()).filter(Boolean).forEach(y => set.add(y));
  el.value = '';
  sbRender();
}

function sbRemoveYear(val, mode) {
  const set = mode === 'include' ? SB.yearsInclude : SB.yearsExclude;
  set.delete(val);
  sbRender();
}

function sbSetRange(mode) {
  const from = (document.getElementById('sb-yr-from')||{}).value;
  const to   = (document.getElementById('sb-yr-to')||{}).value;
  if (!from || !to) return;
  if (mode === 'include') SB.yearRangeInclude = { from, to };
  sbRender();
}

function sbClearRange(mode) {
  if (mode === 'include') SB.yearRangeInclude = { from:'', to:'' };
  sbRender();
}

// =============================================================================
// SECTION 12: SELLER HANDLERS (lines ~738-790)
// =============================================================================

function sbRemoveSeller(i) {
  SB.ebaySellers.splice(i, 1);
  sbRender();
}

function sbAddSellerFromFav() {
  const sel = document.getElementById('sb-seller-fav');
  const mode = document.getElementById('sb-seller-mode');
  if (!sel || !sel.value) return;
  const exclude = mode && mode.value === 'exclude';
  if (!SB.ebaySellers.find(s => s.name === sel.value)) {
    SB.ebaySellers.push({ name: sel.value, exclude });
  }
  sbRender();
}

function sbAddSellerCustom() {
  const inp  = document.getElementById('sb-seller-custom');
  const mode = document.getElementById('sb-seller-cmode');
  if (!inp || !inp.value.trim()) return;
  const exclude = mode && mode.value === 'exclude';
  const name = inp.value.trim();
  if (!SB.ebaySellers.find(s => s.name === name)) {
    SB.ebaySellers.push({ name, exclude });
  }
  inp.value = '';
  sbRender();
}

function sbSaveFavSeller() {
  const inp = document.getElementById('sb-seller-custom');
  if (!inp || !inp.value.trim()) return;
  const name = inp.value.trim().toLowerCase();
  if (!SB.ebayFavSellers.includes(name)) {
    SB.ebayFavSellers.push(name);
    try { localStorage.setItem(SB.FAV_KEY, JSON.stringify(SB.ebayFavSellers)); } catch(e){}
  }
  sbRender();
}

function sbLoadFavSellers() {
  try {
    const saved = localStorage.getItem(SB.FAV_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      parsed.forEach(s => { if (!SB.ebayFavSellers.includes(s)) SB.ebayFavSellers.push(s); });
    }
  } catch(e){}
}

// =============================================================================
// SECTION 13: OUTPUT UPDATE & ACTIONS (lines ~793-830)
// =============================================================================

function sbUpdateOutput() {
  const ebayStr  = document.getElementById('sb-out-ebay-str');
  const comcStr  = document.getElementById('sb-out-comc-str');

  if (ebayStr) ebayStr.textContent = SB.players.length ? sbBuildEbayString() || '—' : '—';
  if (comcStr) comcStr.textContent = SB.players.length ? sbBuildComcQuery() || '—' : '—';
}

function sbCopy(platform) {
  let text = '';
  if (platform === 'ebay') text = sbBuildEbayString();
  if (platform === 'comc') text = sbBuildComcQuery();
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const btn = event.target;
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = orig, 1500);
  }).catch(() => {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

function sbOpen(platform) {
  let url = '';
  if (platform === 'ebay') url = sbBuildEbayURL();
  if (platform === 'comc') url = sbBuildComcURL();
  if (!url) return;
  window.open(url, '_blank');
}

// =============================================================================
// SECTION 14: INIT (lines ~833-860)
// =============================================================================

function sbInit() {
  sbLoadFavSellers();
  // Invalidate player cache on init so it rebuilds fresh
  _sbAllPlayers = null;
}

// Hook into the app's section switcher
// Called from app.js setSection() when switching to searchbuilder
function sbShow() {
  sbInit();
  const root = document.getElementById('sb-root');
  if (!root) return;
  sbRender();
}
