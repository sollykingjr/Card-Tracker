// Local simulation: runs worker/prospects.js against an in-memory SQLite that mimics the D1 API.
// Run: node --no-warnings tests/prospects.test.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { refreshCurrent, setGraduated, listCurrent } from '../worker/prospect-current.js';
import { typoMatch, submitPost, listPendingPosts, confirmPost, rejectPost, prospectDetail, sanitizeExtraction, normName, handleProspects, costMicros, usageSummary, exportForApp, playerTakes, listPosts, postDetail, htmlToText, emailImageUrls, submitEmail, extractWithClaude, reviewFlags, stanceFromTable, notifyNewPost } from '../worker/prospects.js';

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
      take: { stance: 'buy', summary: 'Elite pull-air rate and strong contact; power should come as he gets stronger.' } },
    { name: 'Handelfry Encarnacion', team: 'MIL', side: 'hitter', age: 19.3, post_rank: 2, rankings: [{ list: 'hobby hitters', rank: 137 }],
      prices: [{ date: '2026-10-14', base_auto: 10.10 }],
      take: { stance: 'buy', summary: 'Well-rounded, advanced zone feel; hype faded so the price dipped.' } },
    { name: 'Devin Fitz-Gerald', team: 'WAS', side: 'hitter', age: 21.2, post_rank: 1, rankings: [{ list: 'hobby hitters', rank: 53 }],
      prices: [{ date: '2026-10-14', base_auto: 15.79 }],
      take: { stance: 'buy', summary: 'Promoted aggressively and struggled; finished strong. Price never recovered.' } }
  ]
};
const AFL = {
  title: 'Arizona Fall League - Hot & Cold', post_type: 'hot_sheet', published_date: '2026-10-13',
  summary: 'AFL hot and cold Bowman bats and arms with price changes since opening weekend.',
  players: [
    { name: 'Jhonny Severino', team: 'PIT', side: 'hitter', age: 21.9, rankings: [{ list: 'hobby hitters', rank: 228 }],
      prices: [{ date: '2026-10-12', base_auto: 25.93 }, { date: '2026-10-03', base_auto: 5.41 }],
      take: { stance: 'watch', summary: 'Price up nearly 400% in ten days with no clear catalyst.' } },
    { name: 'Caleb Bonemer', team: 'CHW', side: 'hitter', age: 21.0, rankings: [{ list: 'hobby hitters', rank: 7 }],
      prices: [{ date: '2026-10-12', base_auto: 66.20, expected: 107.80 }, { date: '2026-10-03', base_auto: 70.17 }],
      take: { stance: 'buy', summary: 'Hitting over 1.000 OPS yet price fell; already a buy.' } },
    { name: 'Jarlin Susana', team: 'WAS', side: 'pitcher', age: 22.6, rankings: [{ list: 'hobby pitchers', rank: 3 }],
      prices: [{ date: '2026-10-12', base_auto: 57.86 }, { date: '2026-10-03', base_auto: 45.39 }] }
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
      rankings: [{ list: 'MLB', rank: 'x' }, { list: 'MLB', rank: 7 }], take: { stance: 'moon', summary: 'hi' } }]
  });
  assert.equal(ex.post_type, 'other');
  assert.equal(ex.players.length, 1);
  const p = ex.players[0];
  assert.equal(p.age, null);
  assert.deepEqual(p.prices, [{ date: '2026-10-12', base_auto_cents: 499, expected_cents: null }]);
  assert.deepEqual(p.rankings, [{ list: 'MLB', rank: 7 }]);
  assert.equal(p.take.stance, 'none');
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
  assert.deepEqual(c.counts, { prospects: 3, takes: 3, rankings: 3, prices: 3, snapshots: 3 });
  assert.equal((await listPendingPosts(env)).pending, 0);
  const d = await prospectDetail(env, 'ramiro dominguez');
  assert.equal(d.matches[0].prospect.org, 'MIN');
  assert.equal(d.matches[0].prices[0].base_auto_cents, 421);
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
  const withFitz = { ...AFL, players: [...AFL.players, { name: 'Devin Fitz-Gerald', team: 'WAS', take: { stance: 'hold', summary: 'Quiet AFL.' } }] };
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
    INSERT INTO prospect_takes (post_id, prospect_id, stance, analysis, dated) VALUES ('pa','dax-kilby','none','Long baseline note','2026-03-12');
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
  assert.deepEqual(c.players[2].rankings, [{ list: 'top 200 hitters', rank: 260 }]);   // past 200 is still his rank, kept
   assert.deepEqual(c.players[3].rankings, [{ list: 'top 200 hitters', rank: 77 }]);
  const o = sanitizeExtraction({ title: 'Hot Sheet', summary: 's', players: [{ name: 'E Five', rankings: [{ list: 'Rank', rank: 9 }] }] });
  assert.deepEqual(o.players[0].rankings, []); assert.deepEqual(o.ignored_ranks, { Rank: 1 });   // a bare Rank is not a hobby rank: not saved, listed on the card
  const h = sanitizeExtraction({ title: 'Hot Sheet', summary: 's', players: [{ name: 'F Six', rankings: [{ list: 'Hobby', rank: 14 }, { list: 'Hobby Rank', rank: 14 }, { list: 'mlb', rank: 3 }] }] });
  assert.deepEqual(h.players[0].rankings, [{ list: 'hobby rank', rank: 14 }, { list: 'MLB', rank: 3 }]);   // same list twice is one ranking
});

await t('only a column named hobby is hobby rank; rankings mentioned in an article\'s prose are not saved', () => {
  const art = sanitizeExtraction({ title: 'Bowman Chrome Sleepers', post_type: 'analysis', summary: 's', players: [{ name: 'Darell Morel', rankings: [{ list: 'MLB Pipeline org', rank: 22 }, { list: 'Baseball America', rank: 90 }, { list: 'Hobby Ranking', rank: 259 }] }] });
  assert.deepEqual(art.players[0].rankings, [{ list: 'hobby rank', rank: 259 }]);
  const bare = sanitizeExtraction({ title: 'Bowman Chrome Rankings', post_type: 'rankings', summary: 's', players: [{ name: 'Darell Morel', rankings: [{ list: 'Rank', rank: 5 }] }] });
  assert.deepEqual(bare.players[0].rankings, []);   // not hobby, not a known list: ignored
  const col = sanitizeExtraction({ title: 'Hitter Hot Sheet - Week 23', post_type: 'hot_sheet', summary: 's', players: [{ name: 'Darell Morel', rankings: [{ list: 'MLB', rank: 4 }, { list: 'Rank', rank: 5 }] }] });
  assert.deepEqual(col.players[0].rankings, [{ list: 'MLB', rank: 4 }]);   // known third-party columns still count; bare Rank does not
});

await t('a players list handed back as a JSON string still counts', () => {
  const o = sanitizeExtraction({ title: 'T', post_type: 'analysis', summary: 's', players: JSON.stringify([{ name: 'Joseph Sullivan', team: 'HOU' }]) });
  assert.equal(o.players.length, 1);
});

await t('typos: one-letter spellings are the same player, rank slot and age decide the rest', () => {
  assert.ok(typoMatch('Angelbel Gomez', 'Angeibel Gomez') && typoMatch('Johnssy Colome', 'Johenssy Colome'));
  assert.ok(!typoMatch('Gavin Fien', 'Gavin Kilen') && !typoMatch('Luis Hernandez', 'Luis Perez'));
  const d = sanitizeExtraction({ title: 'Top 200 Hitters', post_type: 'rankings', summary: 's', players: [
    { name: 'Austin Overn', age: 21.1, post_rank: 129 }, { name: 'Austin Ovem', age: 21.1, post_rank: 129, buy_rating: 3.2 },
    { name: 'Angelbel Gomez', age: 18.6, post_rank: 20 }, { name: 'Angeibel Gomez', age: 18.6 },
    { name: 'Marcos Silva', age: 18.0 }, { name: 'Marcos Silvas', age: 24.0 }] });
  assert.deepEqual(d.players.map(p => p.name), ['Austin Overn', 'Angelbel Gomez', 'Marcos Silva', 'Marcos Silvas']);   // the last two are 6 years apart: different players
  assert.equal(d.players[0].buy_rating, 3.2);
});

await t('across posts: a typo is suggested, confirming it links the player and remembers the spelling', async () => {
  const env = { DB: makeDb() };
  const mk = (name, extra = {}) => ({ post_type: 'analysis', published_date: '2026-10-14', summary: 's', players: [{ name, team: 'KC', age: 18.6, side: 'hitter', prices: [{ date: '2026-10-14', base_auto: 50 }], ...extra }] });
  const first = await submitPost(env, { text: POST_TEXT + ' one', extractor: fakeExtractor(mk('Angeibel Gomez')) });
  await confirmPost(env, first.postId);
  const second = await submitPost(env, { text: POST_TEXT + ' two', extractor: fakeExtractor(mk('Angelbel Gomez')) });
  const m = (await listPendingPosts(env)).posts[0].matches[0];
  assert.equal(m.status, 'suggest'); assert.equal(m.suggestion.name, 'Angeibel Gomez');
  const ex = JSON.parse(JSON.stringify((await listPendingPosts(env)).posts[0].extraction)); ex.players[0].match_id = m.suggestion.prospect_id;
  const c = await confirmPost(env, second.postId, ex);
  assert.equal(c.counts.prospects, 1);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM prospects').first()).n, 1);   // linked, not a second player
  const third = await submitPost(env, { text: POST_TEXT + ' three', extractor: fakeExtractor(mk('Angelbel Gomez')) });
  assert.equal((await listPendingPosts(env)).posts[0].matches[0].status, 'existing');   // the spelling is remembered
});

await t('same name on two players: age picks the right one', async () => {
  const env = { DB: makeDb() };
  const db = env.DB._raw;
  db.exec(`INSERT INTO prospects (prospect_id, name, norm_name, org, side) VALUES ('luis-hernandez','Luis Hernandez','luis hernandez','SF','hitter'),('luis-hernandez-2','Luis Hernandez','luis hernandez','SF','pitcher');
    INSERT INTO prospect_snapshots (post_id, prospect_id, dated, age) VALUES ('x','luis-hernandez','2026-10-01',19.0),('x','luis-hernandez-2','2026-10-01',24.0);`);
  const mk = age => ({ post_type: 'analysis', published_date: '2026-10-14', summary: 's', players: [{ name: 'Luis Hernandez', team: 'SF', age }] });
  await submitPost(env, { text: POST_TEXT + ' a', extractor: fakeExtractor(mk(19.1)) });
  assert.equal((await listPendingPosts(env)).posts[0].matches[0].prospect_id, 'luis-hernandez');
});

await t('players with no rank are only a note when the list itself is complete', () => {
  const mk = n => Array.from({ length: n }, (_, i) => ({ name: 'Player Number' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26)), rankings: [{ list: 'top 200 hitters', rank: i + 1 }] }));
  const extra = { name: 'Kyle Lodise', rankings: [], prices: [{ date: '2026-09-11', base_auto_cents: 500 }] };
  const full = reviewFlags({ title: 'Top 200 Hitters', players: [...mk(200), extra] }).find(f => /no top 200 hitters rank/.test(f.text));
  assert.equal(full.level, 'info'); assert.ok(full.players.includes('Kyle Lodise'));
  const gap = reviewFlags({ title: 'Top 200 Hitters', players: [...mk(150), extra] }).find(f => /no top 200 hitters rank/.test(f.text));
  assert.equal(gap.level, 'warn');
});

await t('dated price-rank columns are not saved, and a price dated last year on a 2026 post is moved to 2026', () => {
  const o = sanitizeExtraction({ title: 'Two Week Review', post_type: 'hot_sheet', published_date: '2026-09-24', summary: 's', players: [
    { name: 'Angelbel Gomez', rankings: [{ list: 'Rank', rank: 19 }, { list: '9/17 rank', rank: 3 }, { list: '9/24 Rank', rank: 2 }, { list: 'hobby rank', rank: 19 }],
      prices: [{ date: '2025-09-17', base_auto: 132.35 }, { date: '2025-09-24', base_auto: 108.44 }, { date: '2026-09-24', base_auto: 108.44, expected: 73.8 }] },
    { name: 'Old Price', prices: [{ date: '2026-03-02', base_auto: 5 }] }] });
  assert.deepEqual(o.players[0].rankings, [{ list: 'hobby rank', rank: 19 }]);
  assert.deepEqual(o.players[0].prices, [{ date: '2026-09-17', base_auto_cents: 13235, expected_cents: null }, { date: '2026-09-24', base_auto_cents: 10844, expected_cents: 7380 }]);
  assert.equal(o.players[1].prices[0].date, '2026-03-02');   // a genuinely older price keeps its date
});

await t('only hobby, his own list and known third-party lists are saved; others are ignored and listed', () => {
  const o = sanitizeExtraction({ title: 'AFL Hot Sheet', post_type: 'hot_sheet', summary: 's', players: [
    { name: 'Gavin Fien', rankings: [{ list: 'AFL Table Rank', rank: 3 }, { list: 'Hobby Rank', rank: 41 }, { list: 'Baseball America', rank: 77 }, { list: 'Mystery List', rank: 4 }] },
    { name: 'Eli Willits', rankings: [{ list: 'AFL Table Rank', rank: 9 }] }] });
  assert.deepEqual(o.players[0].rankings, [{ list: 'hobby rank', rank: 41 }, { list: 'BA', rank: 77 }]);
  assert.deepEqual(o.ignored_ranks, { 'AFL Table Rank': 2, 'Mystery List': 1 });
  assert.ok(reviewFlags(o).some(f => f.level === 'info' && /AFL Table Rank \(2\)/.test(f.text)));
  assert.deepEqual(sanitizeExtraction(JSON.parse(JSON.stringify(o))).ignored_ranks, o.ignored_ranks);   // cleaning twice does not double count
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
  assert.doesNotMatch(all, /Odd Rank/);   // a rank past 200 is kept, not flagged
  assert.match(all, /used twice: #20/);
  assert.match(all, /no top 200 hitters rank: .*No Rank/); assert.match(all, /ranks? missing from 1-200/); assert.match(all, /Possible duplicate players: Ralphy Velasquez \/ Ralphy Velazquez/);
  assert.match(all, /buy rating 7/); assert.match(all, /Name matches several/);
  assert.ok(f.find(x => /Weird Values/.test(x.text)).players.includes('Weird Values'));
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
    { name: 'Argenis Cayama', side: 'pitcher', rankings: [{ list: 'hobby rank', rank: 52 }], take: { stance: 'none', summary: 'Author is very high on him.', analysis: 'Para one.\n\nPara two, word for word.' } }] };
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

await t('Pushover alert goes out for a new post, never for a duplicate, and a failure never breaks the post', async () => {
  const sent = []; const notifyFetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true }; };
  const extractor = async () => ({ extraction: sanitizeExtraction({ title: 'Cayama post', post_type: 'analysis', summary: 's', published_date: '2026-10-16', players: [{ name: 'Argenis Cayama', take: { stance: 'none', summary: 'x' } }] }), model: 'fake' });
  const off = { DB: makeDb() };   // no Pushover secrets: silent
  await submitPost(off, { text: POST_TEXT + ' push-off', extractor, deps: { notifyFetch } }); assert.equal(sent.length, 0);
  const env = { DB: makeDb(), PUSHOVER_TOKEN: 'tok', PUSHOVER_USER: 'usr' };
  await submitPost(env, { text: POST_TEXT + ' push-on', extractor, deps: { notifyFetch } });
  assert.equal(sent.length, 1); assert.equal(sent[0].url, 'https://api.pushover.net/1/messages.json');
  assert.equal(sent[0].body.token, 'tok'); assert.equal(sent[0].body.user, 'usr'); assert.match(sent[0].body.title, /Cayama post/); assert.match(sent[0].body.message, /1 player · 1 with analysis/);
  await submitPost(env, { text: POST_TEXT + ' push-on', extractor, deps: { notifyFetch } }); assert.equal(sent.length, 1);   // duplicate: no second alert
  const boom = async () => { throw new Error('network down'); };
  const r = await submitPost(env, { text: POST_TEXT + ' push-boom', extractor, deps: { notifyFetch: boom } }); assert.equal(r.status, 'pending');
  assert.equal(await notifyNewPost(env, { players: [] }, [], async () => ({ ok: false })), false);
});

await t('screenshots in a long prose article are not sent to the model, short table posts still send them', async () => {
  const realFetch = globalThis.fetch; const seen = [];
  globalThis.fetch = async (url, init) => { seen.push(JSON.parse(init.body).messages[0].content.filter(b => b.type === 'image').length);
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'record_post', input: { post_type: 'analysis', summary: 'Article.', players: [{ name: 'Edward Florentino' }] } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }); };
  try {
    const img = { media_type: 'image/png', base64: 'AAAA' };
    const long = await extractWithClaude({ ANTHROPIC_API_KEY: 'k' }, { text: 'word '.repeat(2000), images: [img, img, img] });
    assert.deepEqual(seen, [0]); assert.match(long.extraction.summary, /3 screenshots were not read because this is a long article/);
    seen.length = 0; await extractWithClaude({ ANTHROPIC_API_KEY: 'k' }, { text: 'word '.repeat(2000) + ' base auto base auto base auto base auto base auto base auto base auto base auto prices, buy rating and expected value tables below', images: [img, img, img] });
    assert.deepEqual(seen.sort(), [0, 1, 1, 1]);   // a long post that talks about base autos still has its 3 screenshots read (text pass + one pass per image)
    seen.length = 0; await extractWithClaude({ ANTHROPIC_API_KEY: 'k' }, { text: 'word '.repeat(300), images: [img] });
    assert.deepEqual(seen, [1]);
  } finally { globalThis.fetch = realFetch; }
});

await t('one price row per player and date: a repeat from another post (or the same post) only fills in what is missing', async () => {
  const env = { DB: makeDb() }, raw = env.DB._raw;
  const mk = prices => ({ post_type: 'rankings', summary: 's', published_date: '2026-08-14', players: [{ name: 'Bo Davidson', team: 'ATL', prices }] });
  const a = await submitPost(env, { text: 'x'.repeat(50) + 'one', extractor: fakeExtractor(mk([{ date: '2026-08-14', base_auto: 25.07 }])) });
  await confirmPost(env, a.postId);
  const b = await submitPost(env, { text: 'x'.repeat(50) + 'two', extractor: fakeExtractor(mk([{ date: '2026-08-14', base_auto: 25.07, expected: 40 }])) });
  await confirmPost(env, b.postId);
  let rows = raw.prepare('SELECT base_auto_cents b, expected_cents e FROM prospect_prices').all();
  assert.equal(rows.length, 1); assert.equal(rows[0].b, 2507); assert.equal(rows[0].e, 4000);   // second post only added the Expected value
  const c = await submitPost(env, { text: 'x'.repeat(50) + 'three', extractor: fakeExtractor(mk([{ date: '2026-08-14', base_auto: 25.07, expected: 40 }])) });
  await confirmPost(env, c.postId);
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM prospect_prices').get().n, 1);   // an identical repeat adds nothing
  const two = { post_type: 'rankings', summary: 's', published_date: '2026-09-11', players: [   // same player listed twice in one post, once with the Expected value
    { name: 'Coy James', team: 'MIA', prices: [{ date: '2026-09-11', base_auto: 5.71 }] },
    { name: 'Coy James', team: 'MIA', prices: [{ date: '2026-09-11', base_auto: 5.71, expected: 17.4 }] }] };
  const d = await submitPost(env, { text: 'x'.repeat(50) + 'four', extractor: fakeExtractor(two) });
  await confirmPost(env, d.postId);
  rows = raw.prepare("SELECT base_auto_cents b, expected_cents e FROM prospect_prices WHERE dated = '2026-09-11'").all();
  assert.equal(rows.length, 1); assert.equal(rows[0].e, 1740);
});

await t('current-state row: score with its own price and date, newest price and rank, graduated from the full lists, manual switch', async () => {
  const env = { DB: makeDb() }, raw = env.DB._raw;
  const hit = (id, nm) => `('${id}','${nm}','${nm.toLowerCase()}','ATL','hitter')`;
  raw.exec(`INSERT INTO prospects (prospect_id, name, norm_name, org, side) VALUES ${hit('ann-a','Ann A')}, ${hit('bob-b','Bob B')}, ${hit('cal-c','Cal C')}, ${hit('dan-d','Dan D')}, ${hit('eli-e','Eli E')};
    INSERT INTO prospect_posts (post_id, title, post_type, published_at, raw_text, status) VALUES ('p1','Top 200 · 9/1','rankings','2026-09-01','x','confirmed'),('p2','Top 200 · 9/15','rankings','2026-09-15','x','confirmed'),('p3','Hot Sheet · 9/22','hot_sheet','2026-09-22','x','confirmed'),('p4','Analysis · 10/1','analysis','2026-10-01','x','confirmed');`);
  // two full 200-player lists; Ann (#40) and Dan (#150) drop off the second, Bob stays, Cal is #30 on the first only (also dropped), Eli never listed
  const filler = (post, date, from, to) => { for (let r = from; r <= to; r++) raw.exec(`INSERT INTO prospects (prospect_id, name, norm_name) VALUES ('f${r}-${post}','F ${r} ${post}','f ${r} ${post}') ON CONFLICT DO NOTHING; INSERT INTO prospect_rankings (post_id, prospect_id, list_name, rank, dated) VALUES ('${post}','f${r}-${post}','top 200 hitters',${r},'${date}')`); };
  filler('p1', '2026-09-01', 1, 199); filler('p2', '2026-09-15', 1, 199);
  raw.exec(`INSERT INTO prospect_rankings (post_id, prospect_id, list_name, rank, dated) VALUES
    ('p1','ann-a','top 200 hitters',40,'2026-09-01'),('p1','dan-d','top 200 hitters',150,'2026-09-01'),('p1','cal-c','top 200 hitters',30,'2026-09-01'),('p1','bob-b','top 200 hitters',60,'2026-09-01'),
    ('p2','bob-b','top 200 hitters',55,'2026-09-15'),('p3','bob-b','hobby rank',47,'2026-09-22');
    INSERT INTO prospect_snapshots (post_id, prospect_id, dated, team, age, level, buy_rating, action) VALUES
    ('p2','bob-b','2026-09-15','ATL',20.1,'A+',4.4,'Strong Buy'),('p3','bob-b','2026-09-22','ATL',20.2,NULL,NULL,NULL),('p4','eli-e','2026-10-01','SEA',22,'AA',NULL,NULL);
    INSERT INTO prospect_prices (post_id, prospect_id, dated, base_auto_cents, expected_cents) VALUES
    ('p2','bob-b','2026-09-15',2500,4000),('p3','bob-b','2026-09-22',3100,NULL),('p4','eli-e','2026-10-01',900,NULL);
    INSERT INTO prospect_takes (post_id, prospect_id, stance, analysis, dated) VALUES ('p4','bob-b','none','His words','2026-10-01');`);
  await refreshCurrent(env);
  const by = Object.fromEntries((await listCurrent(env)).players.map(p => [p.prospect_id, p]));
  const b = by['bob-b'];
  assert.equal(b.buy_rating, 4.4); assert.equal(b.scored_dated, '2026-09-15'); assert.equal(b.expected_cents, 4000); assert.equal(b.price_at_score_cents, 2500);   // score stays with its own price and date
  assert.equal(b.price_cents, 3100); assert.equal(b.price_dated, '2026-09-22');                                                                              // newest price from a later post
  assert.equal(b.rank, 47); assert.equal(b.rank_list, 'hobby rank'); assert.equal(b.rank_dated, '2026-09-22');                                              // newest rank wins, whatever the label
  assert.equal(b.age, 20.2); assert.equal(b.level, 'A+'); assert.equal(b.team, 'ATL'); assert.equal(b.last_note_dated, '2026-10-01'); assert.equal(b.side, 'hitter');
  assert.equal(b.graduated, 0);
  assert.equal(by['ann-a'].graduated, 1); assert.equal(by['ann-a'].graduated_since, '2026-09-15');   // top 100 on the first full list, missing from the next
  assert.equal(by['cal-c'].graduated, 1);
  assert.equal(by['dan-d'].graduated, 0);                                                            // #150 dropping off is not a graduation
  assert.equal(by['eli-e'].graduated, 0); assert.equal(by['eli-e'].buy_rating, null); assert.equal(by['eli-e'].price_cents, 900);
  await setGraduated(env, 'ann-a', false); await setGraduated(env, 'dan-d', true); await refreshCurrent(env);   // his switch survives a rebuild
  const by2 = Object.fromEntries((await listCurrent(env)).players.map(p => [p.prospect_id, p]));
  assert.equal(by2['ann-a'].graduated, 0); assert.equal(by2['ann-a'].graduated_auto, 1); assert.equal(by2['dan-d'].graduated, 1);
  await setGraduated(env, 'ann-a', null); assert.equal((await listCurrent(env)).players.find(p => p.prospect_id === 'ann-a').graduated, 1);
  raw.exec(`INSERT INTO prospect_rankings (post_id, prospect_id, list_name, rank, dated) VALUES ('p3','ann-a','hobby rank',80,'2026-09-22')`);   // ranked again later: the tag clears
  await refreshCurrent(env);
  assert.equal((await listCurrent(env)).players.find(p => p.prospect_id === 'ann-a').graduated, 0);
  await assert.rejects(() => setGraduated(env, 'nobody', true));
});

console.log(`\n${passed} tests passed`);
