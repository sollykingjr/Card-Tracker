-- card-tracker-staging D1 schema (applied 2026-10-03). Money stored as integer cents.
CREATE TABLE cards (
  item_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'owned',
  file_name TEXT,
  sport TEXT, year TEXT, set_name TEXT, variation TEXT, version TEXT,
  card_no TEXT, player_name TEXT, serial_no TEXT, qty_manufactured TEXT, grade TEXT,
  purchase_item_cents INTEGER, purchase_shipping_cents INTEGER, purchase_tax_cents INTEGER, purchase_price_cents INTEGER,
  date_purchased TEXT, purchased_from TEXT, purchase_order_id TEXT, purchase_ebay_item_id TEXT,
  sale_price_cents INTEGER, sale_tax_cents INTEGER, sale_fees_cents INTEGER, sale_shipping_cents INTEGER,
  date_sold TEXT, purchased_by TEXT, sale_order_id TEXT,
  legacy_item_id TEXT, -- original shared eBay listing ID for suffixed baseline rows (added via ALTER)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE ebay_orders (
  order_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('purchase','sale')),
  status TEXT,
  total_cents INTEGER,
  processed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (order_id, role)
);
CREATE TABLE pending_metadata (
  item_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  ebay_item_id TEXT,
  ebay_title TEXT,
  seller TEXT,
  date_purchased TEXT,
  item_cents INTEGER, shipping_cents INTEGER, tax_cents INTEGER, purchase_price_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_cards_status ON cards(status);
CREATE INDEX idx_cards_purchase_order ON cards(purchase_order_id);
CREATE INDEX idx_pending_status ON pending_metadata(status);
