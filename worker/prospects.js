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
- Only columns whose header is a date (e.g. "10/12 Price", "10/3 Price") or says Base Auto/Price are prices. Columns named "$ Diff", "% Diff", "Change", "Gain" or similar are the difference between two prices: NEVER record them as a price. For each row, the two price entries are the dollar values under the two dated price headers, read across the same row.
- Dates: write each price date as YYYY-MM-DD, using the month and day exactly as printed in the column header (10/3 -> the 3rd, not the 2nd) and the year from the post date.
- Prices are dollars as numbers ($1,234.50 -> 1234.5).
- Always capture these when a table has them: Age, Level, Expected (his expected value for the base auto), Buy Rating (a number around 1-5, put in buy_rating) and the Action/label beside it (put in action, exactly as written). A "-" means blank: omit the field.
- Third-party rank columns (MLB, DD, Roto, StS, BA, etc.) are rankings too: one ranking entry per column, list named as the header.
- Do NOT extract performance stats (OPS, PA, HR, wRC+, ERA, etc.) as data. Stats only appear in a take's key_points when the author cites them as part of his argument.
- The analysis matters most: for every player the author discusses, fill "take" with a short faithful summary in your own words, plus the specific points he cites. Do not copy long passages.
- Players only listed in a table (no commentary) get data but no take.
- Put each player in the list once, merging data from the text and from tables.
- stance: buy / hold / sell / watch / avoid, only if he clearly signals it; otherwise "none".`;

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

// Clean whatever the model returned into the exact shape the confirm step writes. Drops junk, never throws on odd values.
export function sanitizeExtraction(raw, fallbackDate = null) {
  const r = raw || {};
  const date = isoDate(r.published_date) || isoDate(fallbackDate);
  const players = (Array.isArray(r.players) ? r.players : []).filter(p => p && String(p.name || '').trim()).map(p => {
    const take = p.take && String(p.take.summary || '').trim() ? {
      stance: STANCES.includes(p.take.stance) ? p.take.stance : 'none',
      summary: String(p.take.summary).trim(),
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
      rankings: (Array.isArray(p.rankings) ? p.rankings : []).filter(x => x && x.list && intOrNull(x.rank) != null)
        .map(x => ({ list: String(x.list).trim(), rank: intOrNull(x.rank) })),
      // Accepts dollars (model output) or cents (already-cleaned output), so cleaning twice is safe.
      prices: (Array.isArray(p.prices) ? p.prices : []).map(x => x && ({
        date: x.date,
        base_auto_cents: x.base_auto_cents != null ? intOrNull(x.base_auto_cents) : cents(x.base_auto),
        expected_cents: x.expected_cents != null ? intOrNull(x.expected_cents) : cents(x.expected)
      })).filter(x => x && isoDate(x.date) && (x.base_auto_cents != null || x.expected_cents != null)),
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
    players
  };
}

// ── Claude call ───────────────────────────────────────────────────────────────
// images: [{ url } | { base64, media_type }]. Returns the sanitized extraction.
export async function extractWithClaude(env, { text, images = [], title = null, publishedAt = null }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set on the Worker');
  const model = env.PROSPECT_MODEL || DEFAULT_MODEL;
  const content = [];
  for (const img of images.slice(0, 20)) {
    if (img.url) content.push({ type: 'image', source: { type: 'url', url: img.url } });
    else if (img.base64) content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type || 'image/png', data: img.base64 } });
  }
  content.push({ type: 'text', text: `${title ? `Email/post title: ${title}\n` : ''}${publishedAt ? `Post date: ${publishedAt}\n` : ''}\nPOST TEXT:\n${text}` });
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
  const usage = { input_tokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), output_tokens: u.output_tokens || 0 };
  usage.cost_micros = costMicros(model, usage);
  return { extraction: sanitizeExtraction(block.input, publishedAt), model, usage };
}

// ── Pending / review ──────────────────────────────────────────────────────────
// Stores the post as 'pending'. Same text again returns the existing row instead of calling the model twice.
export async function submitPost(env, { text, images = [], title = null, publishedAt = null, source = 'prospect-analytics', extractor = extractWithClaude }) {
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
  return { postId, duplicate: false, status: 'pending', extraction, usage };
}

export async function listPendingPosts(env) {
  const { results } = await env.DB.prepare(`SELECT post_id, title, post_type, published_at, summary, extraction_json, created_at, model, input_tokens, output_tokens, cost_micros
    FROM prospect_posts WHERE status = 'pending' ORDER BY created_at`).all();
  return { pending: results.length, posts: await Promise.all(results.map(async r => {
    const extraction = JSON.parse(r.extraction_json || '{}');
    const { input_tokens, output_tokens, cost_micros, ...rest } = r;
    return { ...rest, extraction_json: undefined, extraction, usage: input_tokens == null ? null : { input_tokens, output_tokens, cost_micros },
      matches: await previewMatches(env, extraction.players || []) };
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
    if (p.take) { stmts.push(prep(`INSERT INTO prospect_takes (post_id, prospect_id, stance, summary, key_points, post_rank, dated) VALUES (?,?,?,?,?,?,?)`,
      postId, pid, p.take.stance, p.take.summary, JSON.stringify(p.take.key_points), p.post_rank, dated)); counts.takes++; }
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
      takes: (await q(`SELECT t.dated, t.stance, t.summary, t.key_points, t.post_rank, p.title, p.post_id FROM prospect_takes t JOIN prospect_posts p USING (post_id) WHERE t.prospect_id = ? ORDER BY t.dated DESC, t.id DESC`))
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

// ── Routes (called from worker.js) ────────────────────────────────────────────
const PROSPECT_ROUTES = new Set(['POST:/prospect-extract', 'GET:/prospect-pending', 'GET:/prospect-counts', 'GET:/prospect-usage', 'POST:/prospect-confirm', 'POST:/prospect-reject', 'GET:/prospect']);

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
      case '/prospect': return out(await prospectDetail(env, url.searchParams.get('name') || ''));
    }
    return null;
  } catch (e) {
    return out({ error: e.message }, 500);
  }
}
