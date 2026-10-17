// Player modal: score first, then price, expected value, your cards, his notes and history. Reads /prospect (history) and the current-state row.
let phHot = null;   // {id: [times, straight, lastDate]} from /prospect-hotsheet, loaded once
let phModal = null; // state for the open modal (id, detail) so the Graduated toggle can redraw it

const phTime = d => new Date(d + 'T12:00:00Z').getTime();

// Small line chart (SVG) of [date, value] points, oldest first.
function phSpark(points, fmt, title) {
  if (points.length < 2) return `<div class="srow ph-m-chart"><div class="srow-t">${title}</div><div class="intake-meta" style="margin:4px 0 0">Not enough history yet</div></div>`;
  const W = 300, H = 72, P = 8, t0 = phTime(points[0][0]), t1 = phTime(points[points.length - 1][0]) || t0 + 1;
  const vs = points.map(p => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const xy = points.map(([d, v]) => [P + (phTime(d) - t0) / ((t1 - t0) || 1) * (W - 2 * P), H - P - (v - lo) / span * (H - 2 * P)]);
  const last = xy[xy.length - 1];
  return `<div class="srow ph-m-chart"><div class="srow-t">${title}</div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${title}"><polyline points="${xy.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="var(--acc)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.5" fill="var(--acc)"/></svg>
    <div class="ph-m-axis"><span>${phDate(points[0][0])} · ${fmt(points[0][1])}</span><span>${phDate(points[points.length - 1][0])} · ${fmt(points[points.length - 1][1])}</span></div></div>`;
}

function phNoteHtml(t) {
  const text = t.summary || t.analysis;
  if (!text) return '';
  const stance = t.stance && t.stance !== 'none' ? ` <span class="pib-badge stance">${pibEsc(t.stance)}</span>` : '';
  return `<div class="ph-m-note"><div class="ph-m-notehead"><span>${phDate(t.dated)}</span><span>${pibEsc(t.title || '')}</span>${stance}</div>
    <div class="ph-m-notetext">${pibEsc(text)}</div>
    ${t.summary && t.analysis ? `<details><summary>His full analysis</summary><div class="ph-m-notetext">${pibEsc(t.analysis)}</div></details>` : ''}</div>`;
}

function phModalHtml(name, row, m, owned, hot) {
  const snaps = (m ? m.snapshots : []).slice();            // newest first
  const scored = snaps.filter(s => s.buy_rating != null);
  const prevScore = scored.length > 1 ? scored.find(s => s.dated < scored[0].dated) : null;
  const prices = (m ? m.prices : []).slice().reverse();    // oldest first
  const hist = prices.map(p => [p.dated, p.base_auto_cents]);
  const bs = row && row.buy_rating != null ? Number(row.buy_rating) : null;
  const grad = row && row.graduated;
  const o = owned.get(normName(name));
  const side = row && row.side ? (row.side === 'pitcher' ? 'Pitcher' : 'Hitter') : '';
  const sub = [side, row && row.team, row && row.age != null ? 'age ' + row.age : '', row && row.level, row && row.rank != null ? `#${row.rank} (${phDate(row.rank_dated)})` : ''].filter(Boolean).map(pibEsc).join(' · ');
  const tiles = `<div class="sgrid" style="margin-bottom:9px">
      <div class="scard"><div class="slbl">Buy Score</div><div class="sval ph-t-${phTone(bs)}">${bs != null ? phBs(bs) : '—'}</div>
        <div class="ph-m-tilesub">${bs != null ? pibEsc([row.action, phDate(row.scored_dated)].filter(Boolean).join(' · ')) : 'not scored'}${prevScore ? `<br>was ${phBs(prevScore.buy_rating)} (${phDate(prevScore.dated)})` : ''}</div></div>
      <div class="scard"><div class="slbl">Price</div><div class="sval">${row && row.price_cents != null ? phMoney(row.price_cents) : '—'}</div>
        <div class="ph-m-tilesub">${row && row.price_dated ? 'base auto, ' + phDate(row.price_dated) : ''}</div></div>
      <div class="scard"><div class="slbl">Expected Value</div><div class="sval">${row && row.expected_cents != null ? phMoney(row.expected_cents) : '—'}</div>
        <div class="ph-m-tilesub">${row && row.expected_cents != null ? (row.price_at_score_cents != null ? 'price then ' + phMoney(row.price_at_score_cents) : 'with the score') : 'none with this score'}</div></div>
    </div>`;
  const hotLine = hot ? `<div class="ph-m-hot"><b>Hot Sheet</b> ${hot[0]} time${hot[0] === 1 ? '' : 's'}${hot[1] > 1 ? ` · ${hot[1]} in a row` : ''} · last ${phDate(hot[2])}</div>` : '<div class="ph-m-hot"><b>Hot Sheet</b> not on one yet</div>';
  const e = o ? phEntryPrice(o, hist) : null, now = row ? row.price_cents : null;
  const entryLine = e && now != null && e.cents > 0 ? (() => { const pct = Math.round((now - e.cents) / e.cents * 100); return `<div class="ph-m-entry ${pct >= 0 ? 'up' : 'down'}"><b>${pct > 0 ? '+' : ''}${pct}%</b> since you bought <span>${e.approx ? '~' : ''}${phMoney(e.cents)} avg → ${phMoney(now)}</span></div>`; })() : '';
  const takes = (m ? m.takes : []).filter(t => t.summary || t.analysis);
  const keep = grad && !o ? 1 : 3;
  const noteBlock = takes.length ? `<div class="srow"><div class="srow-t">His notes${grad && !o ? ' (graduated: latest only)' : ''}</div>${takes.slice(0, keep).map(phNoteHtml).join('')}
      ${takes.length > keep ? `<div id="ph-more" style="display:none">${takes.slice(keep).map(phNoteHtml).join('')}</div><button class="ph-m-more" onclick="document.getElementById('ph-more').style.display='block';this.remove()">Show ${takes.length - keep} older note${takes.length - keep === 1 ? '' : 's'}</button>` : ''}</div>` : '';
  return `<div class="ph-m-top"><div><div class="mname">${pibEsc(name)}</div><div class="msub">${sub}</div></div>
      ${row ? `<button class="ph-m-grad${grad ? ' on' : ''}" onclick="phToggleGrad()">${grad ? 'Graduated' : 'Mark graduated'}</button>` : ''}</div>
    ${row ? tiles : '<div class="srow"><div class="intake-meta" style="margin:0">No prospect data for this player.</div></div>'}
    ${row ? hotLine : ''}
    <div id="ph-m-cards">${o ? `<div class="srow" style="margin-bottom:9px"><div class="srow-t">My cards</div>${entryLine}<div class="intake-meta" style="margin:4px 0 0">${o.n} owned · $${o.cost.toFixed(0)} invested</div></div>` : ''}</div>
    ${noteBlock}
    ${m ? phSpark(scored.slice().reverse().map(s => [s.dated, Number(s.buy_rating)]), phBs, 'Buy Score over time') + phSpark(hist, phMoney, 'Base auto price over time') : ''}`;
}

async function phShowModal(name) {
  const mc = document.getElementById('mcontent');
  mc.innerHTML = '<div class="spin"><div class="spin-ring"></div>Loading…</div>';
  document.getElementById('mwrap').classList.add('on');
  if (!phData) { phLoad(); while (phLoading) await new Promise(r => setTimeout(r, 100)); }
  const row = (phData || []).find(p => normName(p.name) === normName(name)) || null;
  const [d, h] = await Promise.all([pibCall('/prospect?name=' + encodeURIComponent(name)), phHot ? Promise.resolve(phHot) : pibCall('/prospect-hotsheet').catch(() => ({}))]);
  if (d.error) { mc.innerHTML = `<div class="err">${pibEsc(d.error)}</div>`; return; }
  if (!phHot && h && h.hot) phHot = h.hot;
  const m = d.found ? (d.matches.find(x => row && x.prospect.prospect_id === row.prospect_id) || d.matches[0]) : null;
  phModal = { name, row, m };
  phDrawModal();
}

function phDrawModal() {
  const { name, row, m } = phModal;
  const owned = phOwnedMap();
  const html = phModalHtml(name, row, m, owned, row && phHot ? phHot[row.prospect_id] : null);
  _modalMainHtml = html; _modalCurrentPlayer = name;
  document.getElementById('mcontent').innerHTML = html;
  // Card details and sold history come from the older card cache; add them once it is ready.
  if (owned.get(normName(name)) || getCardStats(name).sold.length) phWaitOld().then(() => {
    const box = document.getElementById('ph-m-cards'); if (!box || !phModal || phModal.name !== name) return;
    const more = typeof modalCards === 'function' ? modalCards(name) : '';
    if (more) { box.insertAdjacentHTML('beforeend', more); _modalMainHtml = document.getElementById('mcontent').innerHTML; }
  });
}

// His manual switch: graduated on/off. The automatic rule still applies until he flips it.
async function phToggleGrad() {
  if (!phModal || !phModal.row) return;
  const row = phModal.row, next = !row.graduated;
  const r = await pibCall('/prospect-graduate', { prospect_id: row.prospect_id, graduated: next });
  if (r.error) return;
  row.graduated = next ? 1 : 0; row.graduated_manual = next ? 1 : 0;
  phDrawModal();
  if (section === 'prospects' && tab === 'all') renderProspectHome();
}
