// Posts view: every saved post (new ones from the Inbox, plus the imported Sheet history), newest first.
// Tap one for the summary, his original text, and every player's take and numbers from that post.
let ppPosts = [], ppLoaded = false;
const ppType = t => ({ rankings: 'Rankings', hot_sheet: 'Hot Sheet', analysis: 'Analysis', price_update: 'Prices', other: 'Other' }[t] || t || '');
const ppDate = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${+m[2]}/${+m[3]}/${m[1].slice(2)}` : ''; };
const ppMoney = c => c == null ? '' : '$' + (c / 100).toFixed(c % 100 ? 2 : 0);

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
  const posts = f ? ppPosts.filter(p => p.post_type === f) : ppPosts;
  document.getElementById('cntlbl').textContent = `${posts.length} post${posts.length === 1 ? '' : 's'}`;
  listEl.innerHTML = posts.length ? posts.map(p => `
    <div class="card" style="display:block;cursor:pointer" onclick="ppOpen('${p.post_id}')">
      <div class="r1"><span class="pname">${pibEsc(p.title || 'Untitled')}</span></div>
      <div class="r2"><span>${ppDate(p.published_at)}</span><span>${pibEsc(ppType(p.post_type))}</span><span>${p.players} player${p.players === 1 ? '' : 's'}</span>${p.takes ? `<span>${p.takes} with analysis</span>` : ''}</div>
      ${p.summary && p.source !== 'prospect-master-sheet' ? `<div style="font-size:12px;color:var(--tx2);margin-top:5px;line-height:1.4">${pibEsc(p.summary)}</div>` : ''}
    </div>`).join('') : '<div class="empty-msg">No posts yet</div>';
}

async function ppOpen(id) {
  const mc = document.getElementById('mcontent');
  mc.innerHTML = '<div class="spin"><div class="spin-ring"></div>Loading…</div>';
  document.getElementById('mwrap').classList.add('on');
  const d = await pibCall('/prospect-post?id=' + encodeURIComponent(id));
  if (d.error || !d.found) { mc.innerHTML = `<div class="err">${pibEsc(d.error || 'Post not found')}</div>`; return; }
  const p = d.post;
  const players = d.players.slice().sort((a, b) => (b.take ? 1 : 0) - (a.take ? 1 : 0) || String(a.name).localeCompare(b.name));
  const row = x => {
    const ranks = Object.entries(x.ranks || {}).map(([l, r]) => `${pibEsc(l)} #${r}`).join(' · ');
    const nums = [x.price_c != null ? ppMoney(x.price_c) : '', x.expected_c != null ? 'exp ' + ppMoney(x.expected_c) : '', x.buy != null ? 'BS ' + Number(x.buy).toFixed(1) : '', x.action || '', x.level || '', x.age != null ? 'age ' + x.age : '']
      .filter(Boolean).map(pibEsc).join(' · ');
    const head = `<b>${pibEsc(x.name)}</b> <span class="intake-meta" style="margin:0">${pibEsc(x.team || '')}${x.dated && x.dated !== p.published_at ? ' · ' + ppDate(x.dated) : ''}</span>`;
    const meta = `${nums ? `<div class="intake-meta" style="margin:2px 0 0">${nums}</div>` : ''}${ranks ? `<div class="intake-meta" style="margin:2px 0 0">${ranks}</div>` : ''}`;
    if (!x.take) return `<div style="padding:7px 0;border-top:.5px solid var(--bdr2)">${head}${meta}</div>`;
    const kp = (x.take.key_points || []).length ? `<ul class="intake-list">${x.take.key_points.map(k => `<li>${pibEsc(k)}</li>`).join('')}</ul>` : '';
    return `<details style="padding:7px 0;border-top:.5px solid var(--bdr2)"><summary style="cursor:pointer">${head}${x.take.stance && x.take.stance !== 'none' ? ` <span class="pib-badge stance">${pibEsc(x.take.stance)}</span>` : ''}${meta}</summary>
      <div style="font-size:13px;line-height:1.5;margin-top:6px;white-space:pre-wrap">${pibEsc(x.take.summary || x.take.analysis)}</div>${kp}
      ${x.take.summary && x.take.analysis ? `<details style="margin-top:6px"><summary class="intake-meta" style="cursor:pointer">His full analysis</summary><div style="font-size:13px;line-height:1.55;margin-top:4px;white-space:pre-wrap">${pibEsc(x.take.analysis)}</div></details>` : ''}</details>`;
  };
  mc.innerHTML = `
    <div class="mname">${pibEsc(p.title || 'Untitled')}</div>
    <div class="msub">${ppDate(p.published_at)} · ${pibEsc(ppType(p.post_type))} · ${d.players.length} players</div>
    ${p.imported ? '' : (p.summary ? `<div class="srow" style="margin-bottom:9px"><div style="font-size:13px;line-height:1.5">${pibEsc(p.summary)}</div>${p.thesis ? `<div class="intake-meta" style="margin-top:6px">${pibEsc(p.thesis)}</div>` : ''}</div>` : '')}
    ${p.raw_text ? `<div class="srow" style="padding:0;overflow:hidden;margin-bottom:9px">
      <button class="notes-toggle" onclick="const b=this.nextElementSibling;b.style.display=b.style.display==='none'?'block':'none';this.querySelector('.arr').textContent=b.style.display==='none'?'▼':'▲'"><span class="lbl">Original post</span><span class="arr">▼</span></button>
      <div class="notes-body" style="display:none"><p style="white-space:pre-wrap">${pibEsc(p.raw_text)}</p></div></div>` : ''}
    <div class="srow">${players.map(row).join('') || '<div class="intake-empty">No player data</div>'}</div>`;
}
