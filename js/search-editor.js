// ── search-editor.js — edit a search before opening Card Ladder / COMC / eBay ──
// Shared by the card modal (Search Options tiles) and the watchlist (Search Options).
// Shows the text as tappable chips (player name = one chip), an editable field,
// a rules-based "Suggested" cleanup, and remembers the last search per card/item.

const SE_PLATFORMS = {
  cardladder: 'Card Ladder',
  comc: 'COMC',
  ebay: 'eBay',
};

// Words/phrases that rarely help a search. Matched case-insensitively as whole words.
const SE_DROP_PHRASES = [
  // Panini Select tiers
  'Field Level', 'Suite Level', 'Club Level', 'Premier Level', 'Concourse',
  // Listing filler (mostly eBay titles)
  'Gem Mint', 'Case Hit', 'Pack Fresh', 'Free Shipping', 'Must See', 'Look', 'L@@K', 'Hot', 'Invest',
  'Investment', 'Rare', 'SSP', 'Mint', 'NM-MT', 'NM', 'Sharp', 'Nice', 'Centered', 'Beautiful',
  'Stunning', 'Wow', 'Read',
];

const SE_REPLACE = [
  [/\bautograph(s|ed)?\b/gi, 'Auto'],
  [/\bautos\b/gi, 'Auto'],
];

function seEscapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Rules-based cleanup used by the "Suggested" button.
function seSuggest(text) {
  let t = ' ' + String(text || '') + ' ';
  // Emojis and decorative symbols
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{FE0F}]/gu, ' ');
  t = t.replace(/[!*~]+/g, ' ');
  for (const [re, rep] of SE_REPLACE) t = t.replace(re, rep);
  for (const p of SE_DROP_PHRASES) {
    t = t.replace(new RegExp(`(^|\\s)${seEscapeRegex(p)}(?=\\s|$)`, 'gi'), ' ');
  }
  t = t.replace(/\s+/g, ' ').trim();
  // "Auto Auto" after replacements → one
  t = t.replace(/\b(Auto)(\s+Auto)+\b/gi, 'Auto');
  return t;
}

// Finds a player name inside the text so it can be one chip.
function seFindPlayer(text, hint) {
  const lower = String(text || '').toLowerCase();
  const candidates = [];
  if (hint) candidates.push(hint);
  if (typeof cards !== 'undefined' && Array.isArray(cards)) {
    for (const c of cards) if (c && c.playerDisplay) candidates.push(c.playerDisplay);
  }
  const uniq = [...new Set(candidates.map(s => s.trim()).filter(s => s.includes(' ')))];
  uniq.sort((a, b) => b.length - a.length);
  return uniq.find(n => lower.includes(n.toLowerCase())) || '';
}

// Splits text into chips, keeping the player name together.
function seTokenize(text, player) {
  const t = String(text || '').trim();
  if (!t) return [];
  if (player) {
    const i = t.toLowerCase().indexOf(player.toLowerCase());
    if (i !== -1) {
      const before = t.slice(0, i), match = t.slice(i, i + player.length), after = t.slice(i + player.length);
      return [...seTokenize(before, ''), match, ...seTokenize(after, '')];
    }
  }
  return t.split(/\s+/).filter(Boolean);
}

let seState = null; // { platform, full, player, key }

function seStorageGet(key) {
  try { return localStorage.getItem('searchq:' + key) || ''; } catch (e) { return ''; }
}
function seStorageSet(key, val) {
  try { localStorage.setItem('searchq:' + key, val); } catch (e) {}
}

// Opens the editor. opts: { platform, text, key, playerHint }
// Title mode (listing form): { text, startText, onApply, heading, applyLabel, fullLabel, maxLen }
function openSearchEditor(opts) {
  const full = String(opts.text || '').trim();
  const onApply = typeof opts.onApply === 'function' ? opts.onApply : null;
  if (!full || (!onApply && !SE_PLATFORMS[opts.platform])) return;
  const player = seFindPlayer(full, opts.playerHint);
  seState = { platform: opts.platform, full, player, key: opts.key || '', onApply, maxLen: opts.maxLen || 0 };
  const start = (opts.startText && String(opts.startText).trim()) || (seState.key && seStorageGet(seState.key)) || full;
  const heading = opts.heading || `Search ${SE_PLATFORMS[opts.platform]}`;
  const applyLabel = opts.applyLabel || `Search ${SE_PLATFORMS[opts.platform]}`;
  const fullLabel = opts.fullLabel || 'Full name';

  document.getElementById('search-editor')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'search-editor';
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1100;display:flex;align-items:flex-end;justify-content:center';
  const btn2 = 'flex:1;height:38px;border:1px solid var(--bdr2);border-radius:10px;background:var(--surf2);color:var(--tx2);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit';
  wrap.innerHTML = `
    <div style="background:var(--bg2);width:100%;max-width:600px;max-height:88vh;overflow-y:auto;border-radius:20px 20px 0 0;padding:18px 18px 28px;border:1px solid var(--bdr2);border-bottom:none;box-sizing:border-box">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:16px;font-weight:700;color:var(--tx)">${heading}</div>
        <button onclick="closeSearchEditor()" style="background:none;border:none;color:var(--tx3);font-size:22px;line-height:1;cursor:pointer;padding:0 4px">×</button>
      </div>
      <div style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Tap to remove</div>
      <div id="se-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px"></div>
      <textarea id="se-text" rows="2" oninput="seRenderChips()" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--bdr2);border-radius:10px;background:var(--surf2);color:var(--tx);font-size:16px;font-family:inherit;resize:vertical"></textarea>
      ${seState.maxLen ? '<div id="se-count" style="font-size:12px;color:var(--tx3);margin-top:4px;text-align:right"></div>' : ''}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button onclick="seApply('suggested')" style="${btn2}">Suggested</button>
        <button onclick="seApply('full')" style="${btn2}">${fullLabel}</button>
      </div>
      <button onclick="seGo()" style="width:100%;height:46px;border:none;border-radius:10px;background:var(--acc);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:10px">${applyLabel}</button>
    </div>`;
  wrap.addEventListener('click', e => { if (e.target === wrap) closeSearchEditor(); });
  document.body.appendChild(wrap);
  document.getElementById('se-text').value = start;
  seRenderChips();
}

function closeSearchEditor() {
  document.getElementById('search-editor')?.remove();
  seState = null;
}

function seRenderChips() {
  const box = document.getElementById('se-chips');
  const input = document.getElementById('se-text');
  if (!box || !input || !seState) return;
  const tokens = seTokenize(input.value, seState.player);
  const count = document.getElementById('se-count');
  if (count && seState.maxLen) {
    const n = input.value.replace(/\s+/g, ' ').trim().length;
    count.textContent = `${n}/${seState.maxLen} characters`;
    count.style.color = n > seState.maxLen ? 'var(--dn)' : 'var(--tx3)';
  }
  box.innerHTML = '';
  tokens.forEach((tok, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.textContent = tok;
    const isPlayer = seState.player && tok.toLowerCase() === seState.player.toLowerCase();
    chip.style.cssText = `padding:6px 10px;border-radius:16px;border:1px solid ${isPlayer ? 'var(--acc-bdr)' : 'var(--bdr2)'};background:${isPlayer ? 'var(--acc-bg)' : 'var(--surf2)'};color:${isPlayer ? 'var(--acc)' : 'var(--tx)'};font-size:13px;font-weight:600;cursor:pointer;font-family:inherit`;
    chip.onclick = () => {
      const next = seTokenize(input.value, seState.player);
      next.splice(i, 1);
      input.value = next.join(' ');
      seRenderChips();
    };
    box.appendChild(chip);
  });
  if (!tokens.length) box.innerHTML = '<div style="font-size:13px;color:var(--tx3)">Nothing left — tap Full name to start over</div>';
}

function seApply(which) {
  const input = document.getElementById('se-text');
  if (!input || !seState) return;
  input.value = which === 'suggested' ? seSuggest(seState.full) : seState.full;
  seRenderChips();
}

function seGo() {
  const input = document.getElementById('se-text');
  if (!input || !seState) return;
  const q = input.value.replace(/\s+/g, ' ').trim();
  if (!q) return;
  if (seState.onApply) { const fn = seState.onApply; closeSearchEditor(); fn(q); return; }
  const { platform, key } = seState;
  if (key) seStorageSet(key, q);
  // Copy and open inside the same tap (opening after an await gets blocked on iOS).
  if (navigator.clipboard) navigator.clipboard.writeText(q).catch(() => {});
  const url = searchUrl[platform](q);
  closeSearchEditor();
  if (platform === 'ebay') {
    // On the iPhone Home Screen app a plain new-tab link hands off to the eBay app; elsewhere reuse one eBay tab.
    const w = window.open(url, ctIsIOSHomeScreenApp() ? '_blank' : 'ebay-search');
    if (w) { try { w.focus(); } catch (e) {} }
  } else {
    ctOpenExternal(url, platform + '-search');
  }
}
