// ── sales-feed-staging.js — STAGING ONLY entry point (card-app-staging Worker)
// Replaces the Make.com "eBay Sales Data Pull" scenario. Pulls recent orders from the
// eBay Fulfillment API and appends new ones to the 'Sales (API)' test tab of the
// eBay Data sheet, using the same 12 columns and field meanings as Make's 'Sales' tab.
// Never touches the 'Sales' tab. Deployed only from the sales-feed branch.
import { refreshAccessToken } from './ebay-watchlist.js';
import { getGoogleAccessTokenForSheets } from './cardmeta.js';

const SHEET_ID = '1hl_68NZEqcsVxM_sgIhggR2ABc2s5QEjdbFB3-7yhg4';
const TAB = 'Sales (API)';
const HEADERS = ['Order ID', 'Title', 'Order Cost', 'Taxes', 'Fees', 'Shipping',
  'Sold Location', 'Date of Sale', 'Item ID', 'Listing Price', 'Sale Type', 'Custom SKU'];
const LOOKBACK_DAYS = 30;

const json = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), {
  status, headers: { 'Content-Type': 'application/json' }
});

async function getEbayToken(env) {
  const cached = await env.CACHE.get('ebay_access_token');
  if (cached) return cached;
  const refresh = await env.CACHE.get('ebay_refresh_token');
  if (!refresh) throw new Error('no eBay refresh token in KV');
  const token = await refreshAccessToken(refresh, env);
  if (!token) throw new Error('eBay token refresh failed (scope missing? reconnect eBay)');
  return token;
}

async function fetchOrders(env) {
  const token = await getEbayToken(env);
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
  const orders = [];
  let url = `https://api.ebay.com/sell/fulfillment/v1/order?limit=200&filter=${encodeURIComponent(`creationdate:[${since}..]`)}`;
  for (let page = 0; url && page < 10; page++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(`eBay orders ${res.status}: ${JSON.stringify(data.errors || data)}`);
    orders.push(...(data.orders || []));
    url = data.next || null;
  }
  return orders;
}

// Same fields Make maps; first line item for per-item fields (one card per order).
function orderToRow(o) {
  const li = (o.lineItems || [])[0] || {};
  const taxes = (o.lineItems || []).flatMap(l => l.ebayCollectAndRemitTaxes || [])
    .reduce((sum, t) => sum + parseFloat(t.amount?.value || 0), 0);
  return [
    o.orderId,
    li.title || '',
    o.totalFeeBasisAmount?.value ?? '',
    taxes ? taxes.toFixed(2) : '',
    o.totalMarketplaceFee?.value ?? '',
    li.deliveryCost?.shippingCost?.value ?? '',
    li.purchaseMarketplaceId || '',
    o.creationDate || '',
    li.legacyItemId || '',
    li.lineItemCost?.value ?? '',
    li.soldFormat || '',
    li.sku || ''
  ];
}

async function sheetsFetch(env, path, init = {}) {
  const gToken = await getGoogleAccessTokenForSheets(env);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${gToken}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${JSON.stringify(data.error || data)}`);
  return data;
}

// $ format on Order Cost..Shipping (C:F), all data rows. Idempotent.
async function applyCurrencyFormat(env, sheetId) {
  await sheetsFetch(env, ':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ requests: [{ repeatCell: {
      range: { sheetId, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 6 },
      cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '$#,##0.00' } } },
      fields: 'userEnteredFormat.numberFormat'
    } }] })
  });
}

// Creates the test tab (headers) if it doesn't exist yet. Returns { created, sheetId }.
async function ensureTab(env) {
  const meta = await sheetsFetch(env, '?fields=sheets.properties');
  const found = meta.sheets.find(s => s.properties.title === TAB);
  if (found) return { created: false, sheetId: found.properties.sheetId };
  const added = await sheetsFetch(env, ':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB } } }] })
  });
  const sheetId = added.replies[0].addSheet.properties.sheetId;
  await sheetsFetch(env, `/values/${encodeURIComponent(`'${TAB}'!A1:L1`)}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: [HEADERS] })
  });
  return { created: true, sheetId };
}

async function runSalesFeed(env, { dryRun = false } = {}) {
  const orders = await fetchOrders(env);
  if (dryRun) {
    return { dryRun: true, ordersFound: orders.length, sample: orders.slice(0, 3).map(orderToRow) };
  }
  const { created: tabCreated, sheetId } = await ensureTab(env);
  const existing = await sheetsFetch(env, `/values/${encodeURIComponent(`'${TAB}'!A:A`)}`);
  const seen = new Set((existing.values || []).map(r => r[0]));
  const newRows = orders.filter(o => !seen.has(o.orderId))
    .sort((a, b) => a.creationDate.localeCompare(b.creationDate))
    .map(orderToRow);
  if (newRows.length) {
    await sheetsFetch(env,
      `/values/${encodeURIComponent(`'${TAB}'!A:L`)}:append?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE`,
      { method: 'POST', body: JSON.stringify({ values: newRows }) });
  }
  await applyCurrencyFormat(env, sheetId);
  return { tabCreated, ordersFound: orders.length, appended: newRows.length, appendedOrderIds: newRows.map(r => r[0]) };
}

// ── PURCHASES (read-only test) ────────────────────────────────────────────────
// Trading API GetOrders as buyer. Splits each order's shipping + tax evenly across
// its cards (rounding remainder on the last card). Skips comc_consignment.
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? m[1] : null; };
const tags = (xml, name) => [...xml.matchAll(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'g'))].map(m => m[1]);
const num = v => (v == null || v === '' ? 0 : parseFloat(v));
const toCents = v => Math.round(num(v) * 100);

async function fetchPurchaseOrders(env, days = LOOKBACK_DAYS) {
  const token = await getEbayToken(env);
  const from = new Date(Date.now() - days * 86400000).toISOString();
  const to = new Date().toISOString();
  const orders = [];
  for (let page = 1; page <= 20; page++) {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<GetOrdersRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <OrderRole>Buyer</OrderRole>
  <OrderStatus>All</OrderStatus>
  <CreateTimeFrom>${from}</CreateTimeFrom>
  <CreateTimeTo>${to}</CreateTimeTo>
  <Pagination><EntriesPerPage>100</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination>
</GetOrdersRequest>`;
    const res = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: {
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-CALL-NAME': 'GetOrders',
        'X-EBAY-API-IAF-TOKEN': token,
        'Content-Type': 'text/xml'
      },
      body
    });
    const xml = await res.text();
    const ack = tag(xml, 'Ack');
    if (ack !== 'Success' && ack !== 'Warning') {
      throw new Error(`GetOrders ${res.status} ${ack}: ${tag(xml, 'LongMessage') || xml.slice(0, 300)}`);
    }
    orders.push(...tags(xml, 'Order'));
    if (tag(xml, 'HasMoreOrders') !== 'true') break;
  }
  return orders;
}

// Per card: item price and tax exactly as eBay reports them per transaction;
// the order's total shipping is split evenly across all cards (remainder on the last card).
function txnTaxCents(t) {
  const sources = [tag(t, 'eBayCollectAndRemitTaxes'), tag(t, 'Taxes')].filter(Boolean);
  for (const src of sources) {
    const v = tag(src, 'TotalTaxAmount');
    if (v != null) return toCents(v);
  }
  return null;
}

function purchaseOrderToCards(orderXml) {
  const orderId = tag(orderXml, 'OrderID');
  const status = tag(orderXml, 'OrderStatus');
  const seller = tag(orderXml, 'SellerUserID') || tag(tag(orderXml, 'Seller') || '', 'UserID') || '';
  const created = tag(orderXml, 'CreatedTime');
  const totalC = toCents(tag(orderXml, 'Total'));
  const txns = tags(orderXml, 'Transaction');
  let shippingC = toCents(tag(tag(orderXml, 'ShippingServiceSelected') || '', 'ShippingServiceCost'));
  if (!shippingC) shippingC = txns.reduce((s, t) => s + toCents(tag(t, 'ActualShippingCost')), 0);

  const cards = [];
  let taxFromEbay = true;
  for (const t of txns) {
    const item = tag(t, 'Item') || '';
    const qty = parseInt(tag(t, 'QuantityPurchased') || '1', 10) || 1;
    const lineTaxC = txnTaxCents(t);
    if (lineTaxC == null) taxFromEbay = false;
    for (let i = 0; i < qty; i++) {
      // a multi-quantity line's tax is spread across its units
      const unitTaxC = lineTaxC == null ? null : Math.floor(lineTaxC / qty) + (i === qty - 1 ? lineTaxC - Math.floor(lineTaxC / qty) * qty : 0);
      cards.push({ itemId: tag(item, 'ItemID'), title: tag(item, 'Title'), priceC: toCents(tag(t, 'TransactionPrice')), taxC: unitTaxC });
    }
  }
  const n = cards.length || 1;
  const itemsC = cards.reduce((s, c) => s + c.priceC, 0);
  // Fallback only if eBay gave no per-line tax: derive order tax and split evenly
  if (!taxFromEbay) {
    const orderTaxC = Math.max(0, totalC - itemsC - shippingC);
    cards.forEach((c, i) => { c.taxC = Math.floor(orderTaxC / n) + (i === n - 1 ? orderTaxC - Math.floor(orderTaxC / n) * n : 0); });
  }
  const taxC = cards.reduce((s, c) => s + c.taxC, 0);
  const shipShare = i => Math.floor(shippingC / n) + (i === n - 1 ? shippingC - Math.floor(shippingC / n) * n : 0);
  const f = c => (c / 100).toFixed(2);
  return {
    orderId, status, seller, created,
    orderTotalReported: f(totalC), orderItems: f(itemsC), orderShipping: f(shippingC), orderTax: f(taxC),
    orderTotalComputed: f(itemsC + shippingC + taxC), taxSource: taxFromEbay ? 'ebay-per-card' : 'derived-even-split',
    cardCount: cards.length,
    cards: cards.map((c, i) => ({
      itemId: c.itemId, title: c.title, itemPrice: f(c.priceC), shippingShare: f(shipShare(i)),
      tax: f(c.taxC), purchasePrice: f(c.priceC + shipShare(i) + c.taxC)
    }))
  };
}

async function runPurchasesTest(env, days) {
  const raw = await fetchPurchaseOrders(env, days);
  const orders = raw.map(purchaseOrderToCards);
  const skipped = orders.filter(o => o.seller === 'comc_consignment' || o.status === 'Cancelled');
  const kept = orders.filter(o => !skipped.includes(o));
  return {
    dryRun: true,
    ordersFound: orders.length,
    skipped: skipped.map(o => ({ orderId: o.orderId, seller: o.seller, status: o.status })),
    ordersKept: kept.length,
    cardsKept: kept.reduce((s, o) => s + o.cardCount, 0),
    orders: kept
  };
}

// ── BASELINE IMPORT (Card Cost Tracker Final → D1 cards) ──────────────────────
const TRACKER_SID = '12sNofzPwhb8uR68hT_bJNiLD2MrM0rdoQMPXGTlx2_s';
const TRACKER_TAB = 'Card Cost Tracker Final';
// Sheet header → cards column. Money columns are stored as cents.
const BASELINE_MAP = {
  'ItemID': 'item_id', 'Sport': 'sport', 'Year': 'year', 'Set': 'set_name', 'Variation': 'variation',
  'Version': 'version', 'Card No': 'card_no', 'Player Name': 'player_name', 'Serial No': 'serial_no',
  'Qty Manufactured': 'qty_manufactured', 'Grade': 'grade',
  'Purchase Price': 'purchase_price_cents', 'Sale Price': 'sale_price_cents', 'Sale Fees': 'sale_fees_cents',
  'Date Purchased': 'date_purchased', 'Purchased From': 'purchased_from',
  'Purchased By': 'purchased_by', 'Date Sold': 'date_sold', 'Transaction Date': 'transaction_date'
};
const BASELINE_DERIVED = ['Net Profit', 'Profit %', 'Days Owned', 'Full Card'];

async function readTrackerFinal(env) {
  const range = encodeURIComponent(`'${TRACKER_TAB}'!A1:Z100000`);
  const qs = 'valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING';
  const gToken = await getGoogleAccessTokenForSheets(env);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${TRACKER_SID}/values/${range}?${qs}`,
    { headers: { Authorization: `Bearer ${gToken}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(`Reading ${TRACKER_TAB} failed (${res.status}): ${data.error?.message || 'unknown'} — share the Card_Cost_Tracker sheet with the service account if this says permission denied`);
  return data.values || [];
}

const cents = v => {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const text = v => (v === '' || v == null ? null : String(v).trim() || null);

function mapBaselineRows(values) {
  const header = (values[0] || []).map(h => String(h).trim());
  const idx = {};
  header.forEach((h, i) => { if (BASELINE_MAP[h]) idx[BASELINE_MAP[h]] = i; });
  idx.__days = header.indexOf('Days Owned') >= 0 ? header.indexOf('Days Owned') : null;
  idx.__full = header.indexOf('Full Card') >= 0 ? header.indexOf('Full Card') : null;
  const unmapped = header.filter(h => h && !BASELINE_MAP[h] && !BASELINE_DERIVED.includes(h));
  const missingCols = Object.keys(BASELINE_MAP).filter(h => !header.includes(h));
  const rows = [];
  for (const r of values.slice(1)) {
    if (!r || r.every(c => c === '' || c == null)) continue;
    const get = col => (idx[col] == null ? null : r[idx[col]]);
    const card = {};
    for (const col of Object.values(BASELINE_MAP)) {
      card[col] = col.endsWith('_cents') ? cents(get(col)) : text(get(col));
    }
    card._daysOwned = idx.__days == null ? null : r[idx.__days];
    card._fullCard = idx.__full == null ? null : r[idx.__full];
    card.source = 'baseline';
    card.status = (card.sale_price_cents != null || card.date_sold) ? 'sold' : 'owned';
    rows.push(card);
  }
  return { header, unmapped, missingCols, rows };
}

async function runBaselineImport(env, { dryRun = true } = {}) {
  const values = await readTrackerFinal(env);
  const { header, unmapped, missingCols, rows } = mapBaselineRows(values);
  const seen = new Map();
  const dupes = [];
  let noId = 0;
  for (const c of rows) {
    if (!c.item_id) { noId++; continue; }
    if (seen.has(c.item_id)) dupes.push(c.item_id); else seen.set(c.item_id, c);
  }
  const sum = k => rows.reduce((s, c) => s + (c[k] || 0), 0) / 100;
  const report = {
    dryRun, tab: TRACKER_TAB, header, unmappedColumns: unmapped, missingColumns: missingCols,
    rowsRead: rows.length, rowsMissingItemId: noId,
    duplicateItemIds: { count: dupes.length, sample: [...new Set(dupes)].slice(0, 20) },
    statusCounts: { owned: rows.filter(c => c.status === 'owned').length, sold: rows.filter(c => c.status === 'sold').length },
    totals: { purchasePrice: sum('purchase_price_cents').toFixed(2), salePrice: sum('sale_price_cents').toFixed(2), saleFees: sum('sale_fees_cents').toFixed(2) },
    sample: rows.slice(0, 3),
    soldSample: rows.filter(c => c.status === 'sold').slice(0, 3),
    duplicateDetail: [...new Set(dupes)].slice(0, 6).map(id => rows.filter(c => c.item_id === id)
      .map(c => ({ item_id: c.item_id, fullCard: c._fullCard, purchase: c.purchase_price_cents, sale: c.sale_price_cents, purchasedFrom: c.purchased_from, datePurchased: c.date_purchased, transactionDate: c.transaction_date })))
  };
  if (dryRun) return report;
  return { ...(await commitBaseline(env, rows)), dryRunTotals: report.totals, dryRunRows: report.rowsRead };
}

// "10/3/26 11:35" or "9/29/2026" → "2026-10-03 11:35" / "2026-09-29"; anything else kept as-is
function normDate(v) {
  if (!v) return null;
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return String(v).trim();
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  const d = `${yyyy}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return m[4] ? `${d} ${m[4].padStart(2, '0')}:${m[5]}` : d;
}

const CARD_COLS = ['item_id', 'legacy_item_id', 'source', 'status', 'sport', 'year', 'set_name', 'variation', 'version',
  'card_no', 'player_name', 'serial_no', 'qty_manufactured', 'grade', 'purchase_price_cents', 'date_purchased',
  'purchased_from', 'sale_price_cents', 'sale_fees_cents', 'date_sold', 'purchased_by'];

async function commitBaseline(env, rows) {
  const existing = (await env.DB.prepare('SELECT COUNT(*) AS n FROM cards').first()).n;
  if (existing > 0) throw new Error(`cards already has ${existing} rows — baseline import refused (it only runs on an empty table)`);
  const seenCount = new Map();
  const prepared = rows.map(c => {
    const n = (seenCount.get(c.item_id) || 0) + 1;
    seenCount.set(c.item_id, n);
    return {
      ...c,
      item_id: n === 1 ? c.item_id : `${c.item_id}-${n}`,
      legacy_item_id: n === 1 ? null : c.item_id,
      date_purchased: normDate(c.date_purchased),
      date_sold: c.status === 'sold' ? normDate(c.date_sold || c.transaction_date) : null
    };
  });
  const sql = `INSERT INTO cards (${CARD_COLS.join(', ')}) VALUES (${CARD_COLS.map(() => '?').join(', ')})`;
  const stmt = env.DB.prepare(sql);
  for (let i = 0; i < prepared.length; i += 100) {
    await env.DB.batch(prepared.slice(i, i + 100).map(c => stmt.bind(...CARD_COLS.map(k => c[k] ?? null))));
  }
  const t = await env.DB.prepare(`SELECT COUNT(*) AS n, SUM(purchase_price_cents) AS p, SUM(sale_price_cents) AS s, SUM(sale_fees_cents) AS f,
    SUM(status = 'sold') AS sold, SUM(status = 'owned') AS owned, SUM(legacy_item_id IS NOT NULL) AS suffixed FROM cards`).first();
  return {
    committed: true, rowsInDb: t.n, suffixedRows: t.suffixed,
    statusCounts: { owned: t.owned, sold: t.sold },
    dbTotals: { purchasePrice: ((t.p || 0) / 100).toFixed(2), salePrice: ((t.s || 0) / 100).toFixed(2), saleFees: ((t.f || 0) / 100).toFixed(2) }
  };
}

// ── PURCHASE IMPORTER (eBay purchases → pending_metadata queue) ───────────────
// Skips comc_consignment, cancelled orders, orders already processed, and cards whose
// eBay Item ID is already in the baseline. New cards get a 12-digit ID starting with 9.
const toEastern = iso => {
  if (!iso) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};

async function idTaken(env, id) {
  const r = await env.DB.prepare(`SELECT 1 FROM cards WHERE item_id = ?1 OR legacy_item_id = ?1
    UNION SELECT 1 FROM pending_metadata WHERE item_id = ?1 LIMIT 1`).bind(id).first();
  return !!r;
}

async function newItemId(env) {
  for (let i = 0; i < 20; i++) {
    const n = crypto.getRandomValues(new Uint32Array(2));
    const id = '9' + String((n[0] * 4294967296 + n[1]) % 100000000000).padStart(11, '0');
    if (!(await idTaken(env, id))) return id;
  }
  throw new Error('could not generate a unique Item ID');
}

async function inBaseline(env, ebayItemId) {
  if (!ebayItemId) return false;
  const r = await env.DB.prepare(`SELECT 1 FROM cards WHERE item_id = ?1 OR legacy_item_id = ?1 OR purchase_ebay_item_id = ?1 LIMIT 1`)
    .bind(ebayItemId).first();
  return !!r;
}

async function runPurchaseImport(env, days = LOOKBACK_DAYS) {
  const raw = await fetchPurchaseOrders(env, days);
  const summary = { ordersFound: raw.length, alreadyProcessed: 0, skippedOrders: [], cardsQueued: [], cardsSkippedInBaseline: [] };
  for (const xml of raw) {
    const totalReportedC = toCents(tag(xml, 'Total'));
    const o = purchaseOrderToCards(xml);
    const done = await env.DB.prepare(`SELECT 1 FROM ebay_orders WHERE order_id = ? AND role = 'purchase'`).bind(o.orderId).first();
    if (done) { summary.alreadyProcessed++; continue; }
    const reason = o.seller === 'comc_consignment' ? 'comc_consignment' : o.status === 'Cancelled' ? 'cancelled' : null;
    const stmts = [];
    if (!reason) {
      const refunded = totalReportedC === 0;
      for (const c of o.cards) {
        if (await inBaseline(env, c.itemId)) { summary.cardsSkippedInBaseline.push({ orderId: o.orderId, ebayItemId: c.itemId, title: c.title }); continue; }
        const itemId = await newItemId(env);
        stmts.push(env.DB.prepare(`INSERT INTO pending_metadata (item_id, order_id, ebay_item_id, ebay_title, seller, date_purchased,
          item_cents, shipping_cents, tax_cents, purchase_price_cents, flag) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(
          itemId, o.orderId, c.itemId, c.title, o.seller, toEastern(o.created),
          toCents(c.itemPrice), toCents(c.shippingShare), toCents(c.tax), toCents(c.purchasePrice), refunded ? 'refunded' : null));
        summary.cardsQueued.push({ itemId, orderId: o.orderId, title: c.title, purchasePrice: c.purchasePrice, refunded });
      }
    } else {
      summary.skippedOrders.push({ orderId: o.orderId, seller: o.seller, reason });
    }
    stmts.push(env.DB.prepare(`INSERT INTO ebay_orders (order_id, role, status, total_cents) VALUES (?, 'purchase', ?, ?)`)
      .bind(o.orderId, reason || o.status, totalReportedC));
    await env.DB.batch(stmts);
  }
  return summary;
}

async function listPending(env) {
  const { results } = await env.DB.prepare(`SELECT * FROM pending_metadata WHERE status = 'pending' ORDER BY date_purchased`).all();
  return { pending: results.length, rows: results.map(r => ({ ...r,
    item: (r.item_cents / 100).toFixed(2), shipping: (r.shipping_cents / 100).toFixed(2), tax: (r.tax_cents / 100).toFixed(2),
    purchasePrice: (r.purchase_price_cents / 100).toFixed(2) })) };
}

export default {
  async scheduled(event, env, ctx) {
    try {
      await runSalesFeed(env);
    } catch (e) {
      console.error('sales-feed-staging cron failed:', e.message);
    }
    try {
      await runPurchaseImport(env);
    } catch (e) {
      console.error('purchase-import cron failed:', e.message);
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (!['/sales-feed-run', '/purchases-test', '/db-status', '/baseline-import', '/purchase-import', '/pending'].includes(url.pathname)) return json({ error: 'not found' }, 404);
    if (!env.APP_KEY || url.searchParams.get('key') !== env.APP_KEY) return json({ error: 'unauthorized' }, 401);
    try {
      if (url.pathname === '/db-status') {
        const counts = {};
        for (const t of ['cards', 'ebay_orders', 'pending_metadata']) {
          counts[t] = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).n;
        }
        return json({ db: 'card-tracker-staging', rows: counts });
      }
      if (url.pathname === '/purchase-import') {
        const days = Math.min(89, Math.max(1, parseInt(url.searchParams.get('days') || String(LOOKBACK_DAYS), 10) || LOOKBACK_DAYS));
        return json(await runPurchaseImport(env, days));
      }
      if (url.pathname === '/pending') return json(await listPending(env));
      if (url.pathname === '/baseline-import') return json(await runBaselineImport(env, { dryRun: url.searchParams.get('commit') !== '1' }));
      if (url.pathname === '/purchases-test') return json(await runPurchasesTest(env, Math.min(89, Math.max(1, parseInt(url.searchParams.get('days') || String(LOOKBACK_DAYS), 10) || LOOKBACK_DAYS))));
      return json(await runSalesFeed(env, { dryRun: url.searchParams.get('dry') === '1' }));
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }
};
