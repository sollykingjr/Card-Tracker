// ── prospect-current.js — the one-row-per-player table the app reads first (see db/schema-prospects.sql).
// Rebuilt in full from the history tables, so it is always right and can be re-run any time. Nothing in the history tables is changed.
const LISTS = `'hobby rank','top 200 hitters','top 100 pitchers'`;
const TOP = `'top 200 hitters','top 100 pitchers'`;

export const REFRESH_SQL = `
WITH
rk AS (SELECT prospect_id, rank, dated, list_name, ROW_NUMBER() OVER (PARTITION BY prospect_id ORDER BY dated DESC, (list_name IN (${TOP})) DESC, id DESC) rn
       FROM prospect_rankings WHERE list_name IN (${LISTS})),
sc AS (SELECT prospect_id, buy_rating, action, expected_cents, dated, ROW_NUMBER() OVER (PARTITION BY prospect_id ORDER BY dated DESC, id DESC) rn
       FROM prospect_snapshots WHERE buy_rating IS NOT NULL),
fd AS (SELECT list_name, dated FROM prospect_rankings WHERE list_name IN (${TOP}) GROUP BY list_name, dated
       HAVING SUM(CASE WHEN rank <= (CASE list_name WHEN 'top 200 hitters' THEN 200 ELSE 100 END) THEN 1 ELSE 0 END) >= (CASE list_name WHEN 'top 200 hitters' THEN 180 ELSE 90 END)),
la AS (SELECT r.prospect_id, r.list_name, r.dated, r.rank, ROW_NUMBER() OVER (PARTITION BY r.prospect_id ORDER BY r.dated DESC) rn
       FROM prospect_rankings r JOIN fd ON fd.list_name = r.list_name AND fd.dated = r.dated),
gr AS (SELECT la.prospect_id, (SELECT MIN(f2.dated) FROM fd f2 WHERE f2.list_name = la.list_name AND f2.dated > la.dated) missed
       FROM la WHERE la.rn = 1 AND la.rank <= (CASE la.list_name WHEN 'top 200 hitters' THEN 100 ELSE 50 END))
INSERT INTO prospect_current (prospect_id, side, team, age, age_dated, level, rank, rank_dated, rank_list, buy_rating, action, scored_dated,
  expected_cents, price_at_score_cents, price_cents, price_dated, last_note_dated, last_seen, graduated_auto, graduated_since, updated_at)
SELECT p.prospect_id,
  CASE WHEN EXISTS (SELECT 1 FROM prospect_rankings r WHERE r.prospect_id = p.prospect_id AND r.list_name = 'top 100 pitchers') THEN 'pitcher'
       WHEN EXISTS (SELECT 1 FROM prospect_rankings r WHERE r.prospect_id = p.prospect_id AND r.list_name = 'top 200 hitters') THEN 'hitter' ELSE p.side END,
  (SELECT team FROM prospect_snapshots s WHERE s.prospect_id = p.prospect_id AND s.team IS NOT NULL ORDER BY s.dated DESC, s.id DESC LIMIT 1),
  (SELECT age FROM prospect_snapshots s WHERE s.prospect_id = p.prospect_id AND s.age IS NOT NULL ORDER BY s.dated DESC, s.id DESC LIMIT 1),
  (SELECT dated FROM prospect_snapshots s WHERE s.prospect_id = p.prospect_id AND s.age IS NOT NULL ORDER BY s.dated DESC, s.id DESC LIMIT 1),
  (SELECT level FROM prospect_snapshots s WHERE s.prospect_id = p.prospect_id AND s.level IS NOT NULL ORDER BY s.dated DESC, s.id DESC LIMIT 1),
  rk.rank, rk.dated, rk.list_name,
  sc.buy_rating, sc.action, sc.dated,
  sc.expected_cents,
  (SELECT x.base_auto_cents FROM prospect_prices x WHERE x.prospect_id = p.prospect_id AND x.base_auto_cents IS NOT NULL AND x.dated <= sc.dated AND julianday(sc.dated) - julianday(x.dated) <= 3 ORDER BY x.dated DESC LIMIT 1),
  (SELECT x.base_auto_cents FROM prospect_prices x WHERE x.prospect_id = p.prospect_id AND x.base_auto_cents IS NOT NULL ORDER BY x.dated DESC, x.id DESC LIMIT 1),
  (SELECT x.dated FROM prospect_prices x WHERE x.prospect_id = p.prospect_id AND x.base_auto_cents IS NOT NULL ORDER BY x.dated DESC, x.id DESC LIMIT 1),
  (SELECT MAX(t.dated) FROM prospect_takes t WHERE t.prospect_id = p.prospect_id AND t.analysis IS NOT NULL),
  NULLIF(MAX(COALESCE((SELECT MAX(dated) FROM prospect_snapshots WHERE prospect_id = p.prospect_id), ''), COALESCE((SELECT MAX(dated) FROM prospect_prices WHERE prospect_id = p.prospect_id), ''),
     COALESCE((SELECT MAX(dated) FROM prospect_rankings WHERE prospect_id = p.prospect_id), ''), COALESCE((SELECT MAX(dated) FROM prospect_takes WHERE prospect_id = p.prospect_id), '')), ''),
  CASE WHEN gr.missed IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prospect_rankings r2 WHERE r2.prospect_id = p.prospect_id AND r2.dated >= gr.missed AND r2.list_name IN (${LISTS})) THEN 1 ELSE 0 END,
  CASE WHEN gr.missed IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prospect_rankings r2 WHERE r2.prospect_id = p.prospect_id AND r2.dated >= gr.missed AND r2.list_name IN (${LISTS})) THEN gr.missed END,
  datetime('now')
FROM prospects p
LEFT JOIN rk ON rk.prospect_id = p.prospect_id AND rk.rn = 1
LEFT JOIN sc ON sc.prospect_id = p.prospect_id AND sc.rn = 1
LEFT JOIN gr ON gr.prospect_id = p.prospect_id
WHERE true
ON CONFLICT(prospect_id) DO UPDATE SET side = excluded.side, team = excluded.team, age = excluded.age, age_dated = excluded.age_dated, level = excluded.level,
  rank = excluded.rank, rank_dated = excluded.rank_dated, rank_list = excluded.rank_list, buy_rating = excluded.buy_rating, action = excluded.action,
  scored_dated = excluded.scored_dated, expected_cents = excluded.expected_cents, price_at_score_cents = excluded.price_at_score_cents,
  price_cents = excluded.price_cents, price_dated = excluded.price_dated, last_note_dated = excluded.last_note_dated, last_seen = excluded.last_seen,
  graduated_auto = excluded.graduated_auto, graduated_since = excluded.graduated_since, updated_at = excluded.updated_at`;

export const PRUNE_SQL = `DELETE FROM prospect_current WHERE prospect_id NOT IN (SELECT prospect_id FROM prospects)`;

export async function refreshCurrent(env) {
  await env.DB.batch([env.DB.prepare(REFRESH_SQL), env.DB.prepare(PRUNE_SQL)]);
}

// His switch in the player modal: true = graduated, false = not graduated, null = back to the automatic rule.
export async function setGraduated(env, prospectId, value) {
  const v = value === true || value === 1 ? 1 : value === false || value === 0 ? 0 : null;
  const r = await env.DB.prepare(`UPDATE prospect_current SET graduated_manual = ? WHERE prospect_id = ?`).bind(v, prospectId).run();
  if (!r.meta.changes) throw new Error('player not found');
  return { ok: true, graduated_manual: v };
}

export async function listCurrent(env) {
  const { results } = await env.DB.prepare(`SELECT c.*, p.name, COALESCE(c.graduated_manual, c.graduated_auto) AS graduated,
    (SELECT s.buy_rating FROM prospect_snapshots s WHERE s.prospect_id = c.prospect_id AND s.buy_rating IS NOT NULL AND s.dated < c.scored_dated ORDER BY s.dated DESC, s.id DESC LIMIT 1) AS prev_buy_rating,
    (SELECT s.dated FROM prospect_snapshots s WHERE s.prospect_id = c.prospect_id AND s.buy_rating IS NOT NULL AND s.dated < c.scored_dated ORDER BY s.dated DESC, s.id DESC LIMIT 1) AS prev_scored_dated,
    (SELECT substr(COALESCE(t.summary, t.analysis), 1, 280) FROM prospect_takes t WHERE t.prospect_id = c.prospect_id AND COALESCE(t.summary, t.analysis) IS NOT NULL ORDER BY t.dated DESC, t.id DESC LIMIT 1) AS latest_note,
    (SELECT t.dated FROM prospect_takes t WHERE t.prospect_id = c.prospect_id AND COALESCE(t.summary, t.analysis) IS NOT NULL ORDER BY t.dated DESC, t.id DESC LIMIT 1) AS latest_note_dated
    FROM prospect_current c JOIN prospects p USING (prospect_id)`).all();
  return { players: results };
}
