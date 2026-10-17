// ── State ─────────────────────────────────────────────────────────────────────
let players=[], top200=[], top100=[], origTop200=[], origTop100=[], hotsheet=[], cards=[], buyScores=[], parallelMultipliers=[];

// Global cache — built once after load, cleared on refresh
let CACHE = null;

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
function mostRecentStatic(arr) {
  const seen = new Map();
  arr.forEach(r=>{ const ts=parseDate(r.date); if(!seen.has(r.name)||ts>seen.get(r.name)._ts) seen.set(r.name,{...r,_ts:ts}); });
  return [...seen.values()];
}

// ── Build global cache after data load ───────────────────────────────────────
function buildCache() {
  CACHE = new Map();
  // Group every list by player once, so each player's lookup is instant (this used to filter whole lists once per player and took seconds).
  const by = (arr, key) => { const m = new Map(); for (const r of arr) { const k = normName(key(r)); const l = m.get(k); if (l) l.push(r); else m.set(k, [r]); } return m; };
  const none = [];
  const playersBy = by(players, p => p.name), bsBy = by(buyScores, b => b.name), t200By = by(top200, p => p.name), t100By = by(top100, p => p.name);
  const o200By = by(origTop200, p => p.name), o100By = by(origTop100, p => p.name), hsBy = by(hotsheet, h => h.name);
  const cardsBy = by(cards, c => c.player);
  const isPitcherPos = x => (x || '').toLowerCase().includes('pitcher');

  const hitWeeks = hotsheet.filter(h=>!isPitcherPos(h.pos)).map(h=>parseInt(h.week)||0);
  const pitWeeks = hotsheet.filter(h=>isPitcherPos(h.pos)).map(h=>parseInt(h.week)||0);
  const maxHitWk = hitWeeks.length ? Math.max(...hitWeeks) : 0;
  const maxPitWk = pitWeeks.length ? Math.max(...pitWeeks) : 0;
  const maxDate = arr => arr.reduce((m, r) => Math.max(m, parseDate(r.date)), 0);
  const maxTop200 = maxDate(top200), maxTop100 = maxDate(top100);
  const maxBSPit = maxDate(buyScores.filter(b => isPitcherPos(b.pos))), maxBSHit = maxDate(buyScores.filter(b => !isPitcherPos(b.pos)));

  const allNames = new Set([
    ...players.map(p=>p.name),
    ...top200.map(p=>p.name),
    ...top100.map(p=>p.name),
    ...origTop200.map(p=>p.name),
    ...origTop100.map(p=>p.name),
    ...hotsheet.map(p=>p.name),
  ]);

  allNames.forEach(name=>{
    const nm = normName(name);
    const entry = {};

    const srcPri = {bs:0, top:1, hs:2, orig:3, buy:4};
    const candidates = [];
    const buyEntry = (playersBy.get(nm) || none)[0];
    if(buyEntry) candidates.push({src:'buy', ts:parseDate(buyEntry.date), rank:null, price:cl(buyEntry.price)});
    const bsMatches = bsBy.get(nm) || none;
    bsMatches.forEach(b=>candidates.push({src:'bs', ts:parseDate(b.date), rank:null, price:cl(b.price)}));

    const t200 = t200By.get(nm) || none, t100 = t100By.get(nm) || none;
    [...t200, ...t100].forEach(e=>candidates.push({src:'top', ts:parseDate(e.date), rank:cl(e.rank), price:cl(e.price)}));
    [...(o200By.get(nm) || none), ...(o100By.get(nm) || none)].forEach(e=>
      candidates.push({src:'orig', ts:parseDate(e.date), rank:null, price:cl(e.price)}));
    const hsEntries = hsBy.get(nm) || none;
    hsEntries.forEach(h=>candidates.push({src:'hs', ts:parseDate(h.date), rank:null, price:cl(h.auto)}));

    if(candidates.length) {
      candidates.sort((a,b)=>b.ts!==a.ts?b.ts-a.ts:srcPri[a.src]-srcPri[b.src]);
      const best = candidates[0];
      const isPitcher = isPitcherPos(buyEntry?.pos) || bsMatches[0]?.pos?.toLowerCase().includes('pitcher');
      const relevantTop = isPitcher ? t100 : t200;
      const hasTopList = isPitcher ? top100.length : top200.length;
      const maxTopDate = hasTopList ? (isPitcher ? maxTop100 : maxTop200) : 0;
      const maxBSDate = isPitcher ? maxBSPit : maxBSHit;

      let topRank = null;
      if(maxBSDate >= maxTopDate && maxBSDate > 0) {
        const bsEntry = bsMatches.find(b=>parseDate(b.date)===maxBSDate);
        topRank = bsEntry ? cl(bsEntry.rank) : null;
      } else if(maxTopDate > 0) {
        const topEntry = relevantTop.find(r=>parseDate(r.date)===maxTopDate);
        topRank = topEntry ? cl(topEntry.rank) : null;
      }
      entry.rank = topRank;
      entry.price = best.price;
      const bsBest = bsMatches.length
        ? bsMatches.reduce((a,b)=>parseDate(b.date)>=parseDate(a.date)?b:a)
        : null;
      const hsScoreMatches = hsEntries.filter(h=>h.buyScore);
      const hsBest = hsScoreMatches.length
        ? hsScoreMatches.reduce((a,b)=>parseDate(b.date)>=parseDate(a.date)?b:a)
        : null;
      const bsDate = bsBest ? parseDate(bsBest.date) : 0;
      const hsDate = hsBest ? parseDate(hsBest.date) : 0;
      entry.buy = bsDate>=hsDate && bsBest ? cl(bsBest.score)
        : hsBest ? cl(hsBest.buyScore)
        : (buyEntry ? cl(buyEntry.buy) : null);
      entry.expectedValue = bsBest ? cl(bsBest.expectedValue) : null;

      let hsLabel = null;
      if(hsEntries.length) {
        const hs = hsEntries.reduce((a,b)=>parseDate(b.date)>=parseDate(a.date)?b:a);
        if(hs.repeat) hsLabel='Repeat';
        else if(cl(hs.category)) hsLabel=cl(hs.category);
      }
      entry.hsLabel = hsLabel;

      const buyPrice = buyEntry ? cl(buyEntry.price) : null;
      entry.priceChange = null;
      if(buyPrice && best.price && best.src!=='buy') {
        const orig=safeNum(buyPrice), now=safeNum(best.price);
        if(orig>0) entry.priceChange={orig:buyPrice, now:best.price, pct:parseFloat(((now-orig)/orig*100).toFixed(0))};
      }
    } else {
      entry.rank=null; entry.price=null; entry.buy=null; entry.hsLabel=null; entry.priceChange=null; entry.expectedValue=null;
    }

    const playerCards = cardsBy.get(nm) || none;
    const owned = playerCards.filter(c=>!c.salePrice);
    const sold  = playerCards.filter(c=> c.salePrice);
    const totalInvested  = owned.reduce((s,c)=>s+safeNum(c.purchasePrice),0);
    const totalSoldFor   = sold.reduce((s,c)=>s+safeNum(c.salePrice),0);
    const totalNetProfit = sold.reduce((s,c)=>s+safeNum(c.netProfit,true),0);
    const daysArr = sold.filter(c=>c.daysOwned).map(c=>parseFloat(c.daysOwned)).filter(n=>!isNaN(n));
    const avgHold = daysArr.length ? Math.round(daysArr.reduce((a,b)=>a+b,0)/daysArr.length) : null;
    const bestFlip= sold.reduce((best,c)=>{ const p=safeNum(c.netProfit,true); return (!best||p>safeNum(best.netProfit,true))?c:best; },null);
    entry.cards = {owned, sold, totalInvested, totalSoldFor, totalNetProfit, avgHold, bestFlip};

    const isPit = isPitcherPos(playersBy.get(nm)?.[0]?.pos) || isPitcherPos(hsEntries[0]?.pos);
    const maxWk = isPit ? maxPitWk : maxHitWk;
    const playerWeeks = [...new Set(hsEntries.map(h=>parseInt(h.week)).filter(n=>!isNaN(n)))].sort((a,b)=>a-b);
    const onLatest = playerWeeks.includes(maxWk);
    let streak=0;
    if(onLatest){ streak=1; for(let w=maxWk-1;w>=1;w--){ if(playerWeeks.includes(w)) streak++; else break; } }
    entry.hsInfo = {totalAppearances:playerWeeks.length, onLatest, streak, maxWeek:maxWk};

    CACHE.set(nm, entry);
  });
}

// ── Cache accessors ───────────────────────────────────────────────────────────
const getResolved  = name => CACHE?.get(normName(name)) || {rank:null,price:null,buy:null,hsLabel:null,priceChange:null,expectedValue:null};
const getCardStats = name => CACHE?.get(normName(name))?.cards || {owned:[],sold:[],totalInvested:0,totalSoldFor:0,totalNetProfit:0,avgHold:null,bestFlip:null};
const getHsInfo    = name => CACHE?.get(normName(name))?.hsInfo || {totalAppearances:0,onLatest:false,streak:0,maxWeek:0};

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

let prospectDataLoaded = false;
let prospectDataReady = false;   // true once the older Sheet-shaped prospect arrays (used by the player modal, Hot Sheet, Portfolio) have loaded; 'err' if that failed
const phWaitOld = () => new Promise(res => { const t = setInterval(() => { if (prospectDataReady !== false) { clearInterval(t); res(); } }, 150); });
const CARDS_CACHE_KEY = 'ctCardsCache';

function hydrateCardsFromCache() {
  try {
    const raw = localStorage.getItem(CARDS_CACHE_KEY);
    if (!raw) return false;
    cards = JSON.parse(raw).map(cleanCardNames);
    buildCache();
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
  CACHE = null;
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

    buildCache();
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

async function loadProspectData(quiet) {   // quiet: load in the background without touching the list (the Prospects home reads its own data)
  if (prospectDataLoaded) return;
  prospectDataLoaded = true; prospectDataReady = false;
  if (!quiet) {
  document.getElementById('cntlbl').textContent='Loading...';
  document.getElementById('list').innerHTML='<div class="spin"><div class="spin-ring"></div>Loading prospects…</div>';
  }
  document.getElementById('rfab').classList.add('spin');
  try {
    // Prospect data now comes from the database (the Sheet is only kept for Parallel Multiplier).
    const [dbRes, pmRes] = await Promise.all([
      fetch(API_BASE + '/prospect-export', { headers: { 'X-App-Key': APP_KEY } }),
      fetchBatch(["'Parallel Multiplier'!A2:G500"]).catch(() => [[]])
    ]);
    if (!dbRes.ok) throw new Error('Prospect data: HTTP ' + dbRes.status);
    const pmR = (pmRes && pmRes[0]) || [];
    const db = await dbRes.json();
    players = db.players; top200 = db.top200; top100 = db.top100;
    origTop200 = db.origTop200; origTop100 = db.origTop100;
    hotsheet = db.hotsheet; buyScores = db.buyScores;

    parallelMultipliers = pmR.filter(r=>r[0]).map(r=>({
      parallel:cl(r[0])||'', printRun:cl(r[1]), low:cl(r[2]), high:cl(r[3]),
      multiplier:cl(r[4]), totalSales:cl(r[5]), confidence:cl(r[6])
    }));

    buildCache();

    // Inject players from rankings/hotsheet not in Players All
    const knownNames = new Set(players.map(p => normName(p.name)));

    mostRecentStatic([...top200,...top100]).filter(e => !knownNames.has(normName(e.name))).forEach(e => {
      players.push({
        date:e.date, team:e.team||'',
        pos:top100.find(p=>normName(p.name)===normName(e.name))?'Pitcher':'Hitter',
        name:e.name, age:e.age||'', price:e.price||'',
        mlb:'', dd:'', roto:'', sts:'', ba:'', hobby:'', buy:'', lastYr:'', chg:'', notes:''
      });
      knownNames.add(normName(e.name));
    });

    mostRecentStatic(hotsheet).filter(h => !knownNames.has(normName(h.name))).forEach(h => {
      players.push({
        date:h.date, team:h.aff||'',
        pos:(h.pos||'').toLowerCase().includes('pitcher')?'Pitcher':'Hitter',
        name:h.name, age:h.age||'', price:h.auto||'',
        mlb:'', dd:'', roto:'', sts:'', ba:'', hobby:'', buy:'', lastYr:'', chg:'', notes:''
      });
    });

    prospectDataReady = true;
    if (section === 'prospects' && tab !== 'all') { render(); }
  } catch(e) {
    prospectDataReady = 'err';
    if (quiet) { /* the home does not need these arrays; the modal says so if opened */ }
    else if (tab === 'inbox' || tab === 'posts') { if (section === 'prospects') render(); }   // load failed, but these tabs don't need it
    else {
      document.getElementById('list').innerHTML=`<div class="err"><strong>Could not load data</strong><br>${e.message}<br><br>Check your connection and tap refresh.</div>`;
      document.getElementById('cntlbl').textContent='Error';
    }
  }
  document.getElementById('rfab').classList.remove('spin');
}
