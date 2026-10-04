// ── parse-file-name.js — COMC-style file name → card metadata (positional, like the old Power Query)
// "2025 Topps Chrome - [Base] - Orange Lava Refractor #229 - Russell Wilson /25"
//   Year = first word · Set = up to first " - " · Variation = up to "#" · Card No = after "#" up to space
//   then: optional "Version - " segments, Player, optional "/Qty", optional "[Grade]" (either order)
const GRADERS = ['PSA', 'BGS', 'SGC', 'CGC', 'CSG', 'HGA', 'TAG', 'BVG', 'BCCG', 'ISA', 'GMA', 'KSA', 'AGS', 'Beckett'];
const GRADE_RE = new RegExp(`^(${GRADERS.join('|')})\\s+(\\d+(?:\\.\\d+)?|Authentic|AUTH|A)\\b`, 'i');

export function normalizeGrade(raw) {
  const m = (raw || '').trim().match(GRADE_RE);
  if (!m) return null;
  const company = GRADERS.find(g => g.toLowerCase() === m[1].toLowerCase());
  return `${company} ${m[2]}`;
}

export function parseFileName(input) {
  const out = { year: null, set_name: null, variation: null, card_no: null, version: null, player_name: null, qty_manufactured: null, grade: null };
  let s = String(input || '').trim().replace(/\s+/g, ' ').replace(/ [\u2012-\u2015\u2212] /g, ' - '); // em/en dashes as separators
  if (!s) return out;
  const sp = s.indexOf(' ');
  if (sp < 0) { out.year = s; return out; }
  out.year = s.slice(0, sp);
  let rest = s.slice(sp + 1);

  const setCut = rest.indexOf(' - ');
  const hashAt = rest.indexOf('#');
  if (setCut >= 0 && (hashAt < 0 || setCut < hashAt)) { out.set_name = rest.slice(0, setCut).trim(); rest = rest.slice(setCut + 3); }
  else if (hashAt >= 0) { out.set_name = rest.slice(0, hashAt).trim(); rest = rest.slice(hashAt); }
  else { out.set_name = rest.trim(); return out; }

  rest = rest.replace(/\[Base\]\s*-\s*/gi, '').replace(/\[Base\]\s*/gi, '');
  const h = rest.indexOf('#');
  if (h < 0) { out.variation = rest.replace(/[\s-]+$/, '').trim() || null; return out; }
  out.variation = rest.slice(0, h).replace(/[\s-]+$/, '').trim() || null;
  let cardPlayer = rest.slice(h + 1).trim();
  const cs = cardPlayer.indexOf(' ');
  out.card_no = (cs < 0 ? cardPlayer : cardPlayer.slice(0, cs)).trim() || null;
  let p = cs < 0 ? '' : cardPlayer.slice(cs + 1);

  // Grade: any [..] block; only real grading-company grades are kept
  const gm = p.match(/\[([^\]]*)\]/);
  if (gm) { out.grade = normalizeGrade(gm[1]); p = p.replace(gm[0], ' '); }
  // Qty manufactured: last "/number"
  const qm = p.match(/\/\s*([\d,]+)\s*$/) || p.match(/\/\s*([\d,]+)(?!.*\/)/);
  if (qm) { out.qty_manufactured = qm[1].replace(/,/g, ''); p = p.replace(qm[0], ' '); }

  p = p.trim().replace(/^-\s*/, '').replace(/\s*#$/, '').trim();
  const parts = p.split(' - ').map(x => x.trim()).filter(Boolean);
  if (parts.length > 1) { out.player_name = parts.pop(); out.version = parts.join(' - '); }
  else out.player_name = parts[0] || null;
  return out;
}
