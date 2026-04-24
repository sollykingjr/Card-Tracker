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
  if(tab==='t200'){ const b=mostRecent(top200).filter(r=>matchQ(r.name,r.team)); return applySort(b,p=>p.slice().sort((a,b)=>parseInt(a.rank)-parseInt(b.rank))); }
  if(tab==='t100'){ const b=mostRecent(top100).filter(r=>matchQ(r.name,r.team)); return applySort(b,p=>p.slice().sort((a,b)=>parseInt(a.rank)-parseInt(b.rank))); }
  if(tab==='hs')  { const b=mostRecent(hotsheet).filter(r=>matchQ(r.name,r.aff)); return applySort(b,p=>p.slice().sort((a,b)=>parseDate(b.date)-parseDate(a.date))); }
  if(tab==='port') return [];

  let pool=[...players];
  if(brf==='5') pool=pool.filter(p=>parseInt(p.buy)===5);
  else if(brf==='4') pool=pool.filter(p=>parseInt(p.buy)>=4);
  else if(brf==='owned') pool=pool.filter(p=>getCardStats(p.name).owned.length>0);
  else if(brf==='sold')  pool=pool.filter(p=>getCardStats(p.name).sold.length>0);
  if(posf==='hit') pool=pool.filter(p=>(p.pos||'').toLowerCase().includes('hitter'));
  else if(posf==='pit') pool=pool.filter(p=>(p.pos||'').toLowerCase().includes('pitcher'));
  pool=pool.filter(p=>matchQ(p.name,p.team));
  return applySort(pool,p=>p.slice().sort((a,b)=>{
    const ab=parseInt(a.buy)||0,bb=parseInt(b.buy)||0;
    if(ab!==bb) return bb-ab;
    return safeNum(b.price)-safeNum(a.price);
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
    ? `<div class="rnum${isPitcher?' pitcher':''}">#${rank}</div>`
    : `<div class="rnum empty">—</div>`;

  const priceStr = price?(String(price).startsWith('$')?price:'$'+price):'';
  const priceHtml= priceStr?`<div class="pbox">${priceStr}</div>`:`<div class="pbox empty">—</div>`;

  let labelHtml='';
  if(hsLabel){ const cls=isRepeat?'repeat':isSleeper?'sleeper':''; labelHtml=`<span class="hs-label${cls?' '+cls:''}">${hsLabel}</span>`; }

  // Week badges — Hot Sheet tab only
  let wkHtml='';
  if(tab==='hs' && hi.totalAppearances>0){
    if(hi.streak>=2) wkHtml+=`<span class="wk-badge streak">${hi.streak} Straight</span>`;
    else if(hi.onLatest) wkHtml+=`<span class="wk-badge">Most Recent</span>`;
    if(hi.totalAppearances>1) wkHtml+=`<span class="wk-badge">x${hi.totalAppearances}</span>`;
  }

  // Inventory badges
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
        ${labelHtml}${d.buy?badge(d.buy):''}${wkHtml}${invHtml}
      </div>
    </div>
    ${priceHtml}
  </div>`;
}

// ── Main render ───────────────────────────────────────────────────────────────
function render() {
  const isTop=tab==='t200'||tab==='t100', isHS=tab==='hs', isPort=tab==='port';
  const showChips=!isTop&&!isHS&&!isPort;
  document.getElementById('chips').style.display=showChips?'flex':'none';
  document.getElementById('chips2').style.display=showChips?'flex':'none';
  renderSortChips();
  if(isPort){ renderPortfolio(); return; }

  const pool=getPool();
  document.getElementById('cntlbl').textContent=`${pool.length} player${pool.length===1?'':'s'}`;
  if(!pool.length){ document.getElementById('list').innerHTML='<div class="empty-msg">No players match</div>'; return; }

  let html='';
  if(isHS) html=pool.map((r,i)=>buildCard(r.name,r.aff,r.pos,i,'hs')).join('');
  else if(isTop) html=pool.map((r,i)=>buildCard(r.name,r.team,tab==='t200'?'Hitter':'Pitcher',i,'top',{rank:r.rank,price:r.price})).join('');
  else html=pool.map((p,i)=>buildCard(p.name,p.team,p.pos,i,'player')).join('');

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
    list.push({label:fmtDateLabel(dateVal),ts,val:n});
  };
  const buyE=players.find(b=>normName(b.name)===nm);
  if(buyE){ add(buyE.date,buyE.price,pricePoints); add(buyE.date,buyE.hobby,rankPoints); }
  [...origTop200,...origTop100].filter(e=>normName(e.name)===nm).forEach(e=>{ add(e.date,e.price,pricePoints); add(e.date,e.rank,rankPoints); });
  [...top200,...top100].filter(e=>normName(e.name)===nm).forEach(e=>{ add(e.date,e.price,pricePoints); add(e.date,e.rank,rankPoints); });
  hotsheet.filter(h=>normName(h.name)===nm).forEach(h=>{ add(h.date,h.auto,pricePoints); add(h.date,h.hobby,rankPoints); });

  const dedup=pts=>{ pts.sort((a,b)=>a.ts-b.ts); const m=new Map(); pts.forEach(p=>{ if(!m.has(p.ts)) m.set(p.ts,p); }); return [...m.values()]; };
  const prices=dedup(pricePoints).filter(p=>!isNaN(p.val));
  const ranks=dedup(rankPoints).filter(p=>!isNaN(p.val));

  const makeSvg=(points,isRank)=>{
    if(points.length<2) return '';
    const W=280,H=68,Pt=20,Pb=22,Pl=10,Pr=10,iW=W-Pl-Pr,iH=H-Pt-Pb;
    const vals=points.map(p=>p.val);
    let minV=Math.min(...vals),maxV=Math.max(...vals);
    if(minV===maxV){minV=Math.max(0,minV*0.85);maxV=maxV*1.15||1;}
    const yS=v=>isRank?Pt+(v-minV)/(maxV-minV)*iH:Pt+(1-(v-minV)/(maxV-minV))*iH;
    const xS=i=>Pl+(points.length===1?iW/2:i/(points.length-1)*iW);
    const pts=points.map((p,i)=>({...p,x:xS(i),y:yS(p.val)}));
    const poly=pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const cls=isRank?'chart-line-rank':'chart-line', dc=isRank?'chart-dot-rank':'chart-dot';
    const dots=pts.map((p,i)=>{
      const first=i===0,last=i===pts.length-1,anc=first?'start':last?'end':'middle';
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" class="${dc}"/>
        ${(first||last)?`<text x="${p.x.toFixed(1)}" y="${(p.y-6).toFixed(1)}" text-anchor="${anc}" class="chart-val">${isRank?'#':'$'}${p.val}</text>`:''}
        <text x="${p.x.toFixed(1)}" y="${(H-3).toFixed(1)}" text-anchor="${anc}" class="chart-label">${p.label}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg"><polyline points="${poly}" class="${cls}"/>${dots}</svg>`;
  };
  let html='';
  const pSvg=makeSvg(prices,false), rSvg=makeSvg(ranks,true);
  if(pSvg) html+=`<div class="chart-wrap"><div class="chart-title">Price history</div>${pSvg}</div>`;
  if(rSvg) html+=`<div class="chart-wrap"><div class="chart-title">Rank history <span style="font-size:9px;color:var(--tx3)">(lower = better)</span></div>${rSvg}</div>`;
  return html;
}

// ── Modal sections ────────────────────────────────────────────────────────────
function modalHsHistory(hist) {
  if(!hist.length) return '';
  const rows = hist.map(h=>{
    const isPit=h.pos==='Pitcher';
    const stats=isPit
      ?`<div><div class="hs-sl">IP</div><div class="hs-sv">${fmt(h.ip)}</div></div><div><div class="hs-sl">ERA</div><div class="hs-sv">${fmt(h.era)}</div></div><div><div class="hs-sl">WHIP</div><div class="hs-sv">${fmt(h.whip)}</div></div><div><div class="hs-sl">K/9</div><div class="hs-sv">${fmt(h.k9)}</div></div><div><div class="hs-sl">SO</div><div class="hs-sv">${fmt(h.sop)}</div></div><div><div class="hs-sl">BB</div><div class="hs-sv">${fmt(h.bbp)}</div></div>`
      :`<div><div class="hs-sl">OPS</div><div class="hs-sv">${fmt(h.ops)}</div></div><div><div class="hs-sl">BA</div><div class="hs-sv">${fmt(h.ba)}</div></div><div><div class="hs-sl">HR</div><div class="hs-sv">${fmt(h.hr)}</div></div><div><div class="hs-sl">RBI</div><div class="hs-sv">${fmt(h.rbi)}</div></div><div><div class="hs-sl">SB</div><div class="hs-sv">${fmt(h.sb)}</div></div><div><div class="hs-sl">OBP</div><div class="hs-sv">${fmt(h.obp)}</div></div>`;
    return `<div class="hs-entry${h.repeat?' repeat':''}">
      <div class="hs-hdr">
        <span class="hs-wk">${fmtDateLabel(h.date)||'Wk '+h.week}</span>
        <span class="hs-lvl">${h.level}</span>
        ${h.category?`<span class="hs-cat">${h.category}</span>`:''}
        ${h.auto?`<span style="margin-left:auto;font-size:12px;font-weight:500">${h.auto}</span>`:''}
      </div>
      <div class="hs-stats">${stats}</div>
      ${h.notes?`<div class="hs-notes">${h.notes}</div>`:''}
    </div>`;
  }).join('');
  return `<div class="section-hdr">Hot sheet history</div>${rows}`;
}

function modalCards(name) {
  const cs = getCardStats(name);
  const {owned, sold, totalInvested, totalNetProfit, avgHold, bestFlip} = cs;
  if(!owned.length && !sold.length) return '';

  const summary = `<div class="srow" style="margin-bottom:9px"><div class="srow-t">Cards summary</div><div class="s3">
    <div><div class="sc-l">Owned</div><div class="sc-v">${owned.length}</div></div>
    <div><div class="sc-l">Invested</div><div class="sc-v">$${totalInvested.toFixed(0)}</div></div>
    <div><div class="sc-l">Sold</div><div class="sc-v">${sold.length}</div></div>
    ${totalNetProfit!==0?`<div><div class="sc-l">Net profit</div><div class="sc-v"><span class="${totalNetProfit>=0?'up':'dn'}">${totalNetProfit>=0?'+':''}$${Math.abs(totalNetProfit).toFixed(2)}</span></div></div>`:''}
    ${avgHold!==null?`<div><div class="sc-l">Avg hold</div><div class="sc-v">${avgHold}d</div></div>`:''}
  </div></div>`;

  const flip = bestFlip && safeNum(bestFlip.netProfit,true)>0 ? `<div class="srow" style="margin-bottom:9px"><div class="srow-t">Best flip</div>
    <div style="font-size:12px;color:var(--tx2);margin-bottom:4px">${bestFlip.fullCard||'—'}</div>
    <div class="s3">
      <div><div class="sc-l">Cost</div><div class="sc-v">${fmtMoney(bestFlip.purchasePrice)}</div></div>
      <div><div class="sc-l">Sold</div><div class="sc-v">${fmtMoney(bestFlip.salePrice)}</div></div>
      <div><div class="sc-l">Net</div><div class="sc-v"><span class="up">+$${safeNum(bestFlip.netProfit,true).toFixed(2)}</span></div></div>
    </div></div>` : '';

  const ownedRows = owned.map(c=>`<div class="ct-entry owned">
    <div class="ct-name">${c.fullCard||'—'}</div>
    <div class="ct-row">
      <div class="ct-stat"><div class="ct-l">Purchased</div><div class="ct-v">${fmtShortDate(c.datePurchased||c.transactionDate)}</div></div>
      <div class="ct-stat"><div class="ct-l">Cost</div><div class="ct-v">${fmtMoney(c.purchasePrice)}</div></div>
    </div>
    ${c.serialNo?`<div class="ct-serial">/${c.serialNo}</div>`:''}
  </div>`).join('');

  const soldRows = sold.map(c=>{ const p=safeNum(c.netProfit,true); return `<div class="ct-entry sold">
    <div class="ct-name">${c.fullCard||'—'}</div>
    <div class="ct-row">
      <div class="ct-stat"><div class="ct-l">Sold</div><div class="ct-v">${fmtShortDate(c.transactionDate)}</div></div>
      <div class="ct-stat"><div class="ct-l">Cost</div><div class="ct-v">${fmtMoney(c.purchasePrice)}</div></div>
      <div class="ct-stat"><div class="ct-l">Sold for</div><div class="ct-v">${fmtMoney(c.salePrice)}</div></div>
      <div class="ct-stat"><div class="ct-l">Net</div><div class="ct-v"><span class="${p>=0?'up':'dn'}">${p>=0?'+':''}$${Math.abs(p).toFixed(2)}</span></div></div>
    </div>
    ${c.serialNo?`<div class="ct-serial">/${c.serialNo}</div>`:''}
  </div>`; }).join('');

  return `<div class="section-hdr">My cards</div>${summary}${flip}
    ${owned.length?`<div class="section-hdr">Owned (${owned.length})</div>${ownedRows}`:''}
    ${sold.length?`<div class="section-hdr" style="margin-top:${owned.length?'12px':'0'}">Sold (${sold.length})</div>${soldRows}`:''}`;
}

// ── Detail modal ──────────────────────────────────────────────────────────────
function showDetail(p, tp) {
  const nm     = normName(p.name);
  const master = players.find(b=>normName(b.name)===nm);
  const d      = getResolved(p.name);
  const hist   = hotsheet.filter(h=>normName(h.name)===nm).sort((a,b)=>parseDate(b.date)-parseDate(a.date));
  const topE   = [...mostRecent(top200),...mostRecent(top100)].find(e=>normName(e.name)===nm);

  const currentPrice = d.price?(String(d.price).startsWith('$')?d.price:'$'+d.price):'—';
  const currentRank  = d.rank?'#'+d.rank:'—';

  const hsWeeks=[...new Set(hist.map(h=>h.week).filter(Boolean))].sort((a,b)=>parseInt(a)-parseInt(b));
  const wksHtml=hsWeeks.length?`<div style="margin-bottom:9px">${hsWeeks.map(w=>`<span class="wk-badge">Wk${w}</span>`).join('')}</div>`:'';

  const html=`
    <div class="mname">${p.name}</div>
    <div class="msub">${master?master.team:p.team||p.aff||''} · ${master?master.pos:p.pos||''}${master&&master.buy?' · Buy Rating '+master.buy:''}</div>

    <div class="sgrid">
      <div class="scard"><div class="slbl">Rank</div><div class="sval">${currentRank}</div></div>
      <div class="scard"><div class="slbl">Price</div><div class="sval">${currentPrice}</div></div>
      <div class="scard"><div class="slbl">Age</div><div class="sval">${fmt(master?master.age:p.age)}</div></div>
      <div class="scard"><div class="slbl">Buy Rating</div><div class="sval">${fmt(master?master.buy:null)}</div></div>
    </div>

    ${master&&master.notes?`<div class="srow" style="padding:0;overflow:hidden">
      <button class="notes-toggle" onclick="const b=this.nextElementSibling;b.style.display=b.style.display==='none'?'block':'none';this.querySelector('.arr').textContent=b.style.display==='none'?'▼':'▲'">
        <span class="lbl">Buy Sheet Notes</span><span class="arr">▼</span>
      </button>
      <div class="notes-body"><p>${master.notes}</p></div>
    </div>`:''}

    ${master?`<div class="srow"><div class="srow-t">Source ranks</div><div class="s3">
      <div><div class="sc-l">MLB</div><div class="sc-v">${fmt(master.mlb)}</div></div>
      <div><div class="sc-l">DD</div><div class="sc-v">${fmt(master.dd)}</div></div>
      <div><div class="sc-l">Roto</div><div class="sc-v">${fmt(master.roto)}</div></div>
      <div><div class="sc-l">StS</div><div class="sc-v">${fmt(master.sts)}</div></div>
      <div><div class="sc-l">BA</div><div class="sc-v">${fmt(master.ba)}</div></div>
      <div><div class="sc-l">Hobby</div><div class="sc-v">${fmt(master.hobby)}</div></div>
    </div></div>`:''}

    ${topE?`<div class="srow"><div class="srow-t">Latest ranking</div><div class="s3">
      <div><div class="sc-l">Rank</div><div class="sc-v">#${topE.rank}</div></div>
      <div><div class="sc-l">Prev</div><div class="sc-v">${fmt(topE.prev)}</div></div>
      <div><div class="sc-l">Change</div><div class="sc-v">${fmtDiff(topE.diff)}</div></div>
    </div></div>`:''}

    ${master&&master.lastYr?`<div class="srow"><div class="srow-t">Year over year</div><div class="s3">
      <div><div class="sc-l">Last year</div><div class="sc-v">$${master.lastYr}</div></div>
      <div><div class="sc-l">Now</div><div class="sc-v">${fmtP(master.price)}</div></div>
      <div><div class="sc-l">Change</div><div class="sc-v">${fmtPct(master.chg)}</div></div>
    </div></div>`:''}

    ${d.priceChange?`<div class="srow"><div class="srow-t">Price movement</div><div class="s3">
      <div><div class="sc-l">Original</div><div class="sc-v">$${safeNum(d.priceChange.orig).toFixed(2)}</div></div>
      <div><div class="sc-l">Current</div><div class="sc-v">$${safeNum(d.priceChange.now).toFixed(2)}</div></div>
      <div><div class="sc-l">Change</div><div class="sc-v">${fmtPct(d.priceChange.pct)}</div></div>
    </div></div>`:''}

    ${buildHistoryCharts(p.name)}
    ${wksHtml}
    ${modalHsHistory(hist)}
    ${modalCards(p.name)}`;

  document.getElementById('mcontent').innerHTML=html;
  document.getElementById('mwrap').classList.add('on');
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

  document.getElementById('list').innerHTML=summaryHtml+recentHtml+holdingsHtml;
  document.getElementById('cntlbl').textContent=`${playerList.length} player${playerList.length===1?'':'s'}`;
}

function openPlayerFromPortfolio(nameLower) {
  const p=players.find(pl=>normName(pl.name)===nameLower);
  if(p){ showDetail(p,'player'); return; }
  const c=cards.find(cd=>normName(cd.player)===nameLower);
  if(c) showDetail({name:c.player.replace(/\b\w/g,l=>l.toUpperCase()),team:'',pos:'',aff:''},'player');
}
