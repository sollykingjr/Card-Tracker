// ── prospects.js — prospect-analytics posts: paste/email in → Claude extracts → review → D1.
// Nothing is written to the prospect tables until a post is confirmed. The full original text is always kept.
const DEFAULT_MODEL = 'claude-haiku-5-5';   // one setting: switch to 'claude-sonnet-5-5' (env PROSPECT_MODEL) if screenshots misread
const MAX_TEXT = 120000;

// USD per million tokens (platform.claude.com pricing, checked 2026-10-15). tokens x $/MTok = micro-dollars.
// Haiku 5.5 charges more when the whole prompt is over 100K tokens; Sonnet 5.5 is flat. Unknown model: no dollar estimate.
const RATES = {
  'claude-haiku-5-5': { inp: 0.10, out: 0.50, longInp: 0.50, longOut: 2.50, threshold: 100000 },
  'claude-sonnet-5-5': { inp: 2, out: 10 }
};
export function costMicros(model, usage) {
  const r = RATES[model];
  if (!r || !usage) return null;
  const long = r.threshold && usage.input_tokens > r.threshold;
  return Math.round(usage.input_tokens * (long ? r.longInp : r.inp) + usage.output_tokens * (long ? r.longOut : r.out));
}

const POST_TYPES = ['analysis', 'rankings', 'hot_sheet', 'price_update', 'other'];
const STANCES = ['buy', 'hold', 'sell', 'watch', 'avoid', 'none'];

// ── Extraction contract (the shape every post is mapped onto, whatever columns he used that day) ──
const EXTRACT_TOOL = {
  name: 'record_post',
  description: 'Record the structured contents of one prospect-analytics post.',
  input_schema: {
    type: 'object',
    required: ['post_type', 'summary', 'players'],
    properties: {
      title: { type: 'string' },
      post_type: { type: 'string', enum: POST_TYPES },
      published_date: { type: 'string', description: 'YYYY-MM-DD if the post states a date, else omit' },
      summary: { type: 'string', description: '2-4 sentences: what the post is about and its main conclusions' },
      thesis: { type: 'string', description: 'The overall argument or strategy, if there is one' },
      players: {
        type: 'array',
        description: 'Every prospect the post gives data or an opinion on. One entry per player.',
        items: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            team: { type: 'string', description: 'Team abbreviation as written, e.g. WAS' },
            side: { type: 'string', enum: ['hitter', 'pitcher'] },
            age: { type: 'number' },
            level: { type: 'string', description: "Minor-league level if given, e.g. 'A', 'A+', 'AA', 'AAA', 'AFL', 'Complex'" },
            buy_rating: { type: 'number', description: "His Buy Rating / Buy Score for this player (about 1.0-5.0), if the post gives one" },
            action: { type: 'string', description: "His action label next to the rating, exactly as written, e.g. 'Strongest Buy', 'Lean Buy', 'Spot On', 'Slightly Overvalued'" },
            post_rank:{ type: 'integer', description: "Position in this post's numbered list, if the post numbers its list" },
            rankings: {
              type: 'array',
              description: "Every ranking this player has in the post: his own list (the Rank column, e.g. 'top 100 pitchers' rank 7, 'hobby rank' 53) and any third-party rank columns, each as its own list named as the column is (e.g. 'MLB', 'DD', 'Roto', 'StS', 'BA').",
              items: { type: 'object', required: ['list', 'rank'], properties: { list: { type: 'string' }, rank: { type: 'integer' } } }
            },
            prices: {
              type: 'array',
              description: 'Base autograph prices in dollars, each with the date it applies to. A table with two price columns (e.g. 10/12 and 10/3) is two entries. A row with only an Expected value (no auto price yet) is one entry with just expected.',
              items: {
                type: 'object', required: ['date'],
                properties: {
                  date: { type: 'string', description: 'YYYY-MM-DD. Infer the year from the post date.' },
                  base_auto: { type: 'number' },
                  expected: { type: 'number', description: "His 'expected' value for the base auto, if given" }
                }
              }
            },
            take: {
              type: 'object',
              description: "His opinion of this player. Only fill when the post actually says something about the player beyond listing numbers.",
              required: ['stance', 'summary'],
              properties: {
                stance: { type: 'string', enum: STANCES },
                summary: { type: 'string', description: '1-3 sentences in your own words: what he thinks and why' },
                analysis: { type: 'string', description: "His full written analysis of this player copied WORD FOR WORD from the post: every paragraph about the player, in order, separated by blank lines. Do not paraphrase, shorten or fix it. Leave out the data header (throws, hobby rank, signing bonus, scouting grades, stat line) and anything about other players." },
                key_points: { type: 'array', items: { type: 'string' }, description: 'Short, specific points he cites (stats, context, risks)' }
              }
            }
          }
        }
      }
    }
  }
};

const EXTRACT_SYSTEM = `You extract structured data from posts written by a prospect/Bowman-autograph analyst for a card collector.
Rules:
- Use ONLY what the post (text and any screenshots) states. Never invent numbers, ranks, prices or opinions. Omit a field rather than guess.
- Screenshots are tables whose columns change from post to post. Read the column headers and map each value to the right field. "Rank" is his own ranking. "Base Auto"/"Price" columns are base autograph prices in dollars; a price column labelled with a date applies to that date.
- In tables, only columns whose header is a date (e.g. "10/12 Price", "10/3 Price") or says Base Auto/Price are prices. Columns named "$ Diff", "% Diff", "Change", "Gain" or similar are the difference between two prices: NEVER record them as a price. For each row, the two price entries are the dollar values under the two dated price headers, read across the same row.
- Dates: write each price date as YYYY-MM-DD, using the month and day exactly as printed in the column header (10/3 -> the 3rd, not the 2nd) and the year from the post date.
- Prices written in the text count too ("his base auto is $12", "currently around $4.21", "sitting at $30"): record each one as a price for that player. If the text gives no date for it, use the post date. If the author states a different date for a price ("was $20 in September"), use that date. Record "expected" only when the author gives an expected or fair value.
- One price entry per date per player: if a table gives a base auto and an Expected value for the same date, put both on that one entry (never a second entry with the same date).
- Prices are dollars as numbers ($1,234.50 -> 1234.5).
- Always capture these when a table has them: Age, Level, Expected (his expected value for the base auto), Buy Rating (a number around 1-5, put in buy_rating) and the Action/label beside it (put in action, exactly as written). A "-" means blank: omit the field.
- Third-party rank columns (MLB, DD, Roto, StS, BA, etc.) are rankings too: one ranking entry per column, list named as the header.
- Do NOT extract performance stats (OPS, PA, HR, wRC+, ERA, etc.) as data. Stats only appear in a take's key_points when the author cites them as part of his argument.
- The analysis matters most: for every player the author discusses, fill "take" with a short faithful summary in your own words, plus the specific points he cites. Do not copy long passages.
- Players only listed in a table (no commentary) get data but no take.
- Put each player in the list once, merging data from the text and from tables.
- Articles that use one prospect as the benchmark ("the next Andrew Fischer", "who could repeat Franklin Arias's breakout"): the benchmark player gets a take only about what the author says of him as a prospect and a card, and the players he singles out as the comp or the pick get takes about why. When a player's role is not obvious, say it at the start of his take summary ("Used as the benchmark for...", "Named as the closest comp to...").
- Only extract minor-league or draft prospects who have a card market. Skip MLB veterans and players who appear only as a comparison, and one-line mentions with no opinion attached.
- Prices: only an exact current price he states ("base autograph at $67"). Approximate or projected figures ("$200+", "around $20 this winter", "could be $150-200 next year") are NOT prices: leave them in the take, and never use them as Expected values.
- take.analysis holds only the paragraphs about that player. If one paragraph covers several players, repeat it for each of them.
- stance: ALWAYS "none" unless the post's data tables give one. It comes only from a player's Buy Rating / Action label in a table or buy list (Strong Buy, Lean Buy, Buy = "buy"; an explicit sell, avoid, hold or watch label = that word). His written analysis NEVER sets the stance, however positive or negative it sounds ("I'm cool with a buy at $5", "absolute steal", "overvalued" are all just analysis: stance "none", and describe it in the take). Never infer a stance from stats, price moves, tone or a hot/cold list.`;

// ── helpers ───────────────────────────────────────────────────────────────────
export function normName(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[.'’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/\s+(jr|sr|ii|iii|iv)$/, '').trim();
}
const slug = s => normName(s).replace(/\s+/g, '-');
const cents = v => (v == null || v === '' || !isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
const intOrNull = v => (v == null || v === '' || !isFinite(Number(v)) ? null : Math.round(Number(v)));
const isoDate = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// The post's own ranking list, named from its title ("Top 200 Hitters" -> 'top 200 hitters'), so a plain "Rank" column always lands on the right list.
const OWN_LIST_ALIASES = /^(rank|own rank|post rank|ranking|hobby|hobby rank|hitters? rank|pitchers? rank|top \d+ (hitters|pitchers))$/i;
export function ownListFromTitle(title) {
  const m = /top\s*(\d+)\s*(hitters|pitchers)/i.exec(String(title || ''));
  return m ? { list: `top ${m[1]} ${m[2].toLowerCase()}`, cap: +m[1] } : null;
}

// Clean whatever the model returned into the exact shape the confirm step writes. Drops junk, never throws on odd values.
export function sanitizeExtraction(raw, fallbackDate = null) {
  const r = raw || {};
  const date = isoDate(r.published_date) || isoDate(fallbackDate);
  const own = ownListFromTitle(r.title);
  const players = (Array.isArray(r.players) ? r.players : []).filter(p => p && String(p.name || '').trim()).map(p => {
    const take = p.take && String(p.take.summary || '').trim() ? {
      stance: STANCES.includes(p.take.stance) ? p.take.stance : 'none',
      summary: String(p.take.summary).trim(),
      analysis: p.take.analysis && String(p.take.analysis).trim() ? String(p.take.analysis).trim() : null,
      key_points: (Array.isArray(p.take.key_points) ? p.take.key_points : []).map(x => String(x).trim()).filter(Boolean).slice(0, 12)
    } : null;
    return {
      name: String(p.name).trim(),
      team: p.team ? String(p.team).trim().toUpperCase() : null,
      side: ['hitter', 'pitcher'].includes(p.side) ? p.side : null,
      age: isFinite(Number(p.age)) && p.age != null ? Number(p.age) : null,
      level: p.level ? String(p.level).trim() : null,
      buy_rating: isFinite(Number(p.buy_rating)) && p.buy_rating != null && p.buy_rating !== '' && Number(p.buy_rating) > 0 ? Number(p.buy_rating) : null,
      action: p.action && String(p.action).trim() && String(p.action).trim() !== '-' ? String(p.action).trim() : null,
      post_rank: intOrNull(p.post_rank),
      rankings: ((list) => {   // the post's own list: a plain Rank column (or the numbered position) goes under the list named in the title; ranks past the list's size are dropped
        const out = [];
        for (const x of list) {
          let name = String(x.list).trim(); const rank = intOrNull(x.rank);
          if (own && OWN_LIST_ALIASES.test(name)) { name = own.list; if (rank > own.cap) continue; }
          if (!out.some(y => y.list.toLowerCase() === name.toLowerCase() && y.rank === rank)) out.push({ list: name, rank });
        }
        const pr = intOrNull(p.post_rank);
        if (own && pr != null && pr <= own.cap && !out.some(y => y.list === own.list)) out.push({ list: own.list, rank: pr });
        return out;
      })((Array.isArray(p.rankings) ? p.rankings : []).filter(x => x && x.list && intOrNull(x.rank) != null)),
      // Accepts dollars (model output) or cents (already-cleaned output), so cleaning twice is safe.
      prices: (Array.isArray(p.prices) ? p.prices : []).map(x => x && ({
        date: x.date,
        base_auto_cents: x.base_auto_cents != null ? intOrNull(x.base_auto_cents) : cents(x.base_auto),
        expected_cents: x.expected_cents != null ? intOrNull(x.expected_cents) : cents(x.expected)
      })).filter(x => x && isoDate(x.date) && (x.base_auto_cents != null || x.expected_cents != null))
        .reduce((acc, x) => {   // one row per date: an Expected value listed separately joins that day's base auto
          const m = acc.find(y => y.date === x.date);
          if (!m) acc.push({ ...x }); else { m.base_auto_cents ??= x.base_auto_cents; m.expected_cents ??= x.expected_cents; }
          return acc;
        }, []),
      stat_lines: [],   // stat lines are deliberately not extracted or stored (saves tokens; prospect_stats table stays unused)
      take
    };
  });
  return {
    title: r.title ? String(r.title).trim() : null,
    post_type: POST_TYPES.includes(r.post_type) ? r.post_type : 'other',
    published_date: date,
    summary: String(r.summary || '').trim(),
    thesis: r.thesis ? String(r.thesis).trim() : null,
    players: dedupePlayers(players)
  };
}

// The same player listed twice in one post (the model sometimes repeats someone) becomes one entry. A real two-way player (hitter and pitcher) stays two.
function foldPlayer(m, p) {
  for (const f of ['team', 'side', 'age', 'level', 'buy_rating', 'action', 'post_rank']) m[f] ??= p[f];
  for (const r of p.rankings) if (!m.rankings.some(x => x.list.toLowerCase() === r.list.toLowerCase())) m.rankings.push(r);
  for (const pr of p.prices) {
    const same = m.prices.find(x => x.date === pr.date);
    if (!same) m.prices.push({ ...pr }); else { same.base_auto_cents ??= pr.base_auto_cents; same.expected_cents ??= pr.expected_cents; }
  }
  if (!m.take || (p.take && (p.take.analysis || p.take.summary).length > (m.take.analysis || m.take.summary).length)) m.take = p.take || m.take;
}
function dedupePlayers(players) {
  const out = [];
  for (const p of players) {
    const m = out.find(x => normName(x.name) === normName(p.name) && (!x.side || !p.side || x.side === p.side));
    if (m) foldPlayer(m, p); else out.push(p);
  }
  return out;
}

// The stance tag comes only from the data tables (buy rating / action label), never from his written analysis.
export function stanceFromTable(p) {
  const a = String(p.action || '').toLowerCase();
  if (/\b(sell|selling|trim)\b/.test(a)) return 'sell';
  if (/\bavoid\b/.test(a)) return 'avoid';
  if (/\bhold\b/.test(a)) return 'hold';
  if (/\bwatch\b/.test(a)) return 'watch';
  if (/\bbuy\b/.test(a) || (p.buy_rating != null && p.buy_rating >= 3.5)) return 'buy';
  return 'none';
}
export function applyStanceRule(ex) { for (const p of ex.players) if (p.take) p.take.stance = stanceFromTable(p); return ex; }

// ── Claude call ───────────────────────────────────────────────────────────────
// images: [{ url } | { base64, media_type }]. Returns the sanitized extraction.
const imgBlock = img => img.base64 ? { type: 'image', source: { type: 'base64', media_type: img.media_type || 'image/png', data: img.base64 } }
  : img.url ? { type: 'image', source: { type: 'url', url: img.url } } : null;

async function callClaude(env, model, content, publishedAt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model, max_tokens: 16000, system: EXTRACT_SYSTEM,
      tools: [EXTRACT_TOOL], tool_choice: { type: 'tool', name: EXTRACT_TOOL.name },
      messages: [{ role: 'user', content }]
    })
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${d.error?.message || 'error'}`);
  const block = (d.content || []).find(b => b.type === 'tool_use' && b.name === EXTRACT_TOOL.name);
  if (!block) throw new Error('Model returned no structured result');
  if (d.stop_reason === 'max_tokens') throw new Error('Extraction was cut off (post too long)');
  // Total prompt tokens include cached ones; images are billed as ordinary input tokens.
  const u = d.usage || {};
  return { extraction: sanitizeExtraction(block.input, publishedAt),
    usage: { input_tokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), output_tokens: u.output_tokens || 0 } };
}

// Folds the players found in a table-image pass into the main extraction: fills blanks, adds new rankings/prices, appends new players.
const editDistance = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
export function mergeExtractions(base, extras) {
  const byName = new Map(base.players.map(p => [normName(p.name), p]));
  for (const ex of extras) for (const p of ex.players) {
    const k = normName(p.name);
    let m = byName.get(k);
    if (!m) {   // the post text has typos the tables don't ("Velasquez" vs "Velazquez"): same player only if the first names match and the last names differ by ONE letter, with a single candidate
      const [first, ...rest] = k.split(' '), last = rest.join(' ');
      const near = last.length >= 5 ? [...byName].filter(([n]) => { const [f, ...r] = n.split(' '); return f === first && editDistance(r.join(' '), last) === 1; }) : [];
      if (near.length === 1) { m = near[0][1]; m.name = p.name; byName.set(k, m); }   // the table's spelling wins
    }
    if (!m) { const c = { ...p }; base.players.push(c); byName.set(k, c); continue; }
    foldPlayer(m, p);
  }
  return base;
}

const LONG_ARTICLE = 8000;   // characters
const TABLE_PASS_NOTE = 'TABLE-IMAGE PASS: Extract EVERY player row shown in the attached image and nothing else (skip players that appear only in the text). Include every row, even those with no price. Do not write takes or summaries for this pass; keep the summary to one short line.';

// Posts with several table screenshots (like a Top 200) are too big for one answer, so the text and each image are read separately and merged.
export async function extractWithClaude(env, { text, images = [], title = null, publishedAt = null }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set on the Worker');
  const model = env.PROSPECT_MODEL || DEFAULT_MODEL;
  const head = `${title ? `Email/post title: ${title}\n` : ''}${publishedAt ? `Post date: ${publishedAt}\n` : ''}\nPOST TEXT:\n${text}`;
  let blocks = images.slice(0, 20).map(imgBlock).filter(Boolean);
  const skippedImages = text.length >= LONG_ARTICLE && blocks.length ? blocks.length : 0;   // charts in a long prose article hold no table data worth the tokens
  if (skippedImages) blocks = [];
  let results;
  if (blocks.length < 3) {
    results = [await callClaude(env, model, [...blocks, { type: 'text', text: head }], publishedAt)];
  } else {
    const settled = await Promise.allSettled([
      callClaude(env, model, [{ type: 'text', text: head }], publishedAt),
      ...blocks.map(b => callClaude(env, model, [b, { type: 'text', text: `${TABLE_PASS_NOTE}\n\n${head}` }], publishedAt))
    ]);
    if (settled[0].status === 'rejected') throw settled[0].reason;
    const imgRes = settled.slice(1);
    if (imgRes.every(r => r.status === 'rejected')) throw imgRes[0].reason;
    results = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
    const failed = imgRes.filter(r => r.status === 'rejected').length;
    const merged = mergeExtractions(results[0].extraction, results.slice(1).map(r => r.extraction));
    if (failed) merged.summary += ` (Warning: ${failed} of ${blocks.length} table images could not be read, so some players may be missing.)`;
  }
  applyStanceRule(results[0].extraction);
  if (skippedImages) results[0].extraction.summary += ` (${skippedImages} screenshot${skippedImages === 1 ? ' was' : 's were'} not read because this is a long article.)`;
  const usage = { input_tokens: results.reduce((t, r) => t + r.usage.input_tokens, 0), output_tokens: results.reduce((t, r) => t + r.usage.output_tokens, 0) };
  usage.cost_micros = costMicros(model, usage);
  return { extraction: results[0].extraction, model, usage };
}

// ── Pending / review ──────────────────────────────────────────────────────────
// Stores the post as 'pending'. Same text again returns the existing row instead of calling the model twice.
export async function submitPost(env, { text, images = [], title = null, publishedAt = null, source = 'prospect-analytics', extractor = extractWithClaude, deps = {} }) {
  text = String(text || '').trim();
  if (text.length < 40) throw new Error('post text is empty or too short');
  if (text.length > MAX_TEXT) throw new Error('post text is too long');
  const postId = await sha256(text);
  const existing = await env.DB.prepare(`SELECT post_id, status FROM prospect_posts WHERE post_id = ?`).bind(postId).first();
  if (existing && existing.status !== 'rejected') return { postId, duplicate: true, status: existing.status };
  if (existing) await env.DB.prepare(`DELETE FROM prospect_posts WHERE post_id = ?`).bind(postId).run();   // a rejected post can be sent again
  const { extraction, model, usage = null } = await extractor(env, { text, images, title, publishedAt });
  await env.DB.prepare(`INSERT INTO prospect_posts (post_id, source, title, post_type, published_at, raw_text, image_urls, summary, thesis, extraction_json, model, input_tokens, output_tokens, cost_micros)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(postId, source, extraction.title || title, extraction.post_type, extraction.published_date,
      text, images.length ? JSON.stringify(images.map(i => i.url).filter(Boolean)) : null,
      extraction.summary, extraction.thesis, JSON.stringify(extraction), model,
      usage?.input_tokens ?? null, usage?.output_tokens ?? null, usage?.cost_micros ?? null).run();
  await notifyNewPost(env, extraction, await previewMatches(env, extraction.players || []), deps.notifyFetch);
  return { postId, duplicate: false, status: 'pending', extraction, usage };
}

// Checks run on every pending post so odd extractions are visible before he confirms. Returns [{ level, text, players }].
const BUILTIN_LISTS = ['top 200 hitters', 'top 100 pitchers', 'hobby rank', 'mlb', 'dd', 'roto', 'sts', 'ba'];
export function reviewFlags(ex, { knownLists = [], matches = [] } = {}) {
  const flags = [], players = ex.players || [];
  const add = (level, text, names = []) => flags.push({ level, text, players: [...new Set(names)] });
  const list = (names, n = 8) => names.slice(0, n).join(', ') + (names.length > n ? ` and ${names.length - n} more` : '');
  if (!players.length) { add('warn', 'No players were extracted from this post. Reject it and send it again, or check the screenshots.'); return flags; }

  // list names we have never seen before
  const known = new Set([...BUILTIN_LISTS, ...knownLists.map(x => String(x).toLowerCase())]);
  const unknown = new Map();
  for (const p of players) for (const r of p.rankings || []) if (!known.has(r.list.toLowerCase())) unknown.set(r.list, [...(unknown.get(r.list) || []), p.name]);
  for (const [l, names] of unknown) add('warn', `New rank list "${l}" (${names.length} player${names.length === 1 ? '' : 's'}). Not one of the lists on file.`, names);

  // the post's own list: ranks past its size, repeats, gaps, players with no rank
  const own = ownListFromTitle(ex.title);
  if (own) {
    const ranked = players.map(p => ({ p, r: (p.rankings || []).find(x => x.list === own.list) })).filter(x => x.r);
    const unranked = players.filter(p => !(p.rankings || []).some(x => x.list === own.list));
    const over = ranked.filter(x => x.r.rank > own.cap || x.r.rank < 1).map(x => x.p.name);
    if (over.length) add('warn', `Rank outside 1-${own.cap} on ${own.list}: ${list(over)}.`, over);
    const seen = new Map(); for (const x of ranked) seen.set(x.r.rank, [...(seen.get(x.r.rank) || []), x.p.name]);
    const dupes = [...seen].filter(([, n]) => n.length > 1);
    if (dupes.length) add('warn', `Same ${own.list} rank used twice: ${dupes.slice(0, 5).map(([r, n]) => `#${r} (${n.join(' / ')})`).join(', ')}.`, dupes.flatMap(([, n]) => n));
    if (unranked.length) add(ranked.length ? 'warn' : 'info', `${unranked.length} player${unranked.length === 1 ? ' has' : 's have'} no ${own.list} rank: ${list(unranked.map(p => p.name))}.`, unranked.map(p => p.name));
    if (ranked.length >= own.cap * 0.5) {
      const missing = []; for (let i = 1; i <= own.cap; i++) if (!seen.has(i)) missing.push(i);
      if (missing.length) add('warn', `${missing.length} rank${missing.length === 1 ? '' : 's'} missing from 1-${own.cap}: ${list(missing.map(String), 12)}.`);
    }
  }

  // possible duplicate players: same name twice, or names a letter or two apart
  const norms = players.map(p => normName(p.name)), dup = [];
  for (let i = 0; i < norms.length; i++) for (let j = i + 1; j < norms.length; j++) {
    const [fi, ...li] = norms[i].split(' '), [fj, ...lj] = norms[j].split(' ');   // same rule as the merge: first names match, last names one letter apart
    if (norms[i] === norms[j] || (fi === fj && li.join(' ').length >= 5 && editDistance(li.join(' '), lj.join(' ')) === 1)) dup.push([players[i].name, players[j].name]);
  }
  if (dup.length) add('warn', `Possible duplicate players: ${dup.slice(0, 6).map(d => d.join(' / ')).join(', ')}.`, dup.flat());

  // values that look wrong
  const odd = [];
  for (const p of players) {
    if (p.buy_rating != null && (p.buy_rating < 1 || p.buy_rating > 5)) odd.push(`${p.name} buy rating ${p.buy_rating}`);
    for (const x of p.prices || []) for (const c of [x.base_auto_cents, x.expected_cents]) if (c != null && (c <= 0 || c > 500000)) odd.push(`${p.name} price $${(c / 100).toFixed(2)}`);
    if (p.age != null && (p.age < 15 || p.age > 35)) odd.push(`${p.name} age ${p.age}`);
  }
  if (odd.length) add('warn', `Unusual values: ${list(odd)}.`, odd.map(o => o.replace(/ (buy rating|price|age) .*$/, '')));

  const fresh = matches.filter(m => m.status === 'new').length;
  if (fresh >= 10) add('info', `${fresh} players are new (not on file yet).`);
  const ambiguous = matches.filter(m => m.status === 'ambiguous').map(m => m.name);
  if (ambiguous.length) add('warn', `Name matches several players on file: ${list(ambiguous)}.`, ambiguous);
  return flags;
}

const knownListNames = async env => ((await env.DB.prepare(`SELECT DISTINCT lower(list_name) l FROM prospect_rankings`).all()).results || []).map(x => x.l);

// Pushover alert when a post lands in the Inbox. Silent no-op unless PUSHOVER_TOKEN and PUSHOVER_USER are set; never blocks or fails the post.
export async function notifyNewPost(env, extraction, matches = [], doFetch = fetch) {
  if (!env.PUSHOVER_TOKEN || !env.PUSHOVER_USER) return false;
  try {
    const players = extraction.players || [], withNotes = players.filter(p => p.take).length;
    const warns = reviewFlags(extraction, { knownLists: await knownListNames(env), matches }).filter(f => f.level === 'warn').length;
    const message = `${players.length} player${players.length === 1 ? '' : 's'} · ${withNotes} with analysis${warns ? ` · ${warns} thing${warns === 1 ? '' : 's'} to check` : ' · checks passed'}`;
    const res = await doFetch('https://api.pushover.net/1/messages.json', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ token: env.PUSHOVER_TOKEN, user: env.PUSHOVER_USER, title: `New prospect post: ${extraction.title || 'Untitled'}`.slice(0, 250), message,
        url: env.APP_URL || 'https://sollykingjr.github.io/Card-Tracker/', url_title: 'Review in Card Tracker' })
    });
    return res.ok;
  } catch { return false; }
}

export async function listPendingPosts(env) {
  const { results } = await env.DB.prepare(`SELECT post_id, title, post_type, published_at, summary, extraction_json, created_at, model, input_tokens, output_tokens, cost_micros
    FROM prospect_posts WHERE status = 'pending' ORDER BY created_at`).all();
  const knownLists = await knownListNames(env);
  return { pending: results.length, posts: await Promise.all(results.map(async r => {
    const extraction = sanitizeExtraction(JSON.parse(r.extraction_json || '{}'), r.published_at);   // re-clean on read so fixes also apply to cards already waiting
    const { input_tokens, output_tokens, cost_micros, ...rest } = r;
    const matches = await previewMatches(env, extraction.players || []);
    return { ...rest, extraction_json: undefined, extraction, usage: input_tokens == null ? null : { input_tokens, output_tokens, cost_micros },
      matches, flags: reviewFlags(extraction, { knownLists, matches }) };
  })) };
}

// Running total of what extraction has cost: this calendar month (UTC) and all time.
export async function usageSummary(env) {
  const row = async where => env.DB.prepare(`SELECT COUNT(*) posts, COALESCE(SUM(input_tokens),0) input_tokens, COALESCE(SUM(output_tokens),0) output_tokens, COALESCE(SUM(cost_micros),0) cost_micros
    FROM prospect_posts WHERE input_tokens IS NOT NULL ${where}`).first();
  return { month: await row(`AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`), all_time: await row('') };
}

// For each extracted player: which existing prospect it matches (so the review screen can flag new/ambiguous ones).
async function previewMatches(env, players) {
  return Promise.all(players.map(async p => {
    const { results } = await env.DB.prepare(`SELECT prospect_id, name, org FROM prospects WHERE norm_name = ?`).bind(normName(p.name)).all();
    const pick = results.length > 1 && p.team ? results.filter(r => r.org === p.team) : results;
    return { name: p.name, status: pick.length === 1 ? 'existing' : pick.length === 0 ? 'new' : 'ambiguous', prospect_id: pick.length === 1 ? pick[0].prospect_id : null };
  }));
}

async function resolveProspect(env, p) {
  const norm = normName(p.name);
  const { results } = await env.DB.prepare(`SELECT prospect_id, org FROM prospects WHERE norm_name = ?`).bind(norm).all();
  let hit = null;
  if (results.length === 1) hit = results[0];
  else if (results.length > 1) hit = results.find(r => r.org === p.team) || null;
  if (hit) {
    await env.DB.prepare(`UPDATE prospects SET org = COALESCE(?, org), side = COALESCE(side, ?), updated_at = datetime('now') WHERE prospect_id = ?`)
      .bind(p.team, p.side, hit.prospect_id).run();
    return hit.prospect_id;
  }
  const base = slug(p.name) || 'player';
  let id = base, n = 1;
  while (await env.DB.prepare(`SELECT 1 FROM prospects WHERE prospect_id = ?`).bind(id).first()) id = `${base}-${++n}`;
  await env.DB.prepare(`INSERT INTO prospects (prospect_id, name, norm_name, org, side) VALUES (?,?,?,?,?)`).bind(id, p.name, norm, p.team, p.side).run();
  return id;
}

// Writes a pending post's data into the prospect tables. `edited` (optional) is the review screen's corrected extraction.
export async function confirmPost(env, postId, edited = null) {
  const post = await env.DB.prepare(`SELECT * FROM prospect_posts WHERE post_id = ?`).bind(postId).first();
  if (!post) throw new Error('post not found');
  if (post.status !== 'pending') throw new Error(`post is already ${post.status}`);
  const ex = sanitizeExtraction(edited || JSON.parse(post.extraction_json || '{}'), post.published_at);
  const dated = ex.published_date || post.published_at || null;
  const counts = { prospects: 0, takes: 0, rankings: 0, prices: 0, stats: 0, snapshots: 0 };
  const stmts = [];
  const prep = (sql, ...binds) => env.DB.prepare(sql).bind(...binds);
  for (const p of ex.players) {
    const pid = await resolveProspect(env, p);
    counts.prospects++;
    if (p.take) { stmts.push(prep(`INSERT INTO prospect_takes (post_id, prospect_id, stance, summary, analysis, key_points, post_rank, dated) VALUES (?,?,?,?,?,?,?,?)`,
      postId, pid, p.take.stance, p.take.summary, p.take.analysis, JSON.stringify(p.take.key_points), p.post_rank, dated)); counts.takes++; }
    for (const r of p.rankings) { stmts.push(prep(`INSERT INTO prospect_rankings (post_id, prospect_id, list_name, rank, dated) VALUES (?,?,?,?,?)`,
      postId, pid, r.list, r.rank, dated)); counts.rankings++; }
    for (const x of p.prices) { stmts.push(prep(`INSERT INTO prospect_prices (post_id, prospect_id, dated, base_auto_cents, expected_cents) VALUES (?,?,?,?,?)`,
      postId, pid, x.date, x.base_auto_cents, x.expected_cents)); counts.prices++; }
    if (p.age != null || p.level || p.buy_rating != null || p.action) {
      stmts.push(prep(`INSERT INTO prospect_snapshots (post_id, prospect_id, dated, team, age, level, buy_rating, action) VALUES (?,?,?,?,?,?,?,?)`,
        postId, pid, dated, p.team, p.age, p.level, p.buy_rating, p.action)); counts.snapshots++; }
    for (const s of p.stat_lines) { stmts.push(prep(`INSERT INTO prospect_stats (post_id, prospect_id, dated, context, level, age, stats_json) VALUES (?,?,?,?,?,?,?)`,
      postId, pid, dated, s.context, s.level, p.age, JSON.stringify(s.stats))); counts.stats++; }
  }
  stmts.push(prep(`UPDATE prospect_posts SET status = 'confirmed', confirmed_at = datetime('now'), summary = ?, thesis = ?, post_type = ?, extraction_json = ? WHERE post_id = ?`,
    ex.summary, ex.thesis, ex.post_type, JSON.stringify(ex), postId));
  if (stmts.length) await env.DB.batch(stmts);   // all rows for the post land together or not at all
  return { confirmed: true, postId, counts };
}

export async function rejectPost(env, postId) {
  const r = await env.DB.prepare(`UPDATE prospect_posts SET status = 'rejected' WHERE post_id = ? AND status = 'pending'`).bind(postId).run();
  return { rejected: (r.meta?.changes ?? 0) > 0 };
}

// Everything he's said and every number on one player, newest first.
export async function prospectDetail(env, name) {
  const { results: found } = await env.DB.prepare(`SELECT * FROM prospects WHERE norm_name = ?`).bind(normName(name)).all();
  if (!found.length) return { found: false };
  const out = [];
  for (const pr of found) {
    const id = pr.prospect_id;
    const q = sql => env.DB.prepare(sql).bind(id).all().then(r => r.results);
    out.push({
      prospect: pr,
      takes: (await q(`SELECT t.dated, t.stance, t.summary, t.analysis, t.key_points, t.post_rank, p.title, p.post_id FROM prospect_takes t JOIN prospect_posts p USING (post_id) WHERE t.prospect_id = ? ORDER BY t.dated DESC, t.id DESC`))
        .map(t => ({ ...t, key_points: JSON.parse(t.key_points || '[]') })),
      rankings: await q(`SELECT dated, list_name, rank FROM prospect_rankings WHERE prospect_id = ? ORDER BY dated DESC`),
      prices: await q(`SELECT dated, base_auto_cents, expected_cents FROM prospect_prices WHERE prospect_id = ? ORDER BY dated DESC`),
      snapshots: await q(`SELECT dated, team, age, level, buy_rating, action FROM prospect_snapshots WHERE prospect_id = ? ORDER BY dated DESC`),
      stats: (await q(`SELECT dated, context, level, age, stats_json FROM prospect_stats WHERE prospect_id = ? ORDER BY dated DESC`))
        .map(s => ({ ...s, stats: JSON.parse(s.stats_json), stats_json: undefined }))
    });
  }
  return { found: true, matches: out };
}

// ── Read side for the app ─────────────────────────────────────────────────────
// One "row" = one player in one saved post on one date, with everything the post said about him (price, expected, rating, ranks, take).
async function loadRows(env, postId = null) {
  const all = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;
  const where = postId ? `AND post_id = ?` : '';
  const args = postId ? [postId] : [];
  const posts = await all(`SELECT post_id, post_type, title, source, published_at FROM prospect_posts WHERE status = 'confirmed' ${where}`, ...args);
  if (!posts.length) return { rows: [], posts: [] };
  const inPosts = `post_id IN (SELECT post_id FROM prospect_posts WHERE status = 'confirmed' ${where})`;
  const [pros, prices, ranks, snaps, takes] = await Promise.all([
    all(`SELECT prospect_id, name, side FROM prospects`),
    all(`SELECT post_id, prospect_id, dated, base_auto_cents, expected_cents FROM prospect_prices WHERE ${inPosts}`, ...args),
    all(`SELECT post_id, prospect_id, list_name, rank, dated FROM prospect_rankings WHERE ${inPosts}`, ...args),
    all(`SELECT post_id, prospect_id, dated, team, age, level, buy_rating, action FROM prospect_snapshots WHERE ${inPosts}`, ...args),
    all(`SELECT post_id, prospect_id, stance, summary, analysis, key_points, dated FROM prospect_takes WHERE ${inPosts}`, ...args)
  ]);
  const P = new Map(pros.map(p => [p.prospect_id, p])), PO = new Map(posts.map(p => [p.post_id, p]));
  const groups = new Map();
  const g = (post_id, prospect_id) => {
    const k = post_id + '|' + prospect_id;
    if (!groups.has(k)) groups.set(k, { post_id, prospect_id, prices: [], ranks: {}, snap: null, take: null });
    return groups.get(k);
  };
  for (const r of prices) g(r.post_id, r.prospect_id).prices.push(r);
  for (const r of ranks) g(r.post_id, r.prospect_id).ranks[r.list_name] = r.rank;
  for (const r of snaps) g(r.post_id, r.prospect_id).snap = r;
  for (const r of takes) g(r.post_id, r.prospect_id).take = r;
  const rows = [];
  for (const x of groups.values()) {
    const post = PO.get(x.post_id), pr = P.get(x.prospect_id);
    if (!post || !pr) continue;
    const postDate = post.published_at || (x.snap && x.snap.dated) || (x.take && x.take.dated) || null;
    const entries = x.prices.length ? x.prices.slice().sort((a, b) => String(a.dated).localeCompare(String(b.dated))) : [{ dated: postDate }];
    const main = entries.find(e => e.dated === postDate) || entries[entries.length - 1];
    for (const e of entries) {
      const full = e === main;
      rows.push({
        post_id: x.post_id, post_type: post.post_type, title: post.title, source: post.source,
        prospect_id: x.prospect_id, name: pr.name, side: pr.side, dated: e.dated,
        price_c: e.base_auto_cents ?? null, expected_c: e.expected_cents ?? null,
        team: full && x.snap ? x.snap.team : null, age: full && x.snap ? x.snap.age : null, level: full && x.snap ? x.snap.level : null,
        buy: full && x.snap ? x.snap.buy_rating : null, action: full && x.snap ? x.snap.action : null,
        ranks: full ? x.ranks : {}, take: full && x.take ? { stance: x.take.stance, summary: x.take.summary, analysis: x.take.analysis, key_points: JSON.parse(x.take.key_points || '[]') } : null
      });
    }
  }
  return { rows, posts };
}

const usDate = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${+m[2]}/${+m[3]}/${m[1]}` : ''; };
const dollars = c => c == null ? null : String(Math.round(c) / 100);
// Hitter/Pitcher for a row: the list he is ranked on is the most reliable signal, then the player's saved side.
const posLabel = (side, ranks = {}) => ranks['top 100 pitchers'] != null ? 'Pitcher' : ranks['top 200 hitters'] != null ? 'Hitter' : side === 'pitcher' ? 'Pitcher' : 'Hitter';
const WEEK0 = Date.UTC(2026, 3, 6);   // Monday of hot-sheet week 1 (the old sheet's numbering)
const weekOf = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? Math.floor((Date.UTC(+m[1], +m[2] - 1, +m[3]) - WEEK0) / 604800000) + 1 : null; };
const TOP_LISTS = { 'top 200 hitters': 'top200', 'top 100 pitchers': 'top100' };

// Everything the Prospects tab needs, shaped like the old Google Sheet tabs so the existing screens keep working.
export async function exportForApp(env) {
  const { rows } = await loadRows(env);
  const out = { players: [], top200: [], top100: [], origTop200: [], origTop100: [], hotsheet: [], buyScores: [] };
  const baseline = new Map();   // first "Players All" row per prospect = the baseline entry the old sheet had
  for (const r of rows.slice().sort((a, b) => String(a.dated).localeCompare(String(b.dated)))) {
    const date = usDate(r.dated), pos = posLabel(r.side, r.ranks), note = r.take ? r.take.summary : null;

    const isBaseline = r.source === 'prospect-master-sheet' && /^Players All/.test(r.title || '');
    if (isBaseline && !baseline.has(r.prospect_id)) {
      baseline.set(r.prospect_id, true);
      out.players.push({ date, team: r.team || '', pos, name: r.name, age: r.age ?? null, price: dollars(r.price_c), mlb: r.ranks['MLB'] ?? null, dd: r.ranks['DD'] ?? null,
        roto: r.ranks['Roto'] ?? null, sts: r.ranks['StS'] ?? null, ba: r.ranks['BA'] ?? null, hobby: r.ranks['hobby rank'] ?? null, buy: r.buy ?? null, lastYr: null, chg: null });
    }
    const hasBuyData = r.buy != null || r.action || r.expected_c != null;
    // Hot-sheet posts, plus any other post's prices/takes (rankings, analysis, price updates) that no other list carries, so the player modal sees them.
    if (r.post_type === 'hot_sheet' || (!isBaseline && !hasBuyData && (r.price_c != null || note))) {
      out.hotsheet.push({ date, week: r.post_type === 'hot_sheet' ? weekOf(r.dated) : null, pos, level: r.level || '', name: r.name, age: r.age ?? null, aff: r.team || '', auto: dollars(r.price_c),
        hobby: r.ranks['hobby rank'] ?? null, buyScore: r.buy ?? null });
    }
    for (const [list, key] of Object.entries(TOP_LISTS)) if (r.ranks[list] != null) {
      out[key].push({ date, rank: r.ranks[list], name: r.name, team: r.team || '', age: r.age ?? null, prev: null, diff: null, price: dollars(r.price_c) });
    }
    if (r.post_type !== 'hot_sheet' && !isBaseline && hasBuyData) {
      const list = Object.keys(TOP_LISTS).find(l => r.ranks[l] != null);
      out.buyScores.push({ date, pos, rank: list ? r.ranks[list] : null, name: r.name, team: r.team || '', age: r.age ?? null, price: dollars(r.price_c),
        score: r.buy ?? null, notes: r.action || null, expectedValue: dollars(r.expected_c) });
    }
  }
  return out;
}

// A player's notes, fetched when his modal opens (the startup export carries no text). Imported sheet notes are his own words, so they count as the analysis.
export async function playerTakes(env, name, offset = 0, limit = 3) {
  const { results: found } = await env.DB.prepare(`SELECT prospect_id FROM prospects WHERE norm_name = ?`).bind(normName(name)).all();
  if (!found.length) return { found: false, total: 0, latest: { note: null, summary: null }, takes: [] };
  const ids = found.map(f => f.prospect_id), ph = ids.map(() => '?').join(',');
  const base = `FROM prospect_takes t JOIN prospect_posts p ON p.post_id = t.post_id WHERE p.status = 'confirmed' AND t.prospect_id IN (${ph})`;
  const cols = `t.dated, t.stance, t.summary, t.analysis, t.key_points, p.title, p.post_id, p.source`;
  const shape = t => { const imp = t.source === 'prospect-master-sheet';
    return { dated: t.dated, stance: t.stance, title: t.title, post_id: t.post_id, analysis: t.analysis || (imp ? t.summary : null), summary: imp ? null : t.summary, key_points: JSON.parse(t.key_points || '[]') }; };
  const one = async extra => { const r = await env.DB.prepare(`SELECT ${cols} ${base} ${extra} ORDER BY t.dated DESC, t.id DESC LIMIT 1`).bind(...ids).first(); return r ? shape(r) : null; };
  const total = (await env.DB.prepare(`SELECT COUNT(*) n ${base}`).bind(...ids).first()).n;
  const lim = Math.min(Math.max(+limit || 3, 1), 10), off = Math.max(+offset || 0, 0);
  const { results } = await env.DB.prepare(`SELECT ${cols} ${base} ORDER BY t.dated DESC, t.id DESC LIMIT ? OFFSET ?`).bind(...ids, lim, off).all();
  return { found: true, total, latest: {
      note: await one(`AND (t.analysis IS NOT NULL OR p.source = 'prospect-master-sheet')`),
      summary: await one(`AND COALESCE(p.source, '') <> 'prospect-master-sheet' AND t.summary IS NOT NULL`)
    }, takes: results.map(shape) };
}

// Posts view: list of saved posts, newest first.
export async function listPosts(env) {
  const { results } = await env.DB.prepare(`SELECT p.post_id, p.title, p.post_type, p.published_at, p.summary, p.source,
      (SELECT COUNT(*) FROM prospect_takes t WHERE t.post_id = p.post_id) takes,
      (SELECT COUNT(DISTINCT prospect_id) FROM (SELECT prospect_id FROM prospect_prices WHERE post_id = p.post_id UNION SELECT prospect_id FROM prospect_rankings WHERE post_id = p.post_id UNION SELECT prospect_id FROM prospect_takes WHERE post_id = p.post_id)) players
    FROM prospect_posts p WHERE p.status = 'confirmed' ORDER BY p.published_at DESC, p.created_at DESC`).all();
  return { posts: results };
}

// One post: summary, the original text (kept for real posts), every player's take and numbers.
export async function postDetail(env, postId) {
  const post = await env.DB.prepare(`SELECT post_id, title, post_type, published_at, summary, thesis, source, raw_text FROM prospect_posts WHERE post_id = ? AND status = 'confirmed'`).bind(postId).first();
  if (!post) return { found: false };
  const { rows } = await loadRows(env, postId);
  const imported = post.source === 'prospect-master-sheet';
  return { found: true, post: { ...post, raw_text: imported ? null : post.raw_text, imported },
    players: rows.map(r => ({ name: r.name, side: r.side, dated: r.dated, team: r.team, age: r.age, level: r.level, buy: r.buy, action: r.action,
      price_c: r.price_c, expected_c: r.expected_c, ranks: r.ranks, take: r.take })) };
}

// ── Email in (Gmail script -> here) ───────────────────────────────────────────
// The Gmail script sends one email: subject, date, html (and/or plain text), plus any inline images as base64.
// We turn the HTML into text, download the table screenshots it links to, and hand everything to the normal Inbox pipeline.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·' };
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
export function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li|tr|table|ul|ol|blockquote|section|article)>/gi, '\n')
    .replace(/<(p|div|h[1-6]|li|tr|blockquote)\b[^>]*>/gi, '\n').replace(/<\/t[dh]>/gi, ' ');
  s = decodeEntities(s.replace(/<[^>]+>/g, ''));
  return s.replace(/[ \t\u00a0]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
// Table screenshots in the email body: https images that are not tracking pixels, logos or icons.
export function emailImageUrls(html) {
  const urls = [], seen = new Set();
  for (const m of String(html || '').matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0], src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!src) continue;
    const url = decodeEntities(src[1]).trim();
    if (!/^https:\/\//i.test(url) || seen.has(url)) continue;
    const w = +((/\bwidth\s*=\s*["']?(\d+)/i.exec(tag) || [])[1] || 0), h = +((/\bheight\s*=\s*["']?(\d+)/i.exec(tag) || [])[1] || 0);
    if ((w && w < 120) || (h && h < 60)) continue;
    if (/(pixel|tracking|spacer|beacon|logo|icon|avatar|badge|facebook|twitter|instagram|linkedin|youtube|\.gif(\?|$))/i.test(url)) continue;
    seen.add(url); urls.push(url);
  }
  return urls.slice(0, 20);
}
const toBase64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const IMG_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
// Downloads each image ourselves so one dead link can't fail the whole extraction. Tiny files (icons) and >5MB files are skipped.
async function downloadImages(urls, doFetch = fetch) {
  const out = [];
  await Promise.all(urls.map(async (url, i) => {
    try {
      const r = await doFetch(url, { signal: AbortSignal.timeout(8000), redirect: 'follow' });
      if (!r.ok) return;
      const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!IMG_TYPES.includes(type)) return;
      const buf = await r.arrayBuffer();
      if (buf.byteLength < 3000 || buf.byteLength > 5 * 1024 * 1024) return;
      out[i] = { media_type: type, base64: toBase64(buf), url };
    } catch { /* skip this image */ }
  }));
  return out.filter(Boolean);
}
export async function submitEmail(env, b, deps = {}) {
  const fromHtml = b.html ? htmlToText(b.html) : '';
  const text = fromHtml.length >= 200 ? fromHtml : String(b.text || fromHtml || '').trim();
  const inline = (Array.isArray(b.images) ? b.images : []).filter(i => i && i.base64 && IMG_TYPES.includes(i.media_type)).slice(0, 8);
  const linked = b.html ? await downloadImages(emailImageUrls(b.html), deps.doFetch) : [];
  const images = [...inline, ...linked].slice(0, 20);
  const title = String(b.subject || '').trim() || null;
  const publishedAt = isoDate(b.date) || null;
  return submitPost(env, { text, images, title, publishedAt, extractor: deps.extractor, deps: { notifyFetch: deps.notifyFetch } });
}

// ── Routes (called from worker.js) ────────────────────────────────────────────
const PROSPECT_ROUTES = new Set(['POST:/prospect-extract', 'GET:/prospect-pending', 'GET:/prospect-counts', 'GET:/prospect-usage', 'POST:/prospect-confirm', 'POST:/prospect-reject', 'POST:/prospect-email', 'GET:/prospect-export', 'GET:/prospect-takes', 'GET:/prospect-posts', 'GET:/prospect-post', 'GET:/prospect']);

export async function handleProspects(request, env, cors) {
  const url = new URL(request.url);
  if (!PROSPECT_ROUTES.has(`${request.method}:${url.pathname}`)) return null;
  const out = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (request.headers.get('X-App-Key') !== env.APP_KEY) return out({ error: 'unauthorized' }, 401);
  try {
    switch (url.pathname) {
      case '/prospect-extract': { const b = await request.json(); return out(await submitPost(env, b)); }
      case '/prospect-pending': return out(await listPendingPosts(env));
      case '/prospect-usage': return out(await usageSummary(env));
      case '/prospect-counts': return out({ pending: (await env.DB.prepare(`SELECT COUNT(*) n FROM prospect_posts WHERE status = 'pending'`).first()).n });
      case '/prospect-confirm': { const b = await request.json(); return out(await confirmPost(env, b.post_id, b.extraction || null)); }
      case '/prospect-reject': { const b = await request.json(); return out(await rejectPost(env, b.post_id)); }
      case '/prospect-email': { const b = await request.json(); return out(await submitEmail(env, b)); }
      case '/prospect-export': return out(await exportForApp(env));
      case '/prospect-posts': return out(await listPosts(env));
      case '/prospect-post': return out(await postDetail(env, url.searchParams.get('id') || ''));
      case '/prospect-takes': return out(await playerTakes(env, url.searchParams.get('name') || '', url.searchParams.get('offset'), url.searchParams.get('limit')));
      case '/prospect': return out(await prospectDetail(env, url.searchParams.get('name') || ''));
    }
    return null;
  } catch (e) {
    return out({ error: e.message }, 500);
  }
}
