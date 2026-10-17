// Posts tab: what he published, newest first. Each card has the summary and the players who stood out;
// the old Sheet imports (no summaries) are collapsed at the bottom. Opening a post shows a ranked table for ranking posts, otherwise players by Buy Score.
let ppPosts = [], ppLoaded = false, ppShowOld = false, ppBack = '';
const ppType = t => ({ rankings: 'Rankings', hot_sheet: 'Hot Sheet', analysis: 'Analysis', price_update: 'Prices', other: 'Other' }[t] || t || '');
const ppDate = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${+m[2]}/${+m[3]}/${m[1].slice(2)}` : ''; };
const ppMoney = c => c == null ? '' : '$' + (c / 100).toFixed(c % 100 ? 2 : 0);
const ppTone = n => n == null ? '' : n >= 4.5 ? 'hi' : n >= 3 ? 'mid' : 'lo';
const ppBs = n => String(Math.round(Number(n) * 100) / 100);
// His ranking for a player in a post: a Top list wins over the hobby rank (same ranking, different label).
const ppRank = x => { const r = x.ranks || {}; return r['top 200 hitters'] ?? r['top 100 pitchers'] ?? r['hobby rank'] ?? null; };

function ppCard(p) {
  const chips = (p.top || []).map(x => `<span class="po-chip"><b class="ph-t-${ppTone(x.buy)}">${ppBs(x.buy)}</b> ${pibEsc(x.name)}${x.price_c != null ? ` <i>${ppMoney(x.price_c)}</i>` : ''}</span>`).join('');
  const ranked = (p.top_ranked || []).length ? `<div class="po-rankline">${p.top_ranked.map(x => `<span><b>#${x.rank}</b> ${pibEsc(x.name)}</span>`).join('')}</div>` : '';
  return `<div class="po-card" onclick="ppOpen('${p.post_id}')">
    <div class="po-head"><div class="po-title">${pibEsc(p.title || 'Untitled')}</div><div class="po-meta">${ppDate(p.published_at)} · ${pibEsc(ppType(p.post_type))} · ${p.players} player${p.players === 1 ? '' : 's'}</div></div>
    ${p.summary ? `<div class="po-sum">${pibEsc(p.summary)}</div>` : ''}${ranked}${chips ? `<div class="po-chips">${chips}</div>` : ''}
  </div>`;
}
const ppOldRow = p => `<div class="po-old" onclick="ppOpen('${p.post_id}')"><span class="po-old-t">${pibEsc(p.title || 'Untitled')}</span><span class="po-meta">${ppDate(p.published_at)} · ${pibEsc(ppType(p.post_type))} · ${p.players}</span></div>`;

const ppSearchCache = {};
async function renderPostsView() {
  const listEl = document.getElementById('list');
  listEl.classList.remove('grid-2');
  document.getElementById('cntlbl').textContent = '';
  if (!ppLoaded) {
    listEl.innerHTML = '<div class="spin"><div class="spin-ring"></div>Loading posts…</div>';
    const d = await pibCall('/prospect-posts');
    if (tab !== 'posts') return;
    if (d.error) { listEl.innerHTML = `<div class="err"><strong>Could not load posts</strong><br>${pibEsc(d.error)}</div>`; return; }
    ppPosts = d.posts || []; ppLoaded = true;
  }
  const f = sortBy === 'default' ? null : sortBy;
  let posts = f ? ppPosts.filter(p => p.post_type === f) : ppPosts;
  const ql = (typeof q === 'string' ? q : '').trim().toLowerCase();
  if (ql.length >= 2) {   // top search box: posts that mention the player, or whose title/summary match
    if (!ppSearchCache[ql]) {
      const d = await pibCall('/prospect-posts-search?q=' + encodeURIComponent(ql));
      if (tab !== 'posts' || (typeof q === 'string' ? q : '').trim().toLowerCase() !== ql) return;   // user moved on
      ppSearchCache[ql] = new Set(d.post_ids || []);
    }
    const ids = ppSearchCache[ql];
    posts = posts.filter(p => ids.has(p.post_id));
  }
  const fresh = posts.filter(p => p.source !== 'prospect-master-sheet'), old = posts.filter(p => p.source === 'prospect-master-sheet');
  document.getElementById('cntlbl').textContent = `${posts.length} post${posts.length === 1 ? '' : 's'}`;
  listEl.innerHTML = (fresh.length ? `<div class="po-grid">${fresh.map(ppCard).join('')}</div>` : `<div class="empty-msg">${ql ? 'No posts match' : 'No posts yet'}</div>`)
    + (old.length ? `<div class="po-oldbar" onclick="ppShowOld=!ppShowOld;renderPostsView()">Older history (${old.length} posts from the old Sheet) <span>${(ppShowOld || ql) ? '▲' : '▼'}</span></div>${(ppShowOld || ql) ? `<div class="po-oldlist">${old.map(ppOldRow).join('')}</div>` : ''}` : '');
}

// One row in an opened post: score, name, price and his note.
function ppPlayerRow(x, i) {
  const r = ppRank(x), t = x.take;
  return `<div class="po-pl" onclick="ppPlayer(${i})">
    <div class="po-pl-bs ph-t-${ppTone(x.buy)}">${x.buy != null ? ppBs(x.buy) : '—'}</div>
    <div class="po-pl-main"><div class="po-pl-name">${pibEsc(x.name)}${r != null ? ` <span class="po-pl-rank">#${r}</span>` : ''}</div>
      <div class="po-pl-sub">${[x.side === 'pitcher' ? 'Pitcher' : x.side === 'hitter' ? 'Hitter' : '', x.team, x.action].filter(Boolean).map(pibEsc).join(' · ')}</div>
      ${t && (t.summary || t.analysis) ? `<div class="ph-note">${pibEsc(t.summary || t.analysis)}</div>` : ''}</div>
    <div class="po-pl-price">${x.price_c != null ? ppMoney(x.price_c) : ''}${x.expected_c != null ? `<small>exp ${ppMoney(x.expected_c)}</small>` : ''}</div></div>`;
}
// Ranking table: rank, player, score, price.
function ppRankRow(x, i) {
  return `<div class="po-rk" onclick="ppPlayer(${i})"><span class="po-rk-n">${ppRank(x)}</span><span class="po-rk-name">${pibEsc(x.name)}<small>${[x.team, x.side === 'pitcher' ? 'P' : x.side === 'hitter' ? 'H' : ''].filter(Boolean).map(pibEsc).join(' · ')}</small></span><span class="po-rk-bs ph-t-${ppTone(x.buy)}">${x.buy != null ? ppBs(x.buy) : ''}</span><span class="po-rk-p">${x.price_c != null ? ppMoney(x.price_c) : ''}</span></div>`;
}

let ppCur = [];   // the players of the open post, in the order drawn (rows call ppPlayer(index))
function ppPlayer(i) {
  const x = ppCur[i]; if (!x) return;
  ppBack = document.getElementById('mcontent').innerHTML;
  phShowModal(x.name, ppBack);
}
function ppMore(id, btn) { document.getElementById(id).style.display = 'block'; btn.remove(); }

async function ppOpen(id) {
  const mc = document.getElementById('mcontent');
  mc.innerHTML = '<div class="spin"><div class="spin-ring"></div>Loading…</div>';
  document.getElementById('mwrap').classList.add('on');
  const d = await pibCall('/prospect-post?id=' + encodeURIComponent(id));
  if (d.error || !d.found) { mc.innerHTML = `<div class="err">${pibEsc(d.error || 'Post not found')}</div>`; return; }
  const p = d.post, all = d.players;
  const ranked = all.filter(x => ppRank(x) != null).sort((a, b) => ppRank(a) - ppRank(b));
  const asRanking = ranked.length >= 10;                       // a ranking post: lead with the ranked table
  const rest = all.filter(x => !asRanking || ppRank(x) == null).sort((a, b) => (b.buy ?? -1) - (a.buy ?? -1) || String(a.name).localeCompare(b.name));
  ppCur = [...(asRanking ? ranked : []), ...rest];
  const split = (rows, base, mk, limit) => `${rows.slice(0, limit).map((x, k) => mk(x, base + k)).join('')}${rows.length > limit ? `<div id="po-more-${base}" style="display:none">${rows.slice(limit).map((x, k) => mk(x, base + limit + k)).join('')}</div><button class="ph-m-more" onclick="ppMore('po-more-${base}',this)">Show ${rows.length - limit} more</button>` : ''}`;
  const rankBlock = asRanking ? `<div class="srow"><div class="srow-t">Rankings</div><div class="po-rk po-rk-head"><span class="po-rk-n">#</span><span class="po-rk-name">Player</span><span class="po-rk-bs">Score</span><span class="po-rk-p">Price</span></div>${split(ranked, 0, ppRankRow, 100000)}</div>` : '';
  const restBlock = rest.length ? `<div class="srow"><div class="srow-t">${asRanking ? 'Not on the list' : 'Players, highest Buy Score first'}</div>${split(rest, asRanking ? ranked.length : 0, ppPlayerRow, 100000)}</div>` : '';
  mc.innerHTML = `
    <div class="mname">${pibEsc(p.title || 'Untitled')}</div>
    <div class="msub">${ppDate(p.published_at)} · ${pibEsc(ppType(p.post_type))} · ${all.length} players</div>
    ${!p.imported && p.summary ? `<div class="srow" style="margin-bottom:9px"><div style="font-size:14px;line-height:1.55">${pibEsc(p.summary)}</div>${p.thesis ? `<div class="po-thesis">${pibEsc(p.thesis)}</div>` : ''}</div>` : ''}
    ${rankBlock}${restBlock}
    ${p.raw_text ? `<div class="srow" style="padding:0;overflow:hidden;margin-bottom:9px">
      <button class="notes-toggle" onclick="const b=this.nextElementSibling;b.style.display=b.style.display==='none'?'block':'none';this.querySelector('.arr').textContent=b.style.display==='none'?'▼':'▲'"><span class="lbl">Original post</span><span class="arr">▼</span></button>
      <div class="notes-body" style="display:none"><p style="white-space:pre-wrap">${pibEsc(p.raw_text)}</p></div></div>` : ''}`;
}
