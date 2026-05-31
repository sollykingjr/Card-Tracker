// ── Sort chips ────────────────────────────────────────────────────────────────
function renderSortChips() {
  const opts = SORT_OPTS[tab];
  const el = document.getElementById('sortchips');
  if(!opts){ el.innerHTML=''; return; }
  el.innerHTML = opts.map(o=>
    `<button class="schip${sortBy===o.k||(!opts.find(x=>x.k===sortBy)&&o.k==='default')?' on':''}" data-s="${o.k}">${o.l}</button>`
  ).join('');
}

// ── Sort helpers ──────────────────────────────────────────────────────────────
function applySort(pool, defaultSort) {
  const s = SORT_OPTS[tab]?.find(o=>o.k===sortBy) ? sortBy : 'default';
  if(s==='default') return defaultSort(pool);
  if(s==='name') return pool.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||''));

  const cache = new Map();
  pool.forEach(p=>{
    const d = getResolved(p.name);
    const cs = getCardStats(p.name);
    const hi = getHsInfo(p.name);
    const val =
      s==='rank'   ? (parseInt(d.rank)||9999) :
      s==='price'  ? safeNum(d.price) :
      s==='owned'  ? cs.totalInvested :
      s==='weeks'  ? hi.totalAppearances :
      s==='streak' ? hi.streak : 0;
    cache.set(p.name, val);
  });

  return pool.slice().sort((a,b)=>{
    const va=cache.get(a.name)??0, vb=cache.get(b.name)??0;
    return s==='rank' ? va-vb : vb-va;
  });
}

// ── Pool ──────────────────────────────────────────────────────────────────────
function mostRecent(arr) {
  const seen = new Map();
  arr.forEach(r=>{ const ts=parseDate(r.date); if(!seen.has(r.name)||ts>seen.get(r.name)._ts) seen.set(r.name,{...r,_ts:ts}); });
  return [...seen.values()];
}

function getPool() {
  if(tab==='hs')  return [];
  if(tab==='port') return [];
  if(tab==='watch') return [];

  let pool=[...players];
  if(brf==='5') pool=pool.filter(p=>parseFloat(getResolved(p.name).buy||0)>=5);
  else if(brf==='4') pool=pool.filter(p=>parseFloat(getResolved(p.name).buy||0)>=4);
  else if(brf==='owned') pool=pool.filter(p=>getCardStats(p.name).owned.length>0);
  else if(brf==='sold')  pool=pool.filter(p=>getCardStats(p.name).sold.length>0);
  if(posf==='hit') pool=pool.filter(p=>(p.pos||'').toLowerCase().includes('hitter'));
  else if(posf==='pit') pool=pool.filter(p=>(p.pos||'').toLowerCase().includes('pitcher'));
  pool=pool.filter(p=>matchQ(p.name,p.team));
  if(!q && brf==='all') pool=pool.filter(p=>parseFloat(getResolved(p.name).buy||0)>=4);
  return applySort(pool,p=>p.slice().sort((a,b)=>{
    const ab=parseFloat(getResolved(a.name).buy||0),bb=parseFloat(getResolved(b.name).buy||0);
    if(ab!==bb) return bb-ab;
    return safeNum(getResolved(b.name).price)-safeNum(getResolved(a.name).price);
  }));
}

// ── Card builder ──────────────────────────────────────────────────────────────
function buildCard(name, team, pos, i, tp, overrides={}) {
  const d      = getResolved(name);
  const rank   = overrides.rank  ?? d.rank;
  const price  = overrides.price ?? d.price;
  const cs     = getCardStats(name);
  const hi     = getHsInfo(name);
  const hsLabel= d.hsLabel;
  const isRepeat  = hsLabel&&hsLabel.toLowerCase().includes('repeat');
  const isSleeper = hsLabel&&hsLabel.toLowerCase().includes('sleeper');
  const isPitcher = (pos||'').toLowerCase().includes('pitcher');

  const rankHtml = rank
    ? `<div class="rnum${isPitcher?' pitcher':''}" style="font-size:10px;font-weight:500">#${rank}</div>`
    : `<div class="rnum empty" style="font-size:10px">—</div>`;

  const priceStr = price?(String(price).startsWith('$')?price:'$'+price):'';
  const priceHtml= priceStr?`<div class="pbox">${priceStr}</div>`:`<div class="pbox empty">—</div>`;

  let labelHtml='';
  if(hsLabel){ const cls=isRepeat?'repeat':isSleeper?'sleeper':''; labelHtml=`<span class="hs-label${cls?' '+cls:''}">${hsLabel}</span>`; }

  let wkHtml='';
  if(tab==='hs' && hi.totalAppearances>0){
    if(hi.streak>=2) wkHtml+=`<span class="wk-badge streak">${hi.streak} Straight</span>`;
    else if(hi.onLatest) wkHtml+=`<span class="wk-badge">Most Recent</span>`;
    if(hi.totalAppearances>1) wkHtml+=`<span class="wk-badge">x${hi.totalAppearances}</span>`;
  }

  let invHtml='';
  if(cs.owned.length>0){ const tier=invTier(cs.totalInvested); invHtml+=`<span class="inv-badge ${tier}">${cs.owned.length} owned · $${cs.totalInvested.toFixed(0)}</span>`; }
  if(cs.sold.length>0) invHtml+=`<span class="sold-badge">${cs.sold.length} sold</span>`;

  const borderClass = hi.onLatest?' recent-hs':'';

  return `<div class="card${borderClass}" data-i="${i}" data-tp="${tp}">
    ${rankHtml}
    <div class="cbody">
      <div class="r1"><span class="pname">${name}</span></div>
      <div class="r2">
        <span>${team||''}</span><span>${pos||''}</span>
      ${d.buy?badge(d.buy):''}${cs.owned.length>0?`<span class="inv-badge ${invTier(cs.totalInvested)}">${cs.owned.length} owned · $${cs.totalInvested.toFixed(0)}</span>`:''}
      </div>
    </div>
    ${priceHtml}
  </div>`;
}

// ── Hot Sheet render ──────────────────────────────────────────────────────────
function renderHotSheet() {
  const list = document.getElementById('list');
  const cnt  = document.getElementById('cntlbl');

  const isPitcher = pos => pos && (pos.toLowerCase().includes('pitcher') || pos.toLowerCase() === 'p');

  const hitters  = hotsheet.filter(r => !isPitcher(r.pos));
  const pitchers = hotsheet.filter(r =>  isPitcher(r.pos));

  // Find the most recent date independently for each group
  const latestDate = arr => {
    let max = 0;
    arr.forEach(r => { const ts = parseDate(r.date); if(ts > max) max = ts; });
    return max;
  };
  const hLatest  = latestDate(hitters);
  const pLatest  = latestDate(pitchers);

  const thisWeekH = hitters.filter(r => parseDate(r.date) === hLatest);
  const thisWeekP = pitchers.filter(r => parseDate(r.date) === pLatest);

  const totalCount = thisWeekH.length + thisWeekP.length;
  cnt.textContent = `${totalCount} player${totalCount===1?'':'s'}`;

  if(!totalCount) {
    list.innerHTML = '<div class="empty-msg">No hot sheet data found</div>';
    return;
  }

  const LEVEL_ORDER = ['Triple-A','Double-A','High-A','Single-A','Complex League'];
  const IGNORE_CATS = new Set(['no','none','']);

  const buildSection = (entries, sectionTitle) => {
    if(!entries.length) return '';

    // Group by level in defined order
    const byLevel = new Map();
    LEVEL_ORDER.forEach(l => byLevel.set(l, []));
    entries.forEach(r => {
      const l = r.level || 'Other';
      if(!byLevel.has(l)) byLevel.set(l, []);
      byLevel.get(l).push(r);
    });

    let html = `<div class="hs-section-hdr">${sectionTitle}</div>`;

    byLevel.forEach((players, level) => {
      if(!players.length) return;

      // Sort by buy score desc within each level
      players.sort((a,b) => (parseFloat(b.buyScore)||0) - (parseFloat(a.buyScore)||0));

      html += `<div class="hs-level-hdr">${level}</div>`;
      players.forEach((r, i) => {
        const d       = getResolved(r.name);
        const bs      = parseFloat(r.buyScore || d.buy || 0);
        const price   = r.auto || d.price || '';
        const priceStr= price ? (String(price).startsWith('$') ? price : '$'+price) : '—';
        const catRaw  = (r.category||'').trim();
        const cat     = IGNORE_CATS.has(catRaw.toLowerCase()) ? '' : catRaw;
        const isRepeat= String(r.repeat||'').toLowerCase().includes('yes') || catRaw.toLowerCase().includes('repeat');

        const bsHtml  = bs ? `<span class="hs-row-bs bs-${Math.floor(bs)}">${bs}</span>` : '';
        const catHtml = cat ? `<span class="hs-row-cat${isRepeat?' repeat':''}">${cat}</span>` : '';

        html += `<div class="hs-row" data-name="${r.name}" data-pos="${r.pos||''}" data-aff="${r.aff||''}">
          <div class="hs-row-left">
            <span class="hs-row-name">${r.name}</span>
            ${catHtml}
          </div>
          <div class="hs-row-right">
            ${bsHtml}
            <span class="hs-row-price">${priceStr}</span>
          </div>
        </div>`;
      });
    });

    return html;
  };

  list.innerHTML = buildSection(thisWeekH, 'Hitters') + buildSection(thisWeekP, 'Pitchers');

  // Attach tap handlers
  list.querySelectorAll('.hs-row').forEach(row => {
    row.addEventListener('click', () => {
      const name = row.dataset.name;
      const entry = hotsheet.find(h => h.name === name) || { name, pos: row.dataset.pos, aff: row.dataset.aff };
      showDetail(entry, 'hs');
    });
  });
}

// ── Main render ───────────────────────────────────────────────────────────────
function render() {
  const isHS=tab==='hs', isPort=tab==='port', isWatch=tab==='watch';
  const showChips=!isHS&&!isPort&&!isWatch;
  renderSortChips();
  if(isPort){ renderPortfolio(); return; }
  if(isWatch){ renderWatchlist(); return; }
  if(isHS){ renderHotSheet(); return; }

  const pool=getPool();
  document.getElementById('cntlbl').textContent=`${pool.length} player${pool.length===1?'':'s'}`;
  if(!pool.length){ document.getElementById('list').innerHTML='<div class="empty-msg">No players match</div>'; return; }

  let html=pool.map((p,i)=>buildCard(p.name,p.team,p.pos,i,'player')).join('');

  document.getElementById('list').innerHTML=html;
  document.querySelectorAll('#list .card').forEach(c=>{
    c.addEventListener('click',()=>showDetail(pool[+c.dataset.i],c.dataset.tp));
  });
}

// ── History charts ────────────────────────────────────────────────────────────
function buildHistoryCharts(name) {
  const nm=normName(name);
  const pricePoints=[], rankPoints=[];
  const add=(dateVal,rawVal,list)=>{
    const ts=parseDate(dateVal); if(!ts||!rawVal) return;
    const n=parseFloat(String(rawVal).replace(/[^0-9.]/g,'')); if(isNaN(n)) return;
    list.push({ts,val:n,fullDate:dateVal});
  };
  const buyE=players.find(b=>normName(b.name)===nm);
  if(buyE){ add(buyE.date,buyE.price,pricePoints); add(buyE.date,buyE.hobby,rankPoints); }
  [...origTop200,...origTop100].filter(e=>normName(e.name)===nm).forEach(e=>{ add(e.date,e.price,pricePoints); add(e.date,e.rank,rankPoints); });
  [...top200,...top100].filter(e=>normName(e.name)===nm).forEach(e=>{ add(e.date,e.price,pricePoints); add(e.date,e.rank,rankPoints); });
  hotsheet.filter(h=>normName(h.name)===nm).forEach(h=>{ add(h.date,h.auto,pricePoints); add(h.date,h.hobby,rankPoints); });
  buyScores.filter(b=>normName(b.name)===nm).forEach(b=>{ add(b.date,b.price,pricePoints); add(b.date,b.rank,rankPoints); });

  const dedup=pts=>{ pts.sort((a,b)=>a.ts-b.ts); const m=new Map(); pts.forEach(p=>{ if(!m.has(p.ts)) m.set(p.ts,p); }); return [...m.values()]; };
  const prices=dedup(pricePoints).filter(p=>!isNaN(p.val));
  const ranks=dedup(rankPoints).filter(p=>!isNaN(p.val));

  const makeSvg=(points,isRank,chartId)=>{
    if(points.length<2) return '';
    const W=280,H=80,Pt=12,Pb=22,Pl=10,Pr=10,iW=W-Pl-Pr,iH=H-Pt-Pb;
    const vals=points.map(p=>p.val);
    let minV=Math.min(...vals),maxV=Math.max(...vals);
    if(minV===maxV){minV=Math.max(0,minV*0.85);maxV=maxV*1.15||1;}
    const yS=v=>isRank?Pt+(v-minV)/(maxV-minV)*iH:Pt+(1-(v-minV)/(maxV-minV))*iH;
    const xS=i=>Pl+(points.length===1?iW/2:i/(points.length-1)*iW);
    const pts=points.map((p,i)=>({...p,x:xS(i),y:yS(p.val)}));
    const poly=pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const cls=isRank?'chart-line-rank':'chart-line', dc=isRank?'chart-dot-rank':'chart-dot';

    // Month checkpoint x-axis labels
    const monthsSeen=new Set();
    const xLabels=pts.map((p,i)=>{
      const d=new Date(p.ts); const mk=`${d.getFullYear()}-${d.getMonth()}`;
      const d1=new Date(d.getFullYear(),d.getMonth(),1).getTime();
      // Find the point closest to 1st of this month
      const isCheckpoint = !monthsSeen.has(mk) && pts.reduce((a,b)=>Math.abs(b.ts-d1)<Math.abs(a.ts-d1)?b:a).ts===p.ts;
      if(isCheckpoint) monthsSeen.add(mk);
      const lbl=isCheckpoint?`${d.getMonth()+1}/1`:'';
      return lbl?`<text x="${p.x.toFixed(1)}" y="${(H-3).toFixed(1)}" text-anchor="middle" class="chart-label">${lbl}</text>`:'';
    }).join('');

    const dots=pts.map((p,i)=>{
      const prefix=isRank?'#':'$';
      const tooltip=`${prefix}${p.val} · ${fmtShortDate(p.fullDate)}`;
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" class="${dc}" style="cursor:pointer"
        onclick="showChartTooltip(event,'${chartId}','${tooltip}')"/>`;
    }).join('');

    return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" onclick="hideChartTooltip('${chartId}')">
      <polyline points="${poly}" class="${cls}"/>
      ${dots}${xLabels}
      <text id="${chartId}-tip" x="140" y="10" text-anchor="middle" class="chart-val" style="display:none;font-size:10px;fill:var(--acc)"></text>
    </svg>`;
  };

  const pct = prices.length>=2 ? ((prices[prices.length-1].val-prices[0].val)/prices[0].val*100) : null;
  const pctHtml = pct!==null ? `<span class="${pct>=0?'up':'dn'}" style="font-size:10px;margin-left:6px">${pct>=0?'+':''}${pct.toFixed(0)}%</span>` : '';

  let html='';
  const pSvg=makeSvg(prices,false,'pchart'), rSvg=makeSvg(ranks,true,'rchart');
  if(pSvg) html+=`<div class="chart-wrap"><div class="chart-title">Price history${pctHtml}</div>${pSvg}</div>`;
  if(rSvg) html+=`<div class="chart-wrap"><div class="chart-title">Rank history <span style="font-size:9px;color:var(--tx3)">(lower = better)</span></div>${rSvg}</div>`;
  return html;
}

function showChartTooltip(e, chartId, text) {
  e.stopPropagation();
  const tip = document.getElementById(chartId+'-tip');
  if(!tip) return;
  tip.textContent = text;
  tip.style.display = '';
}
function hideChartTooltip(chartId) {
  const tip = document.getElementById(chartId+'-tip');
  if(tip) tip.style.display = 'none';
}

// ── Modal sections ────────────────────────────────────────────────────────────
function modalCards(name) {
  const cs = getCardStats(name);
  const {owned, sold, totalInvested, totalNetProfit, totalSoldFor} = cs;
  if(!owned.length && !sold.length) return '';

  const roi = totalSoldFor>0 ? ((totalNetProfit/totalSoldFor)*100) : null;

  const summary = `<div class="srow" style="margin-bottom:9px">
    <div class="srow-t">My Cards</div>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;text-align:center;margin-bottom:10px">
      <div><div class="sc-l">Owned</div><div class="sc-v">${owned.length}</div></div>
      <div><div class="sc-l">Invested</div><div class="sc-v">$${totalInvested.toFixed(0)}</div></div>
      <div><div class="sc-l">Sold</div><div class="sc-v">${sold.length}</div></div>
      <div><div class="sc-l">Net Profit</div><div class="sc-v"><span class="${totalNetProfit>=0?'up':'dn'}">${totalNetProfit>=0?'+':''}$${Math.abs(totalNetProfit).toFixed(2)}</span></div></div>
      <div><div class="sc-l">ROI on Sold</div><div class="sc-v">${roi!==null?`<span class="${roi>=0?'up':'dn'}">${roi>=0?'+':''}${roi.toFixed(1)}%</span>`:'—'}</div></div>
    </div>
    <div style="display:flex;gap:8px">
      ${owned.length?`<button onclick="showCardsSubview('owned','${name}')" style="flex:1;padding:8px;border:.5px solid var(--bdr2);border-radius:8px;background:var(--acc-bg);color:var(--acc);font-size:13px;font-weight:500;cursor:pointer;font-family:inherit">Owned (${owned.length})</button>`:''}
      ${sold.length?`<button onclick="showCardsSubview('sold','${name}')" style="flex:1;padding:8px;border:.5px solid var(--bdr2);border-radius:8px;background:var(--b4-bg);color:var(--b4-tx);font-size:13px;font-weight:500;cursor:pointer;font-family:inherit">Sold (${sold.length})</button>`:''}
    </div>
  </div>`;

  return summary;
}

function showCardsSubview(type, name) {
  const cs = getCardStats(name);
  const {owned, sold} = cs;
  const currentPrice = safeNum(getResolved(name).price);
  const items = type==='owned' ? owned : sold;

  const rows = items.map(c=>{
    if(type==='owned'){
      const cardTs = parseDate(c.datePurchased||c.transactionDate);
      const cardPriceHistory = [];
      [...origTop200,...origTop100,...top200,...top100].filter(e=>normName(e.name)===normName(name)).forEach(e=>{
        const ts=parseDate(e.date); const pr=safeNum(e.price);
        if(ts&&pr) cardPriceHistory.push({ts,price:pr});
      });
      hotsheet.filter(h=>normName(h.name)===normName(name)).forEach(h=>{
        const ts=parseDate(h.date); const pr=safeNum(h.auto);
        if(ts&&pr) cardPriceHistory.push({ts,price:pr});
      });
      buyScores.filter(b=>normName(b.name)===normName(name)).forEach(b=>{
        const ts=parseDate(b.date); const pr=safeNum(b.price);
        if(ts&&pr) cardPriceHistory.push({ts,price:pr});
      });
      let pctHtml='';
      if(currentPrice>0 && cardTs && cardPriceHistory.length){
        const closest=cardPriceHistory.reduce((a,b)=>Math.abs(b.ts-cardTs)<Math.abs(a.ts-cardTs)?b:a);
        if(closest.price){ const pct=(currentPrice-closest.price)/closest.price*100;
          pctHtml=`<div class="ct-stat"><div class="ct-l">Since buy</div><div class="ct-v"><span class="${pct>=0?'up':'dn'}">${pct>=0?'+':''}${pct.toFixed(0)}%</span></div></div>`; }
      }
      return `<div class="ct-entry owned">
        <div class="ct-name">${c.fullCard||'—'}</div>
        <div class="ct-row">
          <div class="ct-stat"><div class="ct-l">Purchased</div><div class="ct-v">${fmtShortDate(c.datePurchased||c.transactionDate)}</div></div>
          <div class="ct-stat"><div class="ct-l">Cost</div><div class="ct-v">${fmtMoney(c.purchasePrice)}</div></div>
          ${pctHtml}
        </div>
        ${c.serialNo?`<div class="ct-serial">/${c.serialNo}</div>`:''}
      </div>`;
    } else {
      const p=safeNum(c.netProfit,true);
      return `<div class="ct-entry sold">
        <div class="ct-name">${c.fullCard||'—'}</div>
        <div class="ct-row">
          <div class="ct-stat"><div class="ct-l">Sold</div><div class="ct-v">${fmtShortDate(c.transactionDate)}</div></div>
          <div class="ct-stat"><div class="ct-l">Cost</div><div class="ct-v">${fmtMoney(c.purchasePrice)}</div></div>
          <div class="ct-stat"><div class="ct-l">Sold for</div><div class="ct-v">${fmtMoney(c.salePrice)}</div></div>
          <div class="ct-stat"><div class="ct-l">Net</div><div class="ct-v"><span class="${p>=0?'up':'dn'}">${p>=0?'+':''}$${Math.abs(p).toFixed(2)}</span></div></div>
        </div>
        ${c.serialNo?`<div class="ct-serial">/${c.serialNo}</div>`:''}
      </div>`;
    }
  }).join('');

  document.getElementById('mcontent').innerHTML=`
    <div style="position:sticky;top:0;background:var(--bg);padding:10px 0 8px;z-index:10;margin-bottom:6px">
      <button onclick="document.getElementById('mcontent').innerHTML=_modalMainHtml"
        style="display:flex;align-items:center;gap:6px;background:none;border:none;color:var(--acc);font-size:14px;font-weight:500;cursor:pointer;font-family:inherit;padding:0">
        ← Back
      </button>
    </div>
    <div class="section-hdr">Hot Sheet History — ${name}</div>
    ${rows}`;
}
// ── Detail modal ──────────────────────────────────────────────────────────────
let _modalMainHtml = '';
let _modalCurrentPlayer = '';

function attachModalEvents() {
  document.getElementById('closebtn').onclick = () => document.getElementById('mwrap').classList.remove('on');
}

function showDetail(p, tp) {
  const nm     = normName(p.name);
  const master = players.find(b=>normName(b.name)===nm);
  const d      = getResolved(p.name);
  const hist   = hotsheet.filter(h=>normName(h.name)===nm).sort((a,b)=>parseDate(b.date)-parseDate(a.date));

  const currentPrice = d.price?(String(d.price).startsWith('$')?d.price:'$'+d.price):'—';
  const currentRank  = d.rank?'#'+d.rank:'—';

  // Buy Score asterisk if no Buy Score sheet entry
  const hasBsEntry = buyScores.some(b=>normName(b.name)===nm);
  const bsDisplay  = d.buy ? `${d.buy}${!hasBsEntry?'*':''}` : '—';

  // Most recent note across all sources
  let recentNote = null;
  const noteCandidates = [];
  buyScores.filter(b=>normName(b.name)===nm&&b.notes).forEach(b=>noteCandidates.push({ts:parseDate(b.date),note:b.notes}));
  [...top200,...top100].filter(e=>normName(e.name)===nm&&e.notes).forEach(e=>noteCandidates.push({ts:parseDate(e.date),note:e.notes}));
  hotsheet.filter(h=>normName(h.name)===nm&&h.notes).forEach(h=>noteCandidates.push({ts:parseDate(h.date),note:h.notes}));
  if(master&&master.notes) noteCandidates.push({ts:parseDate(master.date)||0,note:master.notes});
  if(noteCandidates.length) recentNote = noteCandidates.reduce((a,b)=>b.ts>a.ts?b:a).note;

  const noteHtml = recentNote ? `<div class="srow" style="padding:0;overflow:hidden;margin-bottom:9px">
    <button class="notes-toggle" onclick="const b=this.nextElementSibling;b.style.display=b.style.display==='none'?'block':'none';this.querySelector('.arr').textContent=b.style.display==='none'?'▼':'▲'">
      <span class="lbl">Most Recent Note</span><span class="arr">▼</span>
    </button>
    <div class="notes-body" style="display:none"><p>${recentNote}</p></div>
  </div>` : '';

 const html=`
    <div class="mname">${p.name}</div>
    <div class="msub">${master?master.team:p.team||p.aff||''} · ${master?master.pos:p.pos||''}</div>
    <div class="sgrid" style="margin-bottom:9px">
      <div class="scard"><div class="slbl">Rank</div><div class="sval">${currentRank}</div></div>
      <div class="scard"><div class="slbl">Price</div><div class="sval">${currentPrice}</div></div>
      <div class="scard"><div class="slbl">Age</div><div class="sval">${fmt(master?master.age:p.age)}</div></div>
      <div class="scard"><div class="slbl">Buy Score</div><div class="sval">${bsDisplay}</div></div>
    </div>
${modalCards(p.name)}
    ${noteHtml}
    ${buildHistoryCharts(p.name)}
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:9px">
      ${hist.length?`<button onclick="showHsSubview()" style="width:100%;padding:10px;border:.5px solid var(--bdr2);border-radius:8px;background:var(--surf);color:var(--tx);font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;text-align:left">Hot Sheet History <span style="float:right;color:var(--tx3)">${hist.length} entries →</span></button>`:''}
      ${master?`<button onclick="showSourceRanksSubview()" style="width:100%;padding:10px;border:.5px solid var(--bdr2);border-radius:8px;background:var(--surf);color:var(--tx);font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;text-align:left">Source Ranks <span style="float:right;color:var(--tx3)">→</span></button>`:''}
      ${master&&master.notes?`<button onclick="showBuyNotesSubview()" style="width:100%;padding:10px;border:.5px solid var(--bdr2);border-radius:8px;background:var(--surf);color:var(--tx);font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;text-align:left">Buy Sheet Notes <span style="float:right;color:var(--tx3)">→</span></button>`:''}
    </div>`;
  _modalMainHtml = html;
  _modalCurrentPlayer = p.name;
  document.getElementById('mcontent').innerHTML = html;
  document.getElementById('mwrap').classList.add('on');
}


// ── Price performance ─────────────────────────────────────────────────────────
function buildPricePerformance(playerList) {
  const withPct = playerList.map(entry=>{
    const d = getResolved(entry.name);
    const currentPrice = safeNum(d.price);
    if(!entry.ownedCards.length || currentPrice===0) return null;

    // Find oldest owned card date
    const oldest = entry.ownedCards.reduce((a,b)=>
      parseDate(a.datePurchased||a.transactionDate)<parseDate(b.datePurchased||b.transactionDate)?a:b);
    const oldestTs = parseDate(oldest.datePurchased||oldest.transactionDate);
    if(!oldestTs) return null;

    // Build price history from sheet data for this player
    const nm = entry.name;
    const priceHistory = [];
    [...origTop200,...origTop100,...top200,...top100].filter(e=>normName(e.name)===nm).forEach(e=>{
      const ts=parseDate(e.date); const p=safeNum(e.price);
      if(ts&&p) priceHistory.push({ts,price:p});
    });
    hotsheet.filter(h=>normName(h.name)===nm).forEach(h=>{
      const ts=parseDate(h.date); const p=safeNum(h.auto);
      if(ts&&p) priceHistory.push({ts,price:p});
    });

    if(!priceHistory.length) return null;

    // Find closest price to oldest purchase date
    const closest = priceHistory.reduce((a,b)=>
      Math.abs(b.ts-oldestTs)<Math.abs(a.ts-oldestTs)?b:a);
    if(!closest.price) return null;

    const pct = (currentPrice-closest.price)/closest.price*100;
    const dispName = players.find(p=>normName(p.name)===nm)?.name||nm.replace(/\b\w/g,l=>l.toUpperCase());
    return {name:dispName, normName:nm, pct};
  }).filter(Boolean).sort((a,b)=>b.pct-a.pct);

  if(!withPct.length) return '';

  const gainers = withPct.filter(e=>e.pct>=0).slice(0,5);
  const losers  = [...withPct].reverse().filter(e=>e.pct<0).slice(0,5);
  const preview = [...gainers,...losers].sort((a,b)=>b.pct-a.pct);
  const all     = withPct;

  const rowHtml = items => items.map(e=>`
    <div class="pp-row" onclick="openPlayerFromPortfolio('${e.normName}')" style="cursor:pointer">
      <span class="pp-name">${e.name}</span>
      <span class="${e.pct>=0?'up':'dn'}" style="font-weight:600;font-size:13px">${e.pct>=0?'+':''}${e.pct.toFixed(0)}%</span>
    </div>`).join('');

  return `<div class="srow" style="margin-bottom:11px">
    <div class="srow-t">Price performance</div>
    <div id="pp-preview">${rowHtml(preview)}</div>
    <div id="pp-full" style="display:none">${rowHtml(all)}</div>
    ${all.length>preview.length?`<button onclick="document.getElementById('pp-preview').style.display='none';document.getElementById('pp-full').style.display='';this.style.display='none'" style="width:100%;padding:6px;background:none;border:.5px solid var(--bdr2);border-radius:7px;color:var(--tx2);font-size:12px;cursor:pointer;margin-top:6px;font-family:inherit">Show all ${all.length}</button>`:''}
  </div>`;
}
function modalHsHistory(hist) {
  if(!hist.length) return '';
  const rows = hist.map(h=>{
    return `<div class="hs-entry${h.repeat?' repeat':''}">
      <div class="hs-hdr">
        <span class="hs-wk">${fmtDateLabel(h.date)||'Wk '+h.week}</span>
        <span class="hs-lvl">${h.level}</span>
        ${h.category?`<span class="hs-cat">${h.category}</span>`:''}
        ${h.auto?`<span style="margin-left:auto;font-size:12px;font-weight:500">${h.auto}</span>`:''}
      </div>
      <div class="hs-stats" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <div><div class="hs-sl">14-Day</div><div class="hs-sv">${fmt(h.day14)}</div></div>
        <div><div class="hs-sl">Hobby</div><div class="hs-sv">${fmt(h.hobby)}</div></div>
        <div><div class="hs-sl">Buy Score</div><div class="hs-sv">${fmt(h.buyScore)}</div></div>
      </div>
      ${h.notes?`<div class="hs-notes">${h.notes}</div>`:''}
    </div>`;
  }).join('');
  return `<div class="section-hdr">Hot Sheet History</div>${rows}`;
}

function showHsSubview() {
  const name = _modalCurrentPlayer;
  const nm = normName(name);
  const hist = hotsheet.filter(h=>normName(h.name)===nm).sort((a,b)=>parseDate(b.date)-parseDate(a.date));
  const content = modalHsHistory(hist);
  document.getElementById('mcontent').innerHTML=`
    <button onclick="document.getElementById('mcontent').innerHTML=_modalMainHtml"
      style="display:flex;align-items:center;gap:6px;background:none;border:none;color:var(--acc);font-size:14px;font-weight:500;cursor:pointer;font-family:inherit;padding:0;margin-bottom:14px">
      ← Back
    </button>
    <div class="section-hdr">Hot Sheet History — ${name}</div>
    ${content||'<div class="empty-msg">No hot sheet entries found</div>'}`;
}

function showSourceRanksSubview() {
  const name = _modalCurrentPlayer;
  const nm = normName(name);
  const master = players.find(b=>normName(b.name)===nm);
  if(!master) return;
  document.getElementById('mcontent').innerHTML=`
    <button onclick="document.getElementById('mcontent').innerHTML=_modalMainHtml"
      style="display:flex;align-items:center;gap:6px;background:none;border:none;color:var(--acc);font-size:14px;font-weight:500;cursor:pointer;font-family:inherit;padding:0;margin-bottom:14px">
      ← Back
    </button>
    <div class="section-hdr">Source Ranks — ${name}</div>
    <div class="srow"><div class="s3">
      <div><div class="sc-l">MLB</div><div class="sc-v">${fmt(master.mlb)}</div></div>
      <div><div class="sc-l">DD</div><div class="sc-v">${fmt(master.dd)}</div></div>
      <div><div class="sc-l">Roto</div><div class="sc-v">${fmt(master.roto)}</div></div>
      <div><div class="sc-l">StS</div><div class="sc-v">${fmt(master.sts)}</div></div>
      <div><div class="sc-l">BA</div><div class="sc-v">${fmt(master.ba)}</div></div>
      <div><div class="sc-l">Hobby</div><div class="sc-v">${fmt(master.hobby)}</div></div>
    </div></div>`;
}

function showBuyNotesSubview() {
  const name = _modalCurrentPlayer;
  const nm = normName(name);
  const master = players.find(b=>normName(b.name)===nm);
  if(!master||!master.notes) return;
  document.getElementById('mcontent').innerHTML=`
    <button onclick="document.getElementById('mcontent').innerHTML=_modalMainHtml"
      style="display:flex;align-items:center;gap:6px;background:none;border:none;color:var(--acc);font-size:14px;font-weight:500;cursor:pointer;font-family:inherit;padding:0;margin-bottom:14px">
      ← Back
    </button>
    <div class="section-hdr">Buy Sheet Notes — ${name}</div>
    <div class="srow"><p style="font-size:13px;line-height:1.65;color:var(--tx)">${master.notes}</p></div>`;
}



// ── Portfolio ─────────────────────────────────────────────────────────────────
function renderPortfolio() {
  const prospectNames = new Set([
    ...players,...top200,...top100,...origTop200,...origTop100,...hotsheet
  ].map(p=>normName(p.name)));

  const prospectCards = cards.filter(c=>prospectNames.has(normName(c.player)));
  const allOwned = prospectCards.filter(c=>!c.salePrice);
  const allSold  = prospectCards.filter(c=> c.salePrice);
  const totalInvested   = allOwned.reduce((s,c)=>s+safeNum(c.purchasePrice),0);
  const totalSoldFor    = allSold.reduce((s,c)=>s+safeNum(c.salePrice),0);
  const totalNetProfit  = allSold.reduce((s,c)=>s+safeNum(c.netProfit,true),0);

  const recentPurchases = [...allOwned].filter(c=>c.datePurchased||c.transactionDate)
    .sort((a,b)=>parseDate(b.datePurchased||b.transactionDate)-parseDate(a.datePurchased||a.transactionDate)).slice(0,5);
  const recentSales = [...allSold].filter(c=>c.transactionDate)
    .sort((a,b)=>parseDate(b.transactionDate)-parseDate(a.transactionDate)).slice(0,5);

  const byPlayer = new Map();
  prospectCards.forEach(c=>{
    const k=normName(c.player);
    if(!byPlayer.has(k)) byPlayer.set(k,{name:k,ownedCards:[],soldCards:[],totalInvested:0,totalSoldFor:0,totalNet:0});
    const e=byPlayer.get(k);
    if(!c.salePrice){ e.ownedCards.push(c); e.totalInvested+=safeNum(c.purchasePrice); }
    else{ e.soldCards.push(c); e.totalSoldFor+=safeNum(c.salePrice); e.totalNet+=safeNum(c.netProfit,true); }
  });
  const playerList=[...byPlayer.values()].sort((a,b)=>b.totalInvested-a.totalInvested);

  const summaryHtml=`
    <div class="srow" style="margin-bottom:11px"><div class="srow-t">Portfolio summary</div><div class="s3">
      <div><div class="sc-l">Cards owned</div><div class="sc-v">${allOwned.length}</div></div>
      <div><div class="sc-l">Total invested</div><div class="sc-v">$${totalInvested.toFixed(0)}</div></div>
      <div><div class="sc-l">Cards sold</div><div class="sc-v">${allSold.length}</div></div>
    </div></div>
    <div class="srow" style="margin-bottom:11px"><div class="srow-t">Sales performance</div><div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;text-align:center">
      <div><div class="sc-l">Sold for</div><div class="sc-v">$${totalSoldFor.toFixed(0)}</div></div>
      <div><div class="sc-l">Net profit</div><div class="sc-v"><span class="${(totalSoldFor-totalInvested)>=0?'up':'dn'}">${(totalSoldFor-totalInvested)>=0?'+':''}$${(totalSoldFor-totalInvested).toFixed(2)}</span></div></div>
      <div><div class="sc-l">ROI</div><div class="sc-v">${totalInvested>0?`<span class="${(totalSoldFor-totalInvested)>=0?'up':'dn'}">${(totalSoldFor-totalInvested)>=0?'+':''}${(((totalSoldFor-totalInvested)/totalInvested)*100).toFixed(1)}%</span>`:'—'}</div></div>
      <div><div class="sc-l">ROI on sold</div><div class="sc-v">${allSold.length>0&&(totalSoldFor-totalNetProfit)>0?`<span class="${totalNetProfit>=0?'up':'dn'}">${totalNetProfit>=0?'+':''}${((totalNetProfit/(totalSoldFor-totalNetProfit))*100).toFixed(1)}%</span>`:'—'}</div></div>
    </div></div>`;

  const recentHtml=`
    <div class="srow" style="margin-bottom:11px"><div class="srow-t">Recent purchases</div>
      ${recentPurchases.length?recentPurchases.map(c=>`<div class="recent-row">
        <div class="recent-info"><div class="rc-name">${c.fullCard||'—'}</div><div class="rc-date">${fmtShortDate(c.datePurchased||c.transactionDate)}</div></div>
        <div class="recent-price">$${safeNum(c.purchasePrice).toFixed(2)}</div>
      </div>`).join(''):'<div style="font-size:12px;color:var(--tx3);padding:4px 0">No recent purchases</div>'}
    </div>
    <div class="srow" style="margin-bottom:11px"><div class="srow-t">Recent sales</div>
      ${recentSales.length?recentSales.map(c=>{ const net=safeNum(c.netProfit,true); return `<div class="recent-row">
        <div class="recent-info"><div class="rc-name">${c.fullCard||'—'}</div><div class="rc-date">${fmtShortDate(c.transactionDate)}</div></div>
        <div class="recent-sale"><div class="rs-price">$${safeNum(c.salePrice).toFixed(2)}</div><div class="rs-net ${net>=0?'up':'dn'}">${net>=0?'+':''}$${Math.abs(net).toFixed(2)}</div></div>
      </div>`; }).join(''):'<div style="font-size:12px;color:var(--tx3);padding:4px 0">No recent sales</div>'}
    </div>`;

  const holdingsHtml=playerList.length?`
    <div class="section-hdr">All player cards</div>
    ${playerList.map(entry=>{
      const tier=entry.totalInvested>0?invTier(entry.totalInvested):null;
      const dispName=players.find(p=>normName(p.name)===entry.name)?.name||entry.name.replace(/\b\w/g,l=>l.toUpperCase());
      const ownedBadge=entry.ownedCards.length>0?`<span class="inv-badge ${tier}">${entry.ownedCards.length} owned · $${entry.totalInvested.toFixed(0)}</span>`:'';
      const soldBadge=entry.soldCards.length>0?`<span class="sold-badge" style="margin-left:4px">${entry.soldCards.length} sold · <span class="${entry.totalNet>=0?'up':'dn'}">${entry.totalNet>=0?'+':''}$${entry.totalNet.toFixed(2)}</span></span>`:'';
      return `<div class="ct-entry${entry.ownedCards.length>0?' owned':''} port-player" onclick="openPlayerFromPortfolio('${entry.name}')">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:14px;font-weight:500;flex:1">${dispName}</span>${ownedBadge}${soldBadge}
        </div>
        ${entry.ownedCards.length>0?`<div class="ct-row" style="margin-top:6px">${entry.ownedCards.map(c=>`<div class="ct-stat"><div class="ct-l">${(c.fullCard||'').split(' ').slice(0,3).join(' ')}</div><div class="ct-v">$${safeNum(c.purchasePrice).toFixed(2)}</div></div>`).join('')}</div>`:''}
      </div>`;
    }).join('')}`:'<div class="empty-msg" style="padding:20px 0">No prospect cards found</div>';

  const perfHtml = buildPricePerformance(playerList);
  document.getElementById('list').innerHTML=summaryHtml+perfHtml+recentHtml+holdingsHtml;
  document.getElementById('cntlbl').textContent=`${playerList.length} player${playerList.length===1?'':'s'}`;
}

function openPlayerFromPortfolio(nameLower) {
  const p=players.find(pl=>normName(pl.name)===nameLower);
  if(p){ showDetail(p,'player'); return; }
  const c=cards.find(cd=>normName(cd.player)===nameLower);
  if(c) showDetail({name:c.player.replace(/\b\w/g,l=>l.toUpperCase()),team:'',pos:'',aff:''},'player');
}

// ── Watchlist render ──────────────────────────────────────────────────────────
function renderWatchlist() {
  const list = document.getElementById('list');
  const cnt  = document.getElementById('cntlbl');

  if (!watchlistItems.length) {
    list.innerHTML = '<div class="empty-msg">No active watchlist items</div>';
    cnt.textContent = '0 items';
    return;
  }

  cnt.textContent = `${watchlistItems.length} item${watchlistItems.length===1?'':'s'}`;

  list.innerHTML = watchlistItems.map((item, i) => {
    const { text: cdText, cls: cdCls } = getCountdown(item.endTime);
    const price = item.currentPrice ? `$${parseFloat(item.currentPrice).toFixed(2)}` : '';
    const rawTitle = item.savedTitle || item.title || '';
    const safeTitle = rawTitle.replace(/&amp;/g,'&').replace(/&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
    const ebayUrl = `https://www.ebay.com/itm/${item.itemId}`;

    return `<div class="wl-card">
      <div class="wl-top">
        <span class="wl-countdown ${cdCls}" data-end="${item.endTime||''}">${cdText}</span>
        ${price ? `<span class="wl-price">${price}</span>` : ''}
      </div>
      <textarea class="wl-title" id="wlt-${i}" rows="3">${safeTitle}</textarea>
      <div class="wl-btns">
        <button class="wl-btn wl-listing" onclick="window.open('${ebayUrl}','_blank')">Listing</button>
        <button class="wl-btn wl-copy" onclick="copyText(document.getElementById('wlt-${i}').value, this)">Copy</button>
        <button class="wl-btn wl-cl" onclick="window.open(searchUrl.cardladder(document.getElementById('wlt-${i}').value),'_blank')">Card Ladder</button>
        <button class="wl-btn wl-comc" onclick="window.open(searchUrl.comc(document.getElementById('wlt-${i}').value),'_blank')">COMC</button>
        <button class="wl-btn wl-ebay" onclick="window.open(searchUrl.ebay(document.getElementById('wlt-${i}').value),'_blank')">eBay Search</button>
        <button class="wl-btn wl-id" onclick="copyText('${item.itemId}', this)">Copy ID</button>
        <button class="wl-btn wl-save" onclick="saveTitle('${item.itemId}', document.getElementById('wlt-${i}').value, this)">Save</button>
      </div>
    </div>`;
  }).join('');

  startCountdownTick();
}
