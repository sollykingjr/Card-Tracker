// ── State ─────────────────────────────────────────────────────────────────────
let players=[], top200=[], top100=[], origTop200=[], origTop100=[], hotsheet=[], cards=[];

// Global cache — built once after load, cleared on refresh
let CACHE = null;

// ── Pure helpers ──────────────────────────────────────────────────────────────
const cl      = v => (!v||String(v).trim()===''||v==='-'||v==='—'||v==='\\-') ? null : String(v).trim();
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
  const n=parseInt(br); if(isNaN(n)) return '';
  return `<span class="badge ${{5:'b5',4:'b4',3:'b3'}[n]||'b2'}">BR ${n}</span>`;
};
const invTier=amt=>{
  if(amt<=0) return null;
  if(amt<=25) return 'inv1'; if(amt<=50) return 'inv2';
  if(amt<=100) return 'inv3'; return 'inv4';
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

  const hitWeeks = hotsheet.filter(h=>!(h.pos||'').toLowerCase().includes('pitcher')).map(h=>parseInt(h.week)||0);
  const pitWeeks = hotsheet.filter(h=>(h.pos||'').toLowerCase().includes('pitcher')).map(h=>parseInt(h.week)||0);
  const maxHitWk = hitWeeks.length ? Math.max(...hitWeeks) : 0;
  const maxPitWk = pitWeeks.length ? Math.max(...pitWeeks) : 0;

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

    const srcPri = {top:0, hs:1, orig:2, buy:3};
    const candidates = [];
    const buyEntry = players.find(b=>normName(b.name)===nm);
    if(buyEntry) candidates.push({src:'buy', ts:parseDate(buyEntry.date), rank:null, price:cl(buyEntry.price)});

    const topEntries = [...top200,...top100].filter(e=>normName(e.name)===nm);
    topEntries.forEach(e=>candidates.push({src:'top', ts:parseDate(e.date), rank:cl(e.rank), price:cl(e.price)}));
    [...origTop200,...origTop100].filter(e=>normName(e.name)===nm).forEach(e=>
      candidates.push({src:'orig', ts:parseDate(e.date), rank:null, price:cl(e.price)}));
    const hsEntries = hotsheet.filter(h=>normName(h.name)===nm);
    hsEntries.forEach(h=>candidates.push({src:'hs', ts:parseDate(h.date), rank:null, price:cl(h.auto)}));

    if(candidates.length) {
      candidates.sort((a,b)=>b.ts!==a.ts?b.ts-a.ts:srcPri[a.src]-srcPri[b.src]);
      const best = candidates[0];
      const topRank = topEntries.length
        ? topEntries.reduce((a,b)=>parseDate(b.date)>=parseDate(a.date)?b:a).rank : null;
      entry.rank  = cl(topRank);
      entry.price = best.price;
      entry.buy   = buyEntry ? cl(buyEntry.buy) : null;

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
      entry.rank=null; entry.price=null; entry.buy=null; entry.hsLabel=null; entry.priceChange=null;
    }

    const playerCards = cards.filter(c=>normName(c.player)===nm);
    const owned = playerCards.filter(c=>!c.salePrice);
    const sold  = playerCards.filter(c=> c.salePrice);
    const totalInvested  = owned.reduce((s,c)=>s+safeNum(c.purchasePrice),0);
    const totalSoldFor   = sold.reduce((s,c)=>s+safeNum(c.salePrice),0);
    const totalNetProfit = sold.reduce((s,c)=>s+safeNum(c.netProfit,true),0);
    const daysArr = sold.filter(c=>c.daysOwned).map(c=>parseFloat(c.daysOwned)).filter(n=>!isNaN(n));
    const avgHold = daysArr.length ? Math.round(daysArr.reduce((a,b)=>a+b,0)/daysArr.length) : null;
    const bestFlip= sold.reduce((best,c)=>{ const p=safeNum(c.netProfit,true); return (!best||p>safeNum(best.netProfit,true))?c:best; },null);
    entry.cards = {owned, sold, totalInvested, totalSoldFor, totalNetProfit, avgHold, bestFlip};

    const isPit = (players.find(p=>normName(p.name)===nm)?.pos||'').toLowerCase().includes('pitcher') ||
                  (hsEntries[0]?.pos||'').toLowerCase().includes('pitcher');
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
const getResolved  = name => CACHE?.get(normName(name)) || {rank:null,price:null,buy:null,hsLabel:null,priceChange:null};
const getCardStats = name => CACHE?.get(normName(name))?.cards || {owned:[],sold:[],totalInvested:0,totalSoldFor:0,totalNetProfit:0,avgHold:null,bestFlip:null};
const getHsInfo    = name => CACHE?.get(normName(name))?.hsInfo || {totalAppearances:0,onLatest:false,streak:0,maxWeek:0};

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchRange(rng) {
  const r = await fetch(BASE+encodeURIComponent(rng)+'?key='+KEY);
  if(!r.ok) throw new Error(`${rng}: HTTP ${r.status}`);
  return (await r.json()).values||[];
}

async function loadAll() {
  document.getElementById('cntlbl').textContent='Loading...';
  document.getElementById('list').innerHTML='<div class="spin"><div class="spin-ring"></div>Fetching from Google Sheets...</div>';
  document.getElementById('rfab').classList.add('spin');
  CACHE = null;
  try {
    const [pR,h2,p1,oh2,op1,hsR,cR] = await Promise.all([
      fetchRange("'Players All'!A2:P2000"),
      fetchRange("'Top 200 Hitters Updated'!A2:I2000"),
      fetchRange("'Top 100 Pitchers Updated'!A2:I2000"),
      fetchRange("'200 Hitters Original'!A2:G2000"),
      fetchRange("'100 Pitchers Original'!A2:G2000"),
      fetchRange("'Hot Sheet'!A2:AE2000"),
      fetch(`${TRACKER_BASE}${encodeURIComponent("'Card Cost Tracker Final'!A2:W2000")}?key=${KEY}`)
        .then(r=>r.ok?r.json().then(d=>d.values||[]):[]),
    ]);

    players = pR.filter(r=>r[3]).map(r=>({
      date:cl(r[0]),team:cl(r[1])||'',pos:cl(r[2])||'',name:cl(r[3])||'',
      age:cl(r[4]),price:cl(r[5]),mlb:cl(r[6]),dd:cl(r[7]),roto:cl(r[8]),
      sts:cl(r[9]),ba:cl(r[10]),hobby:cl(r[11]),buy:cl(r[12]),
      lastYr:cl(r[13]),chg:cl(r[14]),notes:cl(r[15])
    }));

    top200 = h2.filter(r=>r[2]).map(r=>({
      date:cl(r[0]),rank:cl(r[1]),name:cl(r[2])||'',team:cl(r[3])||'',
      age:cl(r[4]),prev:cl(r[5]),diff:cl(r[6]),price:cl(r[7]),notes:cl(r[8])
    }));
    top100 = p1.filter(r=>r[2]).map(r=>({
      date:cl(r[0]),rank:cl(r[1]),name:cl(r[2])||'',team:cl(r[3])||'',
      age:cl(r[4]),prev:cl(r[5]),diff:cl(r[6]),price:cl(r[7]),notes:cl(r[8])
    }));

    origTop200 = oh2.filter(r=>r[2]).map(r=>({
      date:cl(r[0]),rank:cl(r[1]),name:cl(r[2])||'',team:cl(r[3])||'',price:cl(r[6])
    }));
    origTop100 = op1.filter(r=>r[2]).map(r=>({
      date:cl(r[0]),rank:cl(r[1]),name:cl(r[2])||'',team:cl(r[3])||'',price:cl(r[6])
    }));

    hotsheet = hsR.filter(r=>r[4]).map(r=>({
      date:cl(r[0]),week:cl(r[1]),pos:cl(r[2]),level:cl(r[3]),
      name:cl(r[4])||'',age:cl(r[5]),aff:cl(r[6]),
      ip:cl(r[7]),hp:cl(r[8]),er:cl(r[9]),bbp:cl(r[10]),sop:cl(r[11]),
      era:cl(r[12]),whip:cl(r[13]),k9:cl(r[14]),
      b2:cl(r[15]),b3:cl(r[16]),hr:cl(r[17]),rbi:cl(r[18]),
      bbh:cl(r[19]),soh:cl(r[20]),sb:cl(r[21]),
      ba:cl(r[22]),obp:cl(r[23]),ops:cl(r[24]),
      auto:cl(r[25]),day14:cl(r[26]),hobby:cl(r[27]),
      repeat:cl(r[28])==='Yes',category:cl(r[29]),notes:cl(r[30])
    }));

    cards = cR.filter(r=>r[7]).map(r=>({
      player:(cl(r[7])||'').toLowerCase(),
      fullCard:cl(r[22])||[cl(r[2]),cl(r[3]),cl(r[4]),cl(r[7])].filter(Boolean).join(' '),
      purchasePrice:cl(r[10]),salePrice:cl(r[11]),saleFees:cl(r[12]),
      netProfit:cl(r[13]),datePurchased:cl(r[15]),transactionDate:cl(r[16]),
      serialNo:cl(r[8]),daysOwned:cl(r[20])
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

    render();
  } catch(e) {
    document.getElementById('list').innerHTML=`<div class="err"><strong>Could not load data</strong><br>${e.message}<br><br>Make sure the sheet is shared as "Anyone with the link can view".</div>`;
    document.getElementById('cntlbl').textContent='Error';
  }
  document.getElementById('rfab').classList.remove('spin');
}
