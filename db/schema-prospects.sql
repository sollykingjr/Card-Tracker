-- Prospect data (prospect-analytics posts). Additive only: new tables, nothing existing is touched.
-- Money stored as integer cents, same as the card tables.
CREATE TABLE IF NOT EXISTS prospects (
  prospect_id TEXT PRIMARY KEY,          -- slug of normalized name, with -2, -3 if two players collide
  name TEXT NOT NULL,
  norm_name TEXT NOT NULL,               -- lowercase, no accents/punctuation/Jr/Sr, used for matching
  org TEXT,                              -- latest team abbreviation seen
  side TEXT CHECK (side IN ('hitter','pitcher')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prospects_norm ON prospects(norm_name);

-- One row per post/email. The full original text is always kept so it can be re-extracted later.
CREATE TABLE IF NOT EXISTS prospect_posts (
  post_id TEXT PRIMARY KEY,              -- sha-256 of the raw text: re-sending the same post never duplicates
  source TEXT NOT NULL DEFAULT 'prospect-analytics',
  title TEXT,
  post_type TEXT,                        -- analysis | rankings | hot_sheet | price_update | other
  published_at TEXT,                     -- YYYY-MM-DD
  raw_text TEXT NOT NULL,
  image_urls TEXT,                       -- JSON array of screenshot URLs, if any
  summary TEXT,
  thesis TEXT,
  extraction_json TEXT,                  -- what the model returned, shown on the review screen
  model TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_status ON prospect_posts(status);

-- His take on a player in a post (the analysis that used to get lost in a notes column).
CREATE TABLE IF NOT EXISTS prospect_takes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL,
  prospect_id TEXT NOT NULL,
  stance TEXT,                           -- buy | hold | sell | watch | avoid | none
  summary TEXT,
  key_points TEXT,                       -- JSON array of short strings
  post_rank INTEGER,                     -- position within that post's list, if it had one
  dated TEXT
);
CREATE INDEX IF NOT EXISTS idx_takes_prospect ON prospect_takes(prospect_id, dated);

CREATE TABLE IF NOT EXISTS prospect_rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL,
  prospect_id TEXT NOT NULL,
  list_name TEXT NOT NULL,               -- e.g. 'hobby hitters', 'hobby pitchers'
  rank INTEGER NOT NULL,
  dated TEXT
);
CREATE INDEX IF NOT EXISTS idx_rankings_prospect ON prospect_rankings(prospect_id, dated);

CREATE TABLE IF NOT EXISTS prospect_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL,
  prospect_id TEXT NOT NULL,
  dated TEXT NOT NULL,                   -- the date the price applies to (a post can carry two: current and prior)
  base_auto_cents INTEGER,
  expected_cents INTEGER
);
CREATE INDEX IF NOT EXISTS idx_prices_prospect ON prospect_prices(prospect_id, dated);

-- Performance lines (AFL, regular season, etc). Stats vary by post, so they are stored as JSON.
CREATE TABLE IF NOT EXISTS prospect_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL,
  prospect_id TEXT NOT NULL,
  dated TEXT,
  context TEXT,                          -- e.g. 'AFL 2026', '2026 season'
  level TEXT,                            -- e.g. 'A/A+', 'AFL'
  age REAL,
  stats_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stats_prospect ON prospect_stats(prospect_id, dated);
