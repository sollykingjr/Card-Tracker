// ── State ─────────────────────────────────────────────────────────────────────
let cards=[], parallelMultipliers=[];

// ── Pure helpers ──────────────────────────────────────────────────────────────
const cl      = v => (!v||String(v).trim()===''||v==='-'||v==='—'||v==='\\-') ? null : String(v).trim();
// Removes a stand-alone dash separator (" - ", " – ", " — ") from card names, e.g.
// "Bowman Draft Chrome - Refractor" → "Bowman Draft Chrome Refractor". Hyphens inside
// names or card numbers (Smith-Njigba, BDC-7) have no spaces around them and are kept.
const stripDashSep = v => {
  if (v == null) return v;
  const out = String(v).replace(/(^|\s)[-–—](?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  return out || null;
};
const cleanCardNames = c => {
  if (!c) return c;
  for (const k of ['fullCard', 'set', 'variation', 'version']) if (c[k]) c[k] = stripDashSep(c[k]);
  return c;
};
const fmt     = v => cl(v) ?? '—';
const fmtP    = v => { const c=cl(v); return c?(c.startsWith('$')?c:'$'+c):'—'; };
const normName= v => (v||'').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const parseDate=v => { if(!v) return 0; const d=new Date(v); return isNaN(d)?0:d.getTime(); };
const fmtDateLabel=v=>{ if(!v) return ''; const d=new Date(v); return isNaN(d)?'':  `${d.getMonth()+1}/${d.getDate()}`; };
const fmtShortDate=v=>{ if(!v) return '—'; const d=new Date(v); return isNaN(d)?v:`${d.getMonth()+1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`; };
const safeNum =(v,neg=false)=>parseFloat(String(v||'0').replace(neg?/[^0-9.-]/g:/[^0-9.]/g,''))||0;
const fmtMoney=v=>{ const n=safeNum(v); return n===0&&!v?'—':`$${n.toFixed(2)}`; };

const fmtDiff=v=>{
  if(!cl(v)) return '—';
  const n=parseFloat(v); if(isNaN(n)) return '—';
  return `<span class="${n>0?'up':'dn'}">${n>0?'+':''}${n}</span>`;
};
const fmtPct=v=>{
  if(!cl(v)) return '—';
  const n=parseFloat(String(v).replace('%',''));
  if(isNaN(n)) return String(v);
  return `<span class="${n>0?'up':n<0?'dn':''}">${n>0?'+':''}${n.toFixed(1)}%</span>`;
};
const badge=br=>{
  if(!br) return '';
  const n=parseFloat(br); if(isNaN(n)) return '';
  const cls = n>=5?'b5':n>=4.5?'b45':n>=4?'b4':n>=3.5?'b35':n>=3?'b3':'b2';
  return `<span class="badge ${cls}">BS ${n}</span>`;
};
const invTier=amt=>{
  if(amt<=0) return null;
  if(amt<=25) return 'inv1'; if(amt<=50) return 'inv2';
  if(amt<=100) return 'inv3'; return 'inv4';
};
const getParallelMultiplier=(cardName,playerName)=>{
  let cn=(cardName||'').toLowerCase();
  if(playerName) cn = cn.split(playerName.toLowerCase()).join(' ');
  if(!cn.includes('auto')) return null;
  const colorMatch = parallelMultipliers.find(p=>p.parallel && p.parallel.toLowerCase()!=='refractor' && cn.includes(p.parallel.toLowerCase()));
  const match = colorMatch || parallelMultipliers.find(p=>p.parallel && p.parallel.toLowerCase()==='refractor' && cn.includes('refractor'));
  return match ? (parseFloat(match.multiplier)||1) : 1;
};

// ── mostRecentStatic ──────────────────────────────────────────────────────────
// ── Build global cache after data load ───────────────────────────────────────
// ── Cache accessors ───────────────────────────────────────────────────────────
// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchRange(rng) {
  const r = await fetch(BASE+encodeURIComponent(rng)+'?key='+KEY);
  if(!r.ok) throw new Error(`${rng}: HTTP ${r.status}`);
  return (await r.json()).values||[];
}

async function fetchBatch(ranges) {
  const params = ranges.map(rng => 'ranges='+encodeURIComponent(rng)).join('&');
  const url = BASE.replace(/values\/$/, 'values:batchGet') + '?' + params + '&key=' + KEY;
  const r = await fetch(url);
  if(!r.ok) throw new Error(`batchGet: HTTP ${r.status}`);
  const data = await r.json();
  return (data.valueRanges||[]).map(vr => vr.values||[]);
}

const CARDS_CACHE_KEY = 'ctCardsCache';

function hydrateCardsFromCache() {
  try {
    const raw = localStorage.getItem(CARDS_CACHE_KEY);
    if (!raw) return false;
    cards = JSON.parse(raw).map(cleanCardNames);
    return true;
  } catch(e) {
    return false;
  }
}

function saveCardsToCache() {
  try {
    localStorage.setItem(CARDS_CACHE_KEY, JSON.stringify(cards));
  } catch(e) {
    // localStorage full or unavailable — silently skip caching
  }
}

async function loadCardData() {
  document.getElementById('cntlbl').textContent='Loading...';
  document.getElementById('list').innerHTML='<div class="spin"><div class="spin-ring"></div>'+(CARD_DB_URL?'Loading cards...':'Loading prospects…')+'</div>';
  document.getElementById('rfab').classList.add('spin');
  try {
    // Card data source: the card database (Worker /cards). The sheet path is the rollback fallback
    // if CARD_DB_URL is ever set to null.
    const cR = CARD_DB_URL
      ? await fetch(`${CARD_DB_URL}/cards`, { headers: { 'X-App-Key': APP_KEY } }).then(r=>r.ok?r.json().then(d=>d.values||[]):[])
      : await fetch(`${TRACKER_BASE}${encodeURIComponent("'Card Cost Tracker Final'!A2:W100000")}?key=${KEY}`)
          .then(r=>r.ok?r.json().then(d=>d.values||[]):[]);

    cards = cR.filter(r=>r[7]).map(r=>({
      itemId:cl(r[0]),
      sport:cl(r[1]),
      year:cl(r[2]),
      set:cl(r[3]),
      variation:cl(r[4]),
      version:cl(r[5]),
      cardNo:cl(r[6]),
      player:(cl(r[7])||'').toLowerCase(),
      playerDisplay:cl(r[7])||'',
      serialNo:cl(r[8]),
      qtyManufactured:cl(r[9]),
      purchasePrice:cl(r[10]),salePrice:cl(r[11]),saleFees:cl(r[12]),
      netProfit:cl(r[13]),profitPct:cl(r[14]),
      datePurchased:cl(r[15]),transactionDate:cl(r[16]),
      purchasedFrom:cl(r[17]),purchasedBy:cl(r[18]),
      daysOwned:cl(r[19]),
      grade:cl(r[20]),
      fullCard:cl(r[21])||[cl(r[2]),cl(r[3]),cl(r[4]),cl(r[7])].filter(Boolean).join(' ')
    })).map(cleanCardNames);

    saveCardsToCache();

    if (section === 'home') { renderHome(); }
    else if (section === 'cardtracker') { renderCardTracker(); }
    else if (section === 'portfolio') { renderPortfolio(); }
    else if (section === 'prospects' && tab === 'all' && typeof renderProspectHome === 'function') { renderProspectHome(); }
  } catch(e) {
    document.getElementById('list').innerHTML=`<div class="err"><strong>Could not load data</strong><br>${e.message}<br><br>Make sure the sheet is shared as "Anyone with the link can view".</div>`;
    document.getElementById('cntlbl').textContent='Error';
  }
  document.getElementById('rfab').classList.remove('spin');
}

// ── Card stats per player (straight from the cards list) ──
let _csFor = null, _csMap = null;
function getCardStats(name) {
  if (_csFor !== cards) {
    _csFor = cards; _csMap = new Map();
    for (const c of cards) { const k = normName(c.player); const l = _csMap.get(k); if (l) l.push(c); else _csMap.set(k, [c]); }
  }
  const playerCards = _csMap.get(normName(name)) || [];
  const owned = playerCards.filter(c => !c.salePrice), sold = playerCards.filter(c => c.salePrice);
  const totalInvested = owned.reduce((s, c) => s + safeNum(c.purchasePrice), 0);
  const totalSoldFor = sold.reduce((s, c) => s + safeNum(c.salePrice), 0);
  const totalNetProfit = sold.reduce((s, c) => s + safeNum(c.netProfit, true), 0);
  const daysArr = sold.filter(c => c.daysOwned).map(c => parseFloat(c.daysOwned)).filter(n => !isNaN(n));
  const avgHold = daysArr.length ? Math.round(daysArr.reduce((a, b) => a + b, 0) / daysArr.length) : null;
  const bestFlip = sold.reduce((best, c) => { const p = safeNum(c.netProfit, true); return (!best || p > safeNum(best.netProfit, true)) ? c : best; }, null);
  return { owned, sold, totalInvested, totalSoldFor, totalNetProfit, avgHold, bestFlip };
}

// ── Parallel multipliers (small Sheet tab; used for estimated card values) ──
let parallelsReady = null;
function loadParallelMultipliers() {
  if (parallelsReady) return parallelsReady;
  parallelsReady = fetchBatch(["'Parallel Multiplier'!A2:G500"]).then(r => {
    parallelMultipliers = ((r && r[0]) || []).filter(x => x[0]).map(x => ({
      parallel: cl(x[0]) || '', printRun: cl(x[1]), low: cl(x[2]), high: cl(x[3]),
      multiplier: cl(x[4]), totalSales: cl(x[5]), confidence: cl(x[6])
    }));
  }).catch(() => {});
  return parallelsReady;
}
