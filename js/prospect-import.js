// One-time import of the old Prospect Master Sheet into the prospect tables (see worker importSnapshot).
// Shows what it will write first; nothing is saved until Import is pressed. Safe to run again: finished snapshots are skipped.
let pibImp = { data: null, msg: '', busy: false };
const pibImpN = n => Number(n).toLocaleString('en-US');

function pibImpDraw() {
  const el = document.getElementById('pib-imp');
  if (!el) return;
  const d = pibImp.data;
  let sum = '';
  if (d) {
    const names = new Set(), c = { players: 0, notes: 0, ranks: 0, prices: 0, buy: 0 };
    for (const sn of d.snapshots) for (const p of sn.players) {
      names.add(pibImpNorm(p.name)); c.players++; if (p.note) c.notes++; c.ranks += (p.rankings || []).length;
      if (p.price != null || p.expected != null) c.prices++; if (p.buy_rating != null) c.buy++;
    }
    sum = `<div class="intake-meta">${d.snapshots.length} dated snapshots · ${pibImpN(c.players)} player rows · about ${pibImpN(names.size)} players · ${pibImpN(c.prices)} price points · ${pibImpN(c.ranks)} rankings · ${pibImpN(c.buy)} buy ratings · ${pibImpN(c.notes)} of his notes.<br>
      Adds new rows only. Existing players are matched by name; card data is not touched.</div>`;
  }
  el.innerHTML = `
    <div class="intake-card">
      <div class="srow-t">Import old Sheet history</div>
      <div class="intake-meta">One-time load of the Prospect Master Sheet (prices, rankings, buy ratings, age, level, his notes).</div>
      ${sum}
      <div class="intake-row">
        ${d ? `<button class="intake-btn primary" ${pibImp.busy ? 'disabled' : ''} onclick="pibImpRun()">${pibImp.busy ? 'Importing…' : 'Import'}</button>`
            : `<button class="intake-btn" ${pibImp.busy ? 'disabled' : ''} onclick="pibImpLoad()">Preview what will be imported</button>`}
      </div>
      <div class="intake-err" id="pib-imp-msg">${pibEsc(pibImp.msg)}</div>
    </div>`;
}
const pibImpNorm = n => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.'’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+(jr|sr|ii|iii|iv)$/, '').trim();

async function pibImpLoad() {
  pibImp.msg = 'Loading file…'; pibImpDraw();
  try {
    const r = await fetch('data/prospect-import.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('import file not found (' + r.status + ')');
    pibImp.data = await r.json(); pibImp.msg = '';
  } catch (e) { pibImp.msg = e.message; }
  pibImpDraw();
}

async function pibImpRun() {
  const snaps = pibImp.data.snapshots;
  pibImp.busy = true; pibImpDraw();
  const msg = t => { const m = document.getElementById('pib-imp-msg'); if (m) { m.style.color = 'var(--tx2)'; m.textContent = t; } };
  const tot = { prospects: 0, new_prospects: 0, takes: 0, rankings: 0, prices: 0, snapshots: 0 };
  let skipped = 0;
  try {
    for (let i = 0; i < snaps.length; i++) {
      const sn = snaps[i], key = sn.tab + ':' + sn.date;
      msg(`Importing ${i + 1} of ${snaps.length}: ${sn.title}`);
      const st = await pibCall('/prospect-import', { action: 'start', key, title: sn.title, post_type: sn.post_type, date: sn.date });
      if (st.error) throw new Error(st.error);
      if (st.skip) { skipped++; continue; }
      for (let j = 0; j < sn.players.length; j += 40) {
        const d = await pibCall('/prospect-import', { action: 'rows', key, players: sn.players.slice(j, j + 40) });
        if (d.error) throw new Error(d.error);
        for (const k in tot) tot[k] += d.counts[k] || 0;
      }
      const f = await pibCall('/prospect-import', { action: 'finish', key, players: sn.players.length });
      if (f.error) throw new Error(f.error);
    }
    pibImp.msg = `Done. Added ${pibImpN(tot.new_prospects)} new players, ${pibImpN(tot.prices)} prices, ${pibImpN(tot.rankings)} rankings, ${pibImpN(tot.takes)} notes, ${pibImpN(tot.snapshots)} rating/age/level rows.${skipped ? ` ${skipped} snapshots were already imported and skipped.` : ''}`;
  } catch (e) {
    pibImp.msg = 'Stopped: ' + e.message + '. Press Import again to continue; finished snapshots are skipped.';
  }
  pibImp.busy = false; pibImpDraw();
  const m = document.getElementById('pib-imp-msg'); if (m && pibImp.msg.startsWith('Done')) m.style.color = 'var(--grn, #2e7d32)';
}
