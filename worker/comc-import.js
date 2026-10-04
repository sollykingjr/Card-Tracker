// ── comc-import.js — COMC PurchaseHistory / SalesHistory CSV → cards ──────────
// Mirrors the old Power Query parsing, but splits on " - " so hyphenated names survive.

// Minimal RFC-4180 CSV parser (quoted fields, embedded commas/quotes)
export function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(f); f = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else f += c;
  }
  row.push(f); if (row.some(x => x !== '')) rows.push(row);
  const header = (rows.shift() || []).map(h => h.trim());
  return rows.map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

// "2013 Topps Inception - Elements Autographs - Purple" → { year, set_name, variation }
export function parseComcSetName(v) {
  const s = String(v || '').replace(/\s*-\s*\[Base\]/gi, '').trim();
  const sp = s.indexOf(' ');
  if (sp < 0) return { year: s || null, set_name: null, variation: null };
  const year = s.slice(0, sp), rest = s.slice(sp + 1);
  const cut = rest.indexOf(' - ');
  return cut < 0 ? { year, set_name: rest.trim() || null, variation: null }
    : { year, set_name: rest.slice(0, cut).trim() || null, variation: rest.slice(cut + 3).trim() || null };
}

// "SP - Image Variation - Thierry Henry (Alt Art)" → { version: 'SP - Image Variation Alt Art', player_name: 'Thierry Henry' }
export function parseComcDescription(v) {
  const parts = String(v || '').split(' - ').map(x => x.trim()).filter(Boolean);
  let player = parts.pop() || null;
  const versionParts = parts;
  const pm = player && player.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (pm) { player = pm[1].trim(); versionParts.push(pm[2].trim()); }
  return { version: versionParts.join(' ').trim() || null, player_name: player || null };
}

// "5/6/2026 11:30:07 AM" → "2026-05-06 11:30"
export function comcDate(v) {
  const m = String(v || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?/i);
  if (!m) return null;
  let h = m[4] ? parseInt(m[4], 10) : null;
  if (h != null && m[6]) { if (/pm/i.test(m[6]) && h < 12) h += 12; if (/am/i.test(m[6]) && h === 12) h = 0; }
  const d = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return h == null ? d : `${d} ${String(h).padStart(2, '0')}:${m[5]}`;
}

export const toCentsStr = v => { const n = parseFloat(String(v || '').replace(/[$,]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : null; };

export function comcCard(r) {
  const set = parseComcSetName(r['Set Name']), desc = parseComcDescription(r['Description']);
  const serial = r['Serial No'] && r['Serial No'] !== '0' ? r['Serial No'] : null;
  return {
    item_id: String(r['ItemID'] || '').trim(), sport: r['Sport'] || null, ...set, ...desc,
    card_no: r['Card No'] || null, serial_no: serial, qty_manufactured: r['Qty Manufactured'] || null
  };
}
