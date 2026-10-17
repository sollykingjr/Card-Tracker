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
  input_tokens INTEGER, output_tokens INTEGER,   -- what the extraction call used (added 2026-10-15 via ALTER on the live DB)
  cost_micros INTEGER,                           -- cost in millionths of a dollar at the rate in effect when it ran
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
  summary TEXT,                          -- short summary written by the model
  analysis TEXT,                         -- his own words about the player, copied from the post (or the original note for imported rows)
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

-- Per-player facts as of a post/date: age, level, his Buy Rating and the Action label beside it (added 2026-10-15).
CREATE TABLE IF NOT EXISTS prospect_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL,
  prospect_id TEXT NOT NULL,
  dated TEXT,
  team TEXT,
  age REAL,
  level TEXT,
  buy_rating REAL,                       -- his 1-5 Buy Rating / Buy Score
  action TEXT                            -- e.g. 'Strongest Buy', 'Slightly Overvalued'
);
CREATE INDEX IF NOT EXISTS idx_snapshots_prospect ON prospect_snapshots(prospect_id, dated);

-- Spellings he got wrong that you confirmed are the same player ("Angeibel Gomez" -> angeibel gomez's real record). Next time that spelling matches on its own.
CREATE TABLE IF NOT EXISTS prospect_aliases (
  alias_norm TEXT NOT NULL,
  prospect_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (alias_norm, prospect_id)
);

-- One row per player with what the app needs first: his latest Buy Score (with the Expected Value and price from the day he scored it),
-- the newest price, the newest rank, age/level/team, and Graduated. Rebuilt from the history tables whenever a post is confirmed (added 2026-10-17).
CREATE TABLE IF NOT EXISTS prospect_current (
  prospect_id TEXT PRIMARY KEY,
  side TEXT,                             -- hitter | pitcher
  team TEXT, age REAL, age_dated TEXT, level TEXT,
  rank INTEGER, rank_dated TEXT, rank_list TEXT,   -- newest rank from a hot sheet ("hobby rank") or a Top 200/100 post: same ranking, different labels
  buy_rating REAL, action TEXT, scored_dated TEXT, -- his latest Buy Score and the date he gave it
  expected_cents INTEGER, price_at_score_cents INTEGER,   -- Expected Value and base auto price around that date
  price_cents INTEGER, price_dated TEXT,           -- newest price from any post
  last_note_dated TEXT, last_seen TEXT,
  graduated_auto INTEGER NOT NULL DEFAULT 0, graduated_since TEXT,   -- was top 100 hitter / top 50 pitcher, then missing from the next full list
  graduated_manual INTEGER,                        -- his switch in the player modal: 1 graduated, 0 not, NULL follow the automatic rule
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
