// Local simulation: runs worker/prospects.js against an in-memory SQLite that mimics the D1 API.
// Run: node --no-warnings tests/prospects.test.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { submitPost, listPendingPosts, confirmPost, rejectPost, prospectDetail, sanitizeExtraction, normName, handleProspects, costMicros, usageSummary, importSnapshot } from '../worker/prospects.js';

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

await t('sheet import: loads every snapshot in chunks, matches existing players, re-run adds nothing, half-done snapshot is redone', async () => {
  const data = JSON.parse(readFileSync(new URL('../data/prospect-import.json', import.meta.url), 'utf8'));
  const env = { DB: makeDb() };
  // a player already on file from an Inbox post must be matched, not duplicated
  const pre = await submitPost(env, { text: POST_TEXT + ' pre', extractor: fakeExtractor({ post_type: 'analysis', published_date: '2026-10-12', summary: 's', players: [{ name: 'Dax Kilby', team: 'NYY', side: 'hitter' }] }) });
  await confirmPost(env, pre.postId);
  const run = async () => {
    let skipped = 0, rows = 0;
    for (const sn of data.snapshots) {
      const key = sn.tab + ':' + sn.date;
      const st = await importSnapshot(env, { action: 'start', key, title: sn.title, post_type: sn.post_type, date: sn.date });
      if (st.skip) { skipped++; continue; }
      for (let i = 0; i < sn.players.length; i += 40) { await importSnapshot(env, { action: 'rows', key, players: sn.players.slice(i, i + 40) }); rows += Math.min(40, sn.players.length - i); }
      await importSnapshot(env, { action: 'finish', key, players: sn.players.length });
    }
    return { skipped, rows };
  };
  const n = x => env.DB._raw.prepare(`SELECT COUNT(*) n FROM ${x}`).get().n;
  const first = await run();
  const want = data.snapshots.reduce((a, sn) => { for (const p of sn.players) { a.take += p.note ? 1 : 0; a.rank += (p.rankings || []).length; a.price += (p.price != null || p.expected != null) ? 1 : 0; a.snap += (p.age != null || p.level || p.buy_rating != null || p.action) ? 1 : 0; a.players += 1; } return a; }, { take: 0, rank: 0, price: 0, snap: 0, players: 0 });
  assert.equal(first.skipped, 0); assert.equal(first.rows, want.players);
  assert.equal(n('prospect_takes'), want.take); assert.equal(n('prospect_rankings'), want.rank);
  assert.equal(n('prospect_prices'), want.price); assert.equal(n('prospect_snapshots'), want.snap);
  assert.equal(env.DB._raw.prepare(`SELECT COUNT(*) n FROM prospect_posts WHERE source = 'prospect-master-sheet' AND status = 'confirmed'`).get().n, data.snapshots.length);
  const dax = env.DB._raw.prepare(`SELECT COUNT(*) n FROM prospects WHERE norm_name = 'dax kilby'`).get().n;
  assert.equal(dax, 1);
  const before = [n('prospects'), n('prospect_takes'), n('prospect_prices')];
  const second = await run();
  assert.equal(second.skipped, data.snapshots.length); assert.deepEqual([n('prospects'), n('prospect_takes'), n('prospect_prices')], before);
  // half-done: leave one snapshot unfinished, run again -> it is redone without doubling its rows
  const sn = data.snapshots[0], key = sn.tab + ':' + sn.date, pid = env.DB._raw.prepare(`SELECT post_id FROM prospect_posts WHERE title = ?`).get(sn.title).post_id;
  env.DB._raw.prepare(`UPDATE prospect_posts SET status = 'rejected' WHERE post_id = ?`).run(pid);
  const pricesBefore = n('prospect_prices');
  await run();
  assert.equal(n('prospect_prices'), pricesBefore);
  assert.equal((await listPendingPosts(env)).pending, 0);   // imports never show up in the Inbox review list
});

console.log(`\n${passed} tests passed`);
