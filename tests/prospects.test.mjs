// Local simulation: runs worker/prospects.js against an in-memory SQLite that mimics the D1 API.
// Run: node --no-warnings tests/prospects.test.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { submitPost, listPendingPosts, confirmPost, rejectPost, prospectDetail, sanitizeExtraction, normName, handleProspects, costMicros, usageSummary, exportForApp, playerTakes, listPosts, postDetail, htmlToText, emailImageUrls, submitEmail, extractWithClaude, reviewFlags, stanceFromTable } from '../worker/prospects.js';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../db/schema-prospects.sql', import.meta.url), 'utf8'));
  const stmt = (sql, binds = []) => ({
    bind: (...b) => stmt(sql, b),
    first: async () => db.prepare(sql).get(...binds) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...binds) }),
    run: async () => { const r = db.prepare(sql).run(...binds); return { meta: { changes: Number(r.changes) } }; },
    _exec: () => db.prepare(sql).run(...binds)
  });
  return {
    prepare: sql => stmt(sql),
    batch: async stmts => { db.exec('BEGIN'); try { for (const s of stmts) s._exec(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return []; },
    _raw: db
  };
}

// What the model should return for pieces of the two example posts (hand-built from the post text/screenshots).
const BOUNCE_BACK = {
  title: '10 prospects who could bounce back in 2027', post_type: 'analysis', published_date: '2026-10-14',
  summary: 'Buy-low Bowman hitters for 2027 chosen by age, ISO, wRC+ and swinging-strike filters.',
  thesis: 'Find young hitters with power and contact whose base autos are cheap after down years.',
  players: [
    { name: 'Ramiro Dominguez', team: 'MIN', side: 'hitter', age: 19.5, post_rank: 5, rankings: [{ list: 'hobby hitters', rank: 180 }],
      prices: [{ date: '2026-10-14', base_auto: 4.21 }],
      stat_lines: [{ context: '2026 season', level: 'A/A+', stats: { HR: 12, SB: 27, 'BB%': 10.9, 'K%': 18.7, ISO: 0.174, 'wRC+': 105 } }],
      take: { stance: 'buy', summary: 'Elite pull-air rate and strong contact; power should come as he gets stronger.', key_points: ['PullAir% 93rd percentile', 'Pull% ranked #1 of 132 teens'] } },
    { name: 'Handelfry Encarnacion', team: 'MIL', side: 'hitter', age: 19.3, post_rank: 2, rankings: [{ list: 'hobby hitters', rank: 137 }],
      prices: [{ date: '2026-10-14', base_auto: 10.10 }],
      stat_lines: [{ context: '2026 season', level: 'A', stats: { HR: 12, SB: 27, 'BB%': 16.2, 'K%': 17.7, ISO: 0.155, 'wRC+': 111 } }],
      take: { stance: 'buy', summary: 'Well-rounded, advanced zone feel; hype faded so the price dipped.', key_points: ['Only teen with K% under 20 and 10 HR/25 SB'] } },
    { name: 'Devin Fitz-Gerald', team: 'WAS', side: 'hitter', age: 21.2, post_rank: 1, rankings: [{ list: 'hobby hitters', rank: 53 }],
      prices: [{ date: '2026-10-14', base_auto: 15.79 }],
      stat_lines: [{ context: '2026 season', level: 'A+/AA', stats: { HR: 20, SB: 15, 'BB%': 9.7, 'K%': 21.9, ISO: 0.191, 'wRC+': 107 } }],
      take: { stance: 'buy', summary: 'Promoted aggressively and struggled; finished strong. Price never recovered.', key_points: ['61 games above rookie ball at promotion'] } }
  ]
};
const AFL = {
  title: 'Arizona Fall League - Hot & Cold', post_type: 'hot_sheet', published_date: '2026-10-13',
  summary: 'AFL hot and cold Bowman bats and arms with price changes since opening weekend.',
  players: [
    { name: 'Jhonny Severino', team: 'PIT', side: 'hitter', age: 21.9, rankings: [{ list: 'hobby hitters', rank: 228 }],
      prices: [{ date: '2026-10-12', base_auto: 25.93 }, { date: '2026-10-03', base_auto: 5.41 }],
      stat_lines: [{ context: 'AFL 2026', level: 'AFL', stats: { PA: 15, OPS: 0.9 } }],
      take: { stance: 'watch', summary: 'Price up nearly 400% in ten days with no clear catalyst.', key_points: [] } },
    { name: 'Caleb Bonemer', team: 'CHW', side: 'hitter', age: 21.0, rankings: [{ list: 'hobby hitters', rank: 7 }],
      prices: [{ date: '2026-10-12', base_auto: 66.20, expected: 107.80 }, { date: '2026-10-03', base_auto: 70.17 }],
      stat_lines: [{ context: 'AFL 2026', level: 'AFL', stats: { PA: 24, OPS: 1.008 } }],
      take: { stance: 'buy', summary: 'Hitting over 1.000 OPS yet price fell; already a buy.', key_points: ['Expected value $107.80'] } },
    { name: 'Jarlin Susana', team: 'WAS', side: 'pitcher', age: 22.6, rankings: [{ list: 'hobby pitchers', rank: 3 }],
      prices: [{ date: '2026-10-12', base_auto: 57.86 }, { date: '2026-10-03', base_auto: 45.39 }],
      stat_lines: [{ context: 'AFL 2026', level: 'AFL', stats: { IP: 5.2, ERA: 1.59, WHIP: 0.88, SO9: 12.7 } }] }
  ]
};

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };
const POST_TEXT = 'Placeholder post body used only to exercise storage and de-duplication in tests.';

const calls = [];
const fakeExtractor = ex => async (env, args) => { calls.push(args); return { extraction: sanitizeExtraction(ex, args.publishedAt), model: 'fake' }; };

await t('normName handles accents, Jr., punctuation', () => {
  assert.equal(normName('Nehomar Ochoa Jr.'), 'nehomar ochoa');
  assert.equal(normName('Luis  De Vries'), 'luis de vries');
  assert.equal(normName('Jesús Made'), 'jesus made');
});

await t('sanitizeExtraction drops junk and converts dollars to cents', () => {
  const ex = sanitizeExtraction({
    post_type: 'bogus', summary: 'x',
    players: [{ name: ' ' }, { name: 'A B', age: 'abc', prices: [{ date: '10/12', base_auto: 5 }, { date: '2026-10-12', base_auto: '$5' }, { date: '2026-10-12', base_auto: 4.99 }],
      rankings: [{ list: 'l', rank: 'x' }, { list: 'l', rank: 7 }], take: { stance: 'moon', summary: 'hi' }, stat_lines: [{ context: 'c', stats: {} }] }]
  });
  assert.equal(ex.post_type, 'other');
  assert.equal(ex.players.length, 1);
  const p = ex.players[0];
  assert.equal(p.age, null);
  assert.deepEqual(p.prices, [{ date: '2026-10-12', base_auto_cents: 499, expected_cents: null }]);
  assert.deepEqual(p.rankings, [{ list: 'l', rank: 7 }]);
  assert.equal(p.take.stance, 'none');
  assert.equal(p.stat_lines.length, 0);
});

await t('cleaning twice gives the same result (confirm re-cleans what was stored)', () => {
  const once = sanitizeExtraction(AFL);
  assert.deepEqual(sanitizeExtraction(once), once);
});

await t('submit stores a pending post and nothing in the prospect tables', async () => {
  const env = { DB: makeDb() };
  const r = await submitPost(env, { text: POST_TEXT, title: BOUNCE_BACK.title, publishedAt: '2026-10-14', extractor: fakeExtractor(BOUNCE_BACK) });
  assert.equal(r.duplicate, false);
  assert.equal(r.extraction.players.length, 3);
  assert.equal(env.DB._raw.prepare('SELECT COUNT(*) n FROM prospects').get().n, 0);
  assert.equal(env.DB._raw.prepare('SELECT COUNT(*) n FROM prospect_takes').get().n, 0);
  assert.equal(env.DB._raw.prepare('SELECT raw_text FROM prospect_posts').get().raw_text, POST_TEXT);
});

await t('same post sent twice is a duplicate and does not call the model again', async () => {
  const env = { DB: makeDb() };
  calls.length = 0;
  await submitPost(env, { text: POST_TEXT, extractor: fakeExtractor(BOUNCE_BACK) });
  const again = await submitPost(env, { text: POST_TEXT, extractor: fakeExtractor(BOUNCE_BACK) });
  assert.equal(again.duplicate, true);
  assert.equal(calls.length, 1);
});

await t('cost math: Haiku 5.5 normal and over-100K tiers, Sonnet flat, unknown model has no estimate', () => {
  assert.equal(costMicros('claude-haiku-5-5', { input_tokens: 10000, output_tokens: 2000 }), 2000);        // $0.002
  assert.equal(costMicros('claude-haiku-5-5', { input_tokens: 150000, output_tokens: 1000 }), 77500);      // long-prompt rates
  assert.equal(costMicros('claude-sonnet-5-5', { input_tokens: 10000, output_tokens: 2000 }), 40000);      // $0.04
  assert.equal(costMicros('some-future-model', { input_tokens: 1, output_tokens: 1 }), null);
});

await t('token usage is stored on the post, returned, shown in pending, and summed', async () => {
  const env = { DB: makeDb() };
  const withUsage = ex => async (e, args) => ({ extraction: sanitizeExtraction(ex, args.publishedAt), model: 'claude-haiku-5-5', usage: { input_tokens: 20000, output_tokens: 3000, cost_micros: costMicros('claude-haiku-5-5', { input_tokens: 20000, output_tokens: 3000 }) } });
  const r = await submitPost(env, { text: POST_TEXT, extractor: withUsage(BOUNCE_BACK) });
  assert.deepEqual(r.usage, { input_tokens: 20000, output_tokens: 3000, cost_micros: 3500 });
  const pend = await listPendingPosts(env);
  assert.deepEqual(pend.posts[0].usage, { input_tokens: 20000, output_tokens: 3000, cost_micros: 3500 });
  await submitPost(env, { text: POST_TEXT + ' another post', extractor: withUsage(AFL) });
  await submitPost(env, { text: 'no usage reported here, long enough to store', extractor: fakeExtractor(AFL) });   // usage unknown: not counted
  const u = await usageSummary(env);
  assert.deepEqual({ ...u.month }, { posts: 2, input_tokens: 40000, output_tokens: 6000, cost_micros: 7000 });
  assert.deepEqual({ ...u.all_time }, { ...u.month });
});

await t('a rejected post can be submitted again; a confirmed one cannot', async () => {
  const env = { DB: makeDb() };
  const a = await submitPost(env, { text: POST_TEXT, extractor: fakeExtractor(BOUNCE_BACK) });
  await rejectPost(env, a.postId);
  const again = await submitPost(env, { text: POST_TEXT, extractor: fakeExtractor(BOUNCE_BACK) });
  assert.equal(again.duplicate, false);
  assert.equal(env.DB._raw.prepare('SELECT COUNT(*) n FROM prospect_posts').get().n, 1);
  await confirmPost(env, again.postId);
  assert.equal((await submitPost(env, { text: POST_TEXT, extractor: fakeExtractor(BOUNCE_BACK) })).duplicate, true);
});

await t('pending list flags new players; confirm writes every table', async () => {
  const env = { DB: makeDb() };
  const { postId } = await submitPost(env, { text: POST_TEXT, publishedAt: '2026-10-14', extractor: fakeExtractor(BOUNCE_BACK) });
  const pend = await listPendingPosts(env);
  assert.equal(pend.pending, 1);
  assert.ok(pend.posts[0].matches.every(m => m.status === 'new'));
  const c = await confirmPost(env, postId);
  assert.deepEqual(c.counts, { prospects: 3, takes: 3, rankings: 3, prices: 3, stats: 0, snapshots: 3 });
  assert.equal((await listPendingPosts(env)).pending, 0);
  const d = await prospectDetail(env, 'ramiro dominguez');
  assert.equal(d.matches[0].prospect.org, 'MIN');
  assert.equal(d.matches[0].prices[0].base_auto_cents, 421);
  assert.equal(d.matches[0].takes[0].key_points[0], 'PullAir% 93rd percentile');
  assert.equal(d.matches[0].stats.length, 0);   // stats are no longer stored
});

await t('buy rating, action, level, age and expected-only rows are kept (Top 100 style table)', async () => {
  const env = { DB: makeDb() };
  const top100 = { post_type: 'rankings', published_date: '2026-10-04', summary: 'Top 100 pitchers.', players: [
    { name: 'Braylon Doughty', team: 'CLE', side: 'pitcher', age: 20.8, level: 'AA', buy_rating: 5.0, action: 'Strongest Buy',
      rankings: [{ list: 'top 100 pitchers', rank: 9 }, { list: 'MLB', rank: 12 }], prices: [{ date: '2026-10-04', base_auto: 14.41, expected: 29.25 }] },
    { name: 'Ramon Marquez', team: 'SF', side: 'pitcher', age: 21.0, buy_rating: '-', action: '-', rankings: [{ list: 'top 100 pitchers', rank: 7 }], prices: [{ date: '2026-10-04', expected: 35.75 }] }
  ] };
  const { postId } = await submitPost(env, { text: POST_TEXT + ' top100', extractor: fakeExtractor(top100) });
  const c = await confirmPost(env, postId);
  assert.equal(c.counts.snapshots, 2); assert.equal(c.counts.prices, 2); assert.equal(c.counts.rankings, 3);
  const d = await prospectDetail(env, 'Braylon Doughty');
  assert.deepEqual({ ...d.matches[0].snapshots[0] }, { dated: '2026-10-04', team: 'CLE', age: 20.8, level: 'AA', buy_rating: 5, action: 'Strongest Buy' });
  const m = await prospectDetail(env, 'Ramon Marquez');
  assert.equal(m.matches[0].snapshots[0].buy_rating, null); assert.equal(m.matches[0].snapshots[0].action, null);
  assert.equal(m.matches[0].prices[0].base_auto_cents, null); assert.equal(m.matches[0].prices[0].expected_cents, 3575);
});

await t('second post matches existing players (no duplicates) and builds a price/take timeline', async () => {
  const env = { DB: makeDb() };
  const first = await submitPost(env, { text: POST_TEXT, publishedAt: '2026-10-14', extractor: fakeExtractor(BOUNCE_BACK) });
  await confirmPost(env, first.postId);
  const withFitz = { ...AFL, players: [...AFL.players, { name: 'Devin Fitz-Gerald', team: 'WAS', take: { stance: 'hold', summary: 'Quiet AFL.', key_points: [] } }] };
  const second = await submitPost(env, { text: POST_TEXT + ' second post body, different text', publishedAt: '2026-10-13', extractor: fakeExtractor(withFitz) });
  const pend = await listPendingPosts(env);
  assert.equal(pend.posts[0].matches.find(m => m.name === 'Devin Fitz-Gerald').status, 'existing');
  await confirmPost(env, second.postId);
  assert.equal(env.DB._raw.prepare("SELECT COUNT(*) n FROM prospects WHERE norm_name = 'devin fitz gerald'").get().n, 1);
  const d = await prospectDetail(env, 'Devin Fitz-Gerald');
  assert.equal(d.matches[0].takes.length, 2);
  const sev = await prospectDetail(env, 'Jhonny Severino');
  assert.deepEqual(sev.matches[0].prices.map(p => [p.dated, p.base_auto_cents]), [['2026-10-12', 2593], ['2026-10-03', 541]]);
});

await t('two different players with the same name are told apart by team', async () => {
  const env = { DB: makeDb() };
  const mk = (team, n) => ({ post_type: 'other', summary: 's', players: [{ name: 'Luis Hernandez', team, take: { stance: 'none', summary: 'note ' + n } }] });
  const a = await submitPost(env, { text: 'x'.repeat(50) + 'a', extractor: fakeExtractor(mk('LAD', 1)) });
  await confirmPost(env, a.postId);
  env.DB._raw.exec("INSERT INTO prospects (prospect_id, name, norm_name, org) VALUES ('luis-hernandez-2','Luis Hernandez','luis hernandez','KC')");
  const b = await submitPost(env, { text: 'x'.repeat(50) + 'b', extractor: fakeExtractor(mk('KC', 2)) });
  const pend = await listPendingPosts(env);
  assert.equal(pend.posts[0].matches[0].prospect_id, 'luis-hernandez-2');
  await confirmPost(env, b.postId);
  assert.equal(env.DB._raw.prepare("SELECT COUNT(*) n FROM prospect_takes WHERE prospect_id = 'luis-hernandez-2'").get().n, 1);
});

await t('edited extraction on confirm is what gets saved; reject saves nothing; confirm twice is refused', async () => {
  const env = { DB: makeDb() };
  const { postId } = await submitPost(env, { text: POST_TEXT, extractor: fakeExtractor(BOUNCE_BACK) });
  const edited = JSON.parse(JSON.stringify(BOUNCE_BACK));
  edited.players = edited.players.slice(0, 1);
  edited.players[0].prices[0].base_auto = 4.5;
  const c = await confirmPost(env, postId, edited);
  assert.equal(c.counts.prospects, 1);
  assert.equal((await prospectDetail(env, 'Ramiro Dominguez')).matches[0].prices[0].base_auto_cents, 450);
  await assert.rejects(() => confirmPost(env, postId), /already confirmed/);
  const r2 = await submitPost(env, { text: 'y'.repeat(60), extractor: fakeExtractor(AFL) });
  assert.equal((await rejectPost(env, r2.postId)).rejected, true);
  assert.equal(env.DB._raw.prepare('SELECT COUNT(*) n FROM prospect_takes WHERE post_id = ?').get(r2.postId).n, 0);
});

await t('a failing write rolls the whole post back (nothing half-saved)', async () => {
  const env = { DB: makeDb() };
  const { postId } = await submitPost(env, { text: POST_TEXT, extractor: fakeExtractor(BOUNCE_BACK) });
  env.DB._raw.exec('DROP TABLE prospect_rankings');   // force a mid-batch failure
  await assert.rejects(() => confirmPost(env, postId));
  assert.equal(env.DB._raw.prepare('SELECT COUNT(*) n FROM prospect_takes').get().n, 0);
  assert.equal(env.DB._raw.prepare('SELECT status FROM prospect_posts WHERE post_id = ?').get(postId).status, 'pending');
});

await t('routes require the app key and pass other paths through', async () => {
  const env = { DB: makeDb(), APP_KEY: 'k' };
  const bad = await handleProspects(new Request('https://x/prospect-pending'), env, {});
  assert.equal(bad.status, 401);
  const ok = await handleProspects(new Request('https://x/prospect-pending', { headers: { 'X-App-Key': 'k' } }), env, {});
  assert.equal((await ok.json()).pending, 0);
  assert.equal(await handleProspects(new Request('https://x/cards', { headers: { 'X-App-Key': 'k' } }), env, {}), null);
  await submitPost(env, { text: 'z'.repeat(60), extractor: fakeExtractor(AFL) });
  const counts = await handleProspects(new Request('https://x/prospect-counts', { headers: { 'X-App-Key': 'k' } }), env, {});
  assert.deepEqual(await counts.json(), { pending: 1 });
});

await t('app export, posts list and post detail (sheet-shaped arrays for the existing Prospects screens)', async () => {
  const env = { DB: makeDb() }, raw = env.DB._raw;
  raw.exec(`INSERT INTO prospects (prospect_id, name, norm_name, org, side) VALUES ('dax-kilby','Dax Kilby','dax kilby','NYY','hitter'), ('kade-anderson','Kade Anderson','kade anderson','SEA','pitcher');
    INSERT INTO prospect_posts (post_id, source, title, post_type, published_at, raw_text, status, summary) VALUES
      ('pa','prospect-master-sheet','Players All · 2026-03-12','analysis','2026-03-12','x','confirmed','Imported 1'),
      ('hs','prospect-master-sheet','Hot Sheet · 2026-04-14','hot_sheet','2026-04-14','x','confirmed','Imported 1'),
      ('bs','prospect-master-sheet','Buy Score · 2026-05-31','rankings','2026-05-31','x','confirmed','Imported 1'),
      ('pend','prospect-analytics','Pending one','analysis','2026-10-01','x','pending','nope');
    INSERT INTO prospect_takes (post_id, prospect_id, stance, summary, key_points, dated) VALUES ('pa','dax-kilby','none','Long baseline note','[]','2026-03-12');
    INSERT INTO prospect_rankings (post_id, prospect_id, list_name, rank, dated) VALUES ('pa','dax-kilby','hobby rank',20,'2026-03-12'),('pa','dax-kilby','MLB',4,'2026-03-12'),('hs','dax-kilby','hobby rank',44,'2026-04-14'),('bs','kade-anderson','top 100 pitchers',1,'2026-05-31');
    INSERT INTO prospect_prices (post_id, prospect_id, dated, base_auto_cents, expected_cents) VALUES ('pa','dax-kilby','2026-03-12',8400,NULL),('hs','dax-kilby','2026-04-14',8453,5320),('bs','kade-anderson','2026-05-31',12800,15000);
    INSERT INTO prospect_snapshots (post_id, prospect_id, dated, team, age, level, buy_rating, action) VALUES ('pa','dax-kilby','2026-03-12','NYY',19.3,NULL,4,NULL),('hs','dax-kilby','2026-04-14','NYY',19.4,'A+',2.3,NULL),('bs','kade-anderson','2026-05-31','SEA',21.8,NULL,4.5,'Strong Buy');`);
  const ex = await exportForApp(env);
  assert.equal(ex.players.length, 1);   // only the Players All baseline
  assert.deepEqual({ ...ex.players[0] }, { date: '3/12/2026', team: 'NYY', pos: 'Hitter', name: 'Dax Kilby', age: 19.3, price: '84', mlb: 4, dd: null, roto: null, sts: null, ba: null, hobby: 20, buy: 4, lastYr: null, chg: null });
  assert.equal(ex.hotsheet.length, 1);
  assert.deepEqual({ ...ex.hotsheet[0] }, { date: '4/14/2026', week: 2, pos: 'Hitter', level: 'A+', name: 'Dax Kilby', age: 19.4, aff: 'NYY', auto: '84.53', hobby: 44, buyScore: 2.3 });
  assert.deepEqual(ex.top100.map(r => [r.name, r.rank, r.date, r.price]), [['Kade Anderson', 1, '5/31/2026', '128']]);
  assert.deepEqual(ex.buyScores.map(r => [r.name, r.rank, r.score, r.notes, r.expectedValue]), [['Kade Anderson', 1, 4.5, 'Strong Buy', '150']]);
  assert.equal(ex.top200.length, 0);
  const lp = await listPosts(env);
  assert.deepEqual(lp.posts.map(p => p.title), ['Buy Score · 2026-05-31', 'Hot Sheet · 2026-04-14', 'Players All · 2026-03-12']);   // newest first, pending excluded
  assert.equal(lp.posts[2].takes, 1); assert.equal(lp.posts[2].players, 1);
  const pd = await postDetail(env, 'hs');
  assert.equal(pd.post.imported, true); assert.equal(pd.post.raw_text, null);
  assert.equal(pd.players[0].price_c, 8453); assert.equal(pd.players[0].expected_c, 5320); assert.equal(pd.players[0].ranks['hobby rank'], 44);
  assert.equal((await postDetail(env, 'pend')).found, false);
});

await t('email: html becomes readable text, table screenshots are picked and downloaded, duplicates and junk are handled', async () => {
  const html = `<html><head><style>p{color:red}</style></head><body><p>Hello &amp; welcome &mdash; it&#39;s the <b>AFL</b> post.</p><div>Line two<br>Line three</div>
    <img src="https://cdn.example.com/open-tracking.gif" width="1" height="1"><img src="https://cdn.example.com/logo.png" width="200">
    <img src="https://cdn.example.com/hot-bats.png?x=1&amp;y=2" width="700"><img src="http://insecure.example.com/a.png"><img src="https://cdn.example.com/dead.png">
    <table><tr><td>Dax Kilby</td><td>$78.14</td></tr></table><script>alert(1)</script>
    <p>${'Plenty more analysis text here. '.repeat(10)}</p></body></html>`;
  const txt = htmlToText(html);
  assert.ok(txt.startsWith("Hello & welcome — it's the AFL post.\n\nLine two\nLine three")); assert.ok(!txt.includes('alert') && !txt.includes('color:red') && !txt.includes('<'));
  assert.ok(txt.includes('Dax Kilby $78.14'));
  assert.deepEqual(emailImageUrls(html), ['https://cdn.example.com/hot-bats.png?x=1&y=2', 'https://cdn.example.com/dead.png']);
  const png = new Uint8Array(4000).fill(7);
  const fetched = [];
  const doFetch = async url => { fetched.push(url); return url.includes('dead') ? { ok: false } : { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => png.buffer }; };
  const env = { DB: makeDb() }; const seen = [];
  const extractor = async (e, args) => { seen.push(args); return { extraction: sanitizeExtraction({ post_type: 'hot_sheet', summary: 's', players: [{ name: 'Dax Kilby', team: 'NYY' }] }, args.publishedAt), model: 'fake' }; };
  const r = await submitEmail(env, { subject: 'AFL Hot & Cold', date: '2026-10-12', html, images: [{ media_type: 'image/jpeg', base64: 'AAAA' }, { media_type: 'application/pdf', base64: 'BBBB' }] }, { extractor, doFetch });
  assert.equal(r.duplicate, false);
  assert.equal(seen[0].title, 'AFL Hot & Cold'); assert.equal(seen[0].publishedAt, '2026-10-12');
  assert.equal(seen[0].images.length, 2);   // 1 inline jpeg + 1 downloaded table (dead link skipped, pdf rejected)
  assert.equal(seen[0].images[1].media_type, 'image/png'); assert.equal(seen[0].images[1].base64.length, Math.ceil(4000 / 3) * 4);
  assert.equal(fetched.length, 2);
  assert.equal((await submitEmail(env, { subject: 'AFL Hot & Cold', date: '2026-10-12', html }, { extractor, doFetch })).duplicate, true);
  await assert.rejects(() => submitEmail(env, { subject: 'x', html: '<p>hi</p>' }, { extractor, doFetch }), /too short/);
  const pend = await listPendingPosts(env); assert.equal(pend.pending, 1);
});

await t('prices with the same date merge into one row (base auto + separately listed Expected)', async () => {
  const c = sanitizeExtraction({ post_type: 'hot_sheet', summary: 's', published_date: '2026-10-12', players: [{ name: 'Caleb Bonemer', prices: [
    { date: '2026-10-12', base_auto: 66.2 }, { date: '2026-10-03', base_auto: 70.17 }, { date: '2026-10-12', expected: 107.8 }] }] });
  assert.deepEqual(c.players[0].prices.map(x => ({ ...x })), [{ date: '2026-10-12', base_auto_cents: 6620, expected_cents: 10780 }, { date: '2026-10-03', base_auto_cents: 7017, expected_cents: null }]);
  assert.deepEqual(sanitizeExtraction(c, null).players[0].prices, c.players[0].prices);   // cleaning twice changes nothing
  const env = { DB: makeDb() };
  const { postId } = await submitPost(env, { text: POST_TEXT + ' merge', extractor: async () => ({ extraction: { ...c, players: c.players.map(p => ({ ...p, prices: [{ date: '2026-10-12', base_auto_cents: 6620, expected_cents: null }, { date: '2026-10-12', base_auto_cents: null, expected_cents: 10780 }] })) }, model: 'fake' }) });
  const pend = await listPendingPosts(env);   // stored extraction still has the split rows; the list re-cleans them
  assert.equal(pend.posts[0].extraction.players[0].prices.length, 1); assert.equal(pend.posts[0].extraction.players[0].prices[0].expected_cents, 10780);
});

await t('table posts with several images are read one image at a time and merged', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const content = JSON.parse(init.body).messages[0].content;
    const img = content.find(b => b.type === 'image'); const n = img ? img.source.data : null;
    calls.push(n);
    const input = !n ? { post_type: 'rankings', summary: 'Top 200', published_date: '2026-08-28', players: [{ name: 'Eli Willits', take: { stance: 'none', summary: 'Cheap vs expected' } }, { name: 'Ralphy Velasquez', team: 'CLE', buy_rating: null }, { name: 'Gavin Fien', team: 'WAS', buy_rating: 4.6 }] }
      : n === 'B' ? { summary: 'x', players: [{ name: 'Eli Willits', team: 'WSN', age: 18.7, buy_rating: 3.7, action: 'Lean Buy', rankings: [{ list: 'Top 200 Hitters', rank: 2 }], prices: [{ date: '2026-08-28', base_auto: 176.5 }] }] }
      : n === 'C' ? { summary: 'x', players: [{ name: 'Eli Willits', prices: [{ date: '2026-08-28', expected: 237.5 }] }, { name: 'Jesus Made', team: 'MIL', rankings: [{ list: 'Top 200 Hitters', rank: 1 }] }, { name: 'Ralphy Velazquez', team: 'CLE', rankings: [{ list: 'Top 200 Hitters', rank: 20 }] }, { name: 'Gavin Kilen', team: 'SFG', rankings: [{ list: 'Top 200 Hitters', rank: 120 }] }] }
      : n === 'D' ? null : { summary: 'x', players: [] };
    if (!input) return new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 });
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'record_post', input }], stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 100 } }), { status: 200 });
  };
  try {
    const img = d => ({ media_type: 'image/png', base64: d });
    const r = await extractWithClaude({ ANTHROPIC_API_KEY: 'k' }, { text: 'x'.repeat(100), images: [img('B'), img('C'), img('D')], publishedAt: '2026-08-28' });
    assert.equal(calls.length, 4);
    const e = r.extraction; assert.equal(e.post_type, 'rankings'); assert.equal(e.players.length, 5);   // Velasquez (text typo) and Velazquez (table) are one player; Fien and Kilen stay two
    assert.ok(e.players.find(p => p.name === 'Gavin Fien').buy_rating === 4.6 && e.players.some(p => p.name === 'Gavin Kilen'));
    assert.ok(e.players.some(p => p.name === 'Ralphy Velazquez') && !e.players.some(p => p.name === 'Ralphy Velasquez'));
    const w = e.players.find(p => p.name === 'Eli Willits');
    assert.equal(w.buy_rating, 3.7); assert.equal(w.take.summary, 'Cheap vs expected'); assert.equal(w.rankings.length, 1);
    assert.deepEqual({ ...w.prices[0] }, { date: '2026-08-28', base_auto_cents: 17650, expected_cents: 23750 });
    assert.match(e.summary, /1 of 3 table images could not be read/);
    assert.equal(r.usage.input_tokens, 3000);   // three successful calls summed (text + 2 images)
  } finally { globalThis.fetch = realFetch; }
});

await t('a Top 200 post\'s Rank column lands on "top 200 hitters" however the model named it', async () => {
  const c = sanitizeExtraction({ title: 'Bowman Prospect Rankings - Top 200 Hitters', post_type: 'rankings', summary: 's', published_date: '2026-08-28', players: [
    { name: 'A One', rankings: [{ list: 'Rank', rank: 2 }, { list: 'Own rank', rank: 2 }, { list: 'MLB', rank: 5 }] },
    { name: 'B Two', post_rank: 81 }, { name: 'C Three', rankings: [{ list: 'Rank', rank: 260 }] }, { name: 'D Four', rankings: [{ list: 'Hobby', rank: 77 }] }] });
  assert.deepEqual(c.players[0].rankings, [{ list: 'top 200 hitters', rank: 2 }, { list: 'MLB', rank: 5 }]);
  assert.deepEqual(c.players[1].rankings, [{ list: 'top 200 hitters', rank: 81 }]);
  assert.deepEqual(c.players[2].rankings, []); assert.deepEqual(c.players[3].rankings, [{ list: 'top 200 hitters', rank: 77 }]);
  const o = sanitizeExtraction({ title: 'Hot Sheet', summary: 's', players: [{ name: 'E Five', rankings: [{ list: 'Rank', rank: 9 }] }] });
  assert.deepEqual(o.players[0].rankings, [{ list: 'Rank', rank: 9 }]);   // other posts keep the list as named
});

await t('review checks flag the things that went wrong before, and stay quiet on a clean post', async () => {
  const mk = (n, rank, extra = {}) => ({ name: n, rankings: rank ? [{ list: 'top 200 hitters', rank }] : [], prices: [], ...extra });
  const clean = { title: 'Top 200 Hitters', players: Array.from({ length: 200 }, (_, i) => mk(`Name${i} Surname${'x'.repeat(i % 7)}${i}`, i + 1)) };
  assert.deepEqual(reviewFlags(clean), []);
  assert.match(reviewFlags({ title: 'x', players: [] })[0].text, /No players/);
  const bad = { title: 'Bowman Rankings - Top 200 Hitters', players: [
    ...clean.players.slice(0, 74), ...clean.players.slice(76, 150),   // ranks 75,76 and 151-200 missing
    mk('Ralphy Velasquez', 20), mk('Ralphy Velazquez', 20), mk('Odd Rank', 260), mk('No Rank', null),
    { name: 'Weird Values', rankings: [{ list: 'Mystery List', rank: 4 }], buy_rating: 7, prices: [{ date: '2026-08-28', base_auto_cents: 99999999 }] }] };
  const f = reviewFlags(bad, { matches: [{ name: 'X', status: 'ambiguous' }] }); const all = f.map(x => x.text).join(' | ');
  assert.match(all, /New rank list "Mystery List"/); assert.match(all, /outside 1-200 on top 200 hitters: Odd Rank/); assert.match(all, /used twice: #20/);
  assert.match(all, /no top 200 hitters rank: .*No Rank/); assert.match(all, /ranks? missing from 1-200/); assert.match(all, /Possible duplicate players: Ralphy Velasquez \/ Ralphy Velazquez/);
  assert.match(all, /buy rating 7/); assert.match(all, /Name matches several/);
  assert.ok(f.find(x => /Odd Rank/.test(x.text)).players.includes('Odd Rank'));
  // a list already on file is not new
  assert.equal(reviewFlags({ title: 'z', players: [{ name: 'A B', rankings: [{ list: 'AFL hot hitters rank', rank: 1 }] }] }, { knownLists: ['afl hot hitters rank'] }).length, 0);
});

await t('buy/sell tag comes only from the table (buy rating / action), never from his analysis; repeated players merge', async () => {
  assert.equal(stanceFromTable({ action: 'Strong Buy' }), 'buy'); assert.equal(stanceFromTable({ action: 'Lean Buy', buy_rating: 3.9 }), 'buy');
  assert.equal(stanceFromTable({ buy_rating: 4.1 }), 'buy'); assert.equal(stanceFromTable({ buy_rating: 3.2, action: 'Slightly Undervalued' }), 'none');
  assert.equal(stanceFromTable({ action: 'Very Overvalued', buy_rating: 2.0 }), 'none'); assert.equal(stanceFromTable({ action: 'Consider Selling' }), 'sell');
  assert.equal(stanceFromTable({}), 'none');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'record_post', input: { post_type: 'analysis', summary: 's', players: [
    { name: 'Andri Hidalgo', take: { stance: 'buy', summary: 'cool with a buy if cheap' } },
    { name: 'Argenis Cayama', take: { stance: 'none', summary: 'short' } }, { name: 'Argenis Cayama', hobby: 1, rankings: [{ list: 'Hobby Rank', rank: 52 }], take: { stance: 'none', summary: 'a much longer take about him' } },
    { name: 'Josh Owens', side: 'hitter', take: { stance: 'none', summary: 'h' } }, { name: 'Josh Owens', side: 'pitcher', take: { stance: 'none', summary: 'p' } },
    { name: 'Cheap Guy', buy_rating: 4.2, action: 'Buy', take: { stance: 'none', summary: 'ok' } }] } }], stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200 });
  try {
    const e = (await extractWithClaude({ ANTHROPIC_API_KEY: 'k' }, { text: 'x'.repeat(100), images: [] })).extraction;
    const by = n => e.players.filter(p => p.name === n);
    assert.equal(by('Andri Hidalgo')[0].take.stance, 'none'); assert.equal(by('Cheap Guy')[0].take.stance, 'buy');
    assert.equal(by('Argenis Cayama').length, 1); assert.equal(by('Argenis Cayama')[0].take.summary, 'a much longer take about him'); assert.equal(by('Argenis Cayama')[0].rankings[0].rank, 52);
    assert.equal(by('Josh Owens').length, 2);   // two-way player stays two entries
  } finally { globalThis.fetch = realFetch; }
});

await t('his full analysis is saved apart from the summary and reaches the export; imported notes count as analysis', async () => {
  const env = { DB: makeDb() };
  const ex = { title: 'Pitcher Rankings', post_type: 'analysis', summary: 's', published_date: '2026-10-16', players: [
    { name: 'Argenis Cayama', side: 'pitcher', rankings: [{ list: 'hobby rank', rank: 52 }], take: { stance: 'none', summary: 'Author is very high on him.', analysis: 'Para one.\n\nPara two, word for word.', key_points: [] } }] };
  const { postId } = await submitPost(env, { text: POST_TEXT + ' analysis', extractor: async () => ({ extraction: sanitizeExtraction(ex), model: 'fake' }) });
  assert.equal((await listPendingPosts(env)).posts[0].extraction.players[0].take.analysis, 'Para one.\n\nPara two, word for word.');
  await confirmPost(env, postId);
  const out = await exportForApp(env); const h = [...out.hotsheet, ...out.buyScores, ...out.top100, ...out.top200, ...out.players].find(x => x.name === 'Argenis Cayama');
  assert.ok(!JSON.stringify(out).includes('Para one') && !JSON.stringify(out).includes('very high on him'));   // the startup export carries no text
  const pt = await playerTakes(env, 'Argenis Cayama', 0, 3);
  assert.equal(pt.total, 1); assert.equal(pt.latest.note.analysis, 'Para one.\n\nPara two, word for word.'); assert.equal(pt.latest.summary.summary, 'Author is very high on him.');
  assert.equal(pt.takes[0].analysis, 'Para one.\n\nPara two, word for word.'); assert.equal((await playerTakes(env, 'Argenis Cayama', 1, 3)).takes.length, 0);
  assert.equal((await playerTakes(env, 'Nobody Here')).found, false);
  const d = await postDetail(env, postId); assert.equal(d.players[0].take.analysis, 'Para one.\n\nPara two, word for word.');
  assert.equal(sanitizeExtraction({ players: [{ name: 'A B', take: { summary: 'x' } }] }).players[0].take.analysis, null);
});

console.log(`\n${passed} tests passed`);
