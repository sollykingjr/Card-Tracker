// ── card-db.js — card database (D1): eBay sale/purchase import, intake queue, manual add,
// COMC CSV import, edits, refunds, backup sheet, and the card feed the app reads.
// Replaces the Make.com scenario, the eBay Chrome extension and the Excel Power Query pipeline.
import { refreshAccessToken } from './ebay-watchlist.js';
import { getGoogleAccessTokenForSheets } from './cardmeta.js';
import { notifyCronFailure } from './misc.js';
import { parseFileName } from './parse-file-name.js';
import { parseCsv, comcCard, comcDate, toCentsStr } from './comc-import.js';

const LOOKBACK_DAYS = 30;

async function getEbayToken(env) {
  const cached = await env.CACHE.get('ebay_access_token');
  if (cached) return cached;
  const refresh = await env.CACHE.get('ebay_refresh_token');
  if (!refresh) throw new Error('no eBay refresh token in KV');
  const token = await refreshAccessToken(refresh, env);
  if (!token) throw new Error('eBay token refresh failed (scope missing? reconnect eBay)');
  return token;
}

async function fetchOrders(env, days = LOOKBACK_DAYS) {
  const token = await getEbayToken(env);
  const since = new Date(Date.now() - days * 86400000).toISOString();
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

async function sheetsFetch(env, path, init = {}, spreadsheetId) {
  const gToken = await getGoogleAccessTokenForSheets(env);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${gToken}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${JSON.stringify(data.error || data)}`);
  return data;
}

// $ format on Order Cost..Shipping (C:F), all data rows. Idempotent.

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


const cents = v => {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

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

// ── REVIEW QUEUE ACTIONS ──────────────────────────────────────────────────────
async function confirmPending(env, itemId, fileName, sport) {
  const row = await env.DB.prepare(`SELECT * FROM pending_metadata WHERE item_id = ? AND status = 'pending'`).bind(itemId).first();
  if (!row) throw new Error('not found or already handled');
  const f = parseFileName(fileName);
  if (!f.player_name) throw new Error('could not read a player name from that file name');
  if (!sport || !String(sport).trim()) throw new Error('choose a sport');
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO cards (item_id, source, status, file_name, sport, year, set_name, variation, version, card_no, player_name,
      qty_manufactured, grade, purchase_item_cents, purchase_shipping_cents, purchase_tax_cents, purchase_price_cents,
      date_purchased, purchased_from, purchase_order_id, purchase_ebay_item_id)
      VALUES (?, 'ebay', 'owned', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      row.item_id, fileName.trim(), String(sport).trim(), f.year, f.set_name, f.variation, f.version, f.card_no, f.player_name, f.qty_manufactured, f.grade,
      row.item_cents, row.shipping_cents, row.tax_cents, row.purchase_price_cents, row.date_purchased, row.seller, row.order_id, row.ebay_item_id),
    env.DB.prepare(`UPDATE pending_metadata SET status = 'done' WHERE item_id = ?`).bind(itemId)
  ]);
  return { confirmed: itemId, parsed: f };
}

async function skipPending(env, itemId) {
  const r = await env.DB.prepare(`UPDATE pending_metadata SET status = 'skipped' WHERE item_id = ? AND status = 'pending'`).bind(itemId).run();
  if (!r.meta.changes) throw new Error('not found or already handled');
  return { skipped: itemId };
}

// ── SALE IMPORTER (eBay sales → cards) ────────────────────────────────────────
// One eBay order is processed once (ebay_orders). Cancelled orders are recorded and ignored;
// unpaid / cancel-requested orders are left for a later run. Each line item is matched to a
// card by Custom SKU (= Item ID). Anything that can't be applied cleanly goes to sale_review.
const sameDay = (a, b) => {
  if (!a || !b) return false;
  const d = x => new Date(String(x).replace(' ', 'T').slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.abs(d(a) - d(b)) <= 86400000;   // within a day (UTC vs Eastern drift)
};

function saleLines(o) {
  const lines = o.lineItems || [];
  const ocC = toCents(o.totalFeeBasisAmount?.value), feesC = toCents(o.totalMarketplaceFee?.value);
  const baseC = lines.reduce((s, l) => s + toCents(l.lineItemCost?.value), 0) || 1;
  let ocLeft = ocC, feeLeft = feesC;
  return lines.map((l, i) => {
    const last = i === lines.length - 1, share = toCents(l.lineItemCost?.value) / baseC;
    const oc = last ? ocLeft : Math.round(ocC * share), fee = last ? feeLeft : Math.round(feesC * share);
    ocLeft -= oc; feeLeft -= fee;
    return {
      sku: (l.sku || '').trim(), title: l.title || '',
      sale_price_cents: oc, sale_fees_cents: fee,
      sale_tax_cents: (l.ebayCollectAndRemitTaxes || []).reduce((s, t) => s + toCents(t.amount?.value), 0),
      sale_shipping_cents: toCents(l.deliveryCost?.shippingCost?.value),
      purchased_by: l.purchaseMarketplaceId || ''
    };
  });
}

async function runSaleImport(env, days = LOOKBACK_DAYS) {
  const orders = await fetchOrders(env, days);
  const sum = { ordersFound: orders.length, alreadyProcessed: 0, waiting: [], cancelled: [], recorded: [], sameSaleAlreadyInData: [], sentToReview: [] };
  for (const o of orders) {
    const done = await env.DB.prepare(`SELECT 1 FROM ebay_orders WHERE order_id = ? AND role = 'sale'`).bind(o.orderId).first();
    if (done) { sum.alreadyProcessed++; continue; }
    const cancelState = o.cancelStatus?.cancelState;
    const pay = o.orderPaymentStatus;
    const stmts = [];
    let outcome = 'recorded';
    if (cancelState === 'CANCELED' || pay === 'FULLY_REFUNDED') {
      outcome = cancelState === 'CANCELED' ? 'cancelled' : 'refunded';
      sum.cancelled.push({ orderId: o.orderId, outcome });
    } else if (cancelState === 'CANCEL_REQUESTED' || (pay && pay !== 'PAID' && pay !== 'PARTIALLY_REFUNDED')) {
      sum.waiting.push({ orderId: o.orderId, cancelState, pay });
      continue;                                   // not recorded: re-checked next run
    } else {
      const soldAt = toEastern(o.creationDate);
      for (const line of saleLines(o)) {
        const review = reason => {
          stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO sale_review (order_id, sku, reason, title, sale_date, sale_price_cents,
            sale_tax_cents, sale_fees_cents, sale_shipping_cents, purchased_by) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(
            o.orderId, line.sku || '', reason, line.title, soldAt, line.sale_price_cents, line.sale_tax_cents,
            line.sale_fees_cents, line.sale_shipping_cents, line.purchased_by));
          sum.sentToReview.push({ orderId: o.orderId, sku: line.sku, title: line.title, reason });
        };
        if (!line.sku) { review('no Custom SKU on listing'); continue; }
        const card = await env.DB.prepare(`SELECT item_id, status, date_sold, sale_price_cents, sale_tax_cents FROM cards WHERE item_id = ?`).bind(line.sku).first();
        if (!card) { review('no card with this Item ID'); continue; }
        if (card.status === 'sold') {
          if (sameDay(card.date_sold, soldAt)) {
            // Same sale already in the data: fill in eBay's breakdown if it was missing and the price agrees
            if (card.sale_tax_cents == null && card.sale_price_cents === line.sale_price_cents) {
              stmts.push(env.DB.prepare(`UPDATE cards SET sale_tax_cents = ?, sale_fees_cents = ?, sale_shipping_cents = ?, sale_order_id = ?,
                updated_at = datetime('now') WHERE item_id = ?`).bind(line.sale_tax_cents, line.sale_fees_cents, line.sale_shipping_cents, o.orderId, card.item_id));
            }
            sum.sameSaleAlreadyInData.push({ orderId: o.orderId, itemId: card.item_id });
          } else review(`card already marked sold on ${card.date_sold}`);
          continue;
        }
        if (card.status !== 'owned') { review(`card status is ${card.status}`); continue; }
        stmts.push(env.DB.prepare(`UPDATE cards SET status = 'sold', sale_price_cents = ?, sale_tax_cents = ?, sale_fees_cents = ?,
          sale_shipping_cents = ?, date_sold = ?, purchased_by = ?, sale_order_id = ?, updated_at = datetime('now') WHERE item_id = ?`).bind(
          line.sale_price_cents, line.sale_tax_cents, line.sale_fees_cents, line.sale_shipping_cents, soldAt, line.purchased_by, o.orderId, card.item_id));
        const net = line.sale_price_cents - line.sale_tax_cents - line.sale_fees_cents - line.sale_shipping_cents;
        sum.recorded.push({ orderId: o.orderId, itemId: card.item_id, title: line.title, proceeds: (net / 100).toFixed(2) });
      }
    }
    stmts.push(env.DB.prepare(`INSERT INTO ebay_orders (order_id, role, status, total_cents) VALUES (?, 'sale', ?, ?)`)
      .bind(o.orderId, outcome, toCents(o.totalFeeBasisAmount?.value)));
    await env.DB.batch(stmts);
  }
  return sum;
}

// ── MANUAL ADD (cards bought outside eBay / COMC) ─────────────────────────────
async function manualAdd(env, b) {
  const fileName = String(b.file_name || '').trim();
  const f = parseFileName(fileName);
  if (!f.player_name) throw new Error('could not read a player name from that file name');
  const sport = String(b.sport || '').trim();
  if (!sport) throw new Error('choose a sport');
  const priceC = cents(b.price);
  if (priceC == null || priceC < 0) throw new Error('enter a purchase price');
  const from = String(b.purchased_from || '').trim();
  if (!from) throw new Error('enter where you bought it');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : toEastern(new Date().toISOString()).slice(0, 10);
  const itemId = await newItemId(env);
  await env.DB.prepare(`INSERT INTO cards (item_id, source, status, file_name, sport, year, set_name, variation, version, card_no, player_name,
    qty_manufactured, grade, purchase_item_cents, purchase_price_cents, date_purchased, purchased_from)
    VALUES (?, 'manual', 'owned', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    itemId, fileName, sport, f.year, f.set_name, f.variation, f.version, f.card_no, f.player_name, f.qty_manufactured, f.grade,
    priceC, priceC, date, from).run();
  return { added: itemId, parsed: f, sport, purchasePrice: (priceC / 100).toFixed(2), purchasedFrom: from, datePurchased: date };
}

// ── CARD LOOKUP + REFUND / CANCEL ACTIONS ─────────────────────────────────────
async function cardSearch(env, qRaw) {
  const q = String(qRaw || '').trim();
  if (q.length < 2) return { rows: [] };
  const { results } = await env.DB.prepare(`SELECT item_id, status, year, set_name, variation, card_no, player_name, qty_manufactured, grade,
      purchase_price_cents, sale_price_cents, date_sold, purchased_by, refund_date FROM cards
    WHERE item_id = ?1 OR player_name LIKE ?2 ORDER BY (status = 'sold') DESC, date_sold DESC LIMIT 25`).bind(q, `%${q}%`).all();
  return { rows: results };
}

const SALE_COLS = ['sale_price_cents', 'sale_tax_cents', 'sale_fees_cents', 'sale_shipping_cents', 'date_sold', 'purchased_by', 'sale_order_id'];

async function refundCard(env, itemId, type) {
  const card = await env.DB.prepare(`SELECT * FROM cards WHERE item_id = ?`).bind(itemId).first();
  if (!card) throw new Error('card not found');
  if (card.status !== 'sold') throw new Error(`card is ${card.status}, not sold`);
  const before = Object.fromEntries(SALE_COLS.map(k => [k, card[k]]));
  const today = toEastern(new Date().toISOString()).slice(0, 10);
  let stmt;
  if (type === 'cancelled') {
    // Sale undone, card back in inventory (not relisted)
    stmt = env.DB.prepare(`UPDATE cards SET status = 'owned', ${SALE_COLS.map(k => `${k} = NULL`).join(', ')}, updated_at = datetime('now') WHERE item_id = ?`).bind(itemId);
  } else if (type === 'gone') {
    // Refunded and the card is gone: no sale money, purchase cost stays as a loss
    stmt = env.DB.prepare(`UPDATE cards SET status = 'refunded', sale_price_cents = 0, sale_tax_cents = 0, sale_fees_cents = 0, sale_shipping_cents = 0,
      refund_date = ?, updated_at = datetime('now') WHERE item_id = ?`).bind(today, itemId);
  } else throw new Error('unknown action');
  await env.DB.batch([
    stmt,
    env.DB.prepare(`INSERT INTO card_events (item_id, event, details) VALUES (?, ?, ?)`).bind(itemId, `refund_${type}`, JSON.stringify({ before, at: today }))
  ]);
  return { itemId, action: type, previousSale: before };
}

// ── COMC CSV IMPORT ───────────────────────────────────────────────────────────
// type=purchases: adds COMC purchases whose ItemID isn't in the data yet.
// type=sales: marks owned cards sold; adds sold-only cards (consignment) that aren't in the data;
//             same-day repeats are skipped; conflicts go to sale_review. Safe to re-upload.
async function runComcImport(env, type, csvText, commit) {
  const rows = parseCsv(csvText);
  if (!rows.length) throw new Error('no rows found in that file');
  const need = type === 'purchases' ? ['ItemID', 'Set Name', 'Description', 'Purchase Price', 'Date Sold', 'Purchased From']
    : ['ItemID', 'Set Name', 'Description', 'Sale Price', 'Transaction Fee', 'Promotion Fee', 'Date Sold', 'Purchased By'];
  const missing = need.filter(h => !(h in rows[0]));
  if (missing.length) throw new Error(`this doesn't look like a COMC ${type} file (missing: ${missing.join(', ')})`);

  const { results } = await env.DB.prepare(`SELECT item_id, status, date_sold FROM cards`).all();
  const have = new Map(results.map(r => [r.item_id, r]));
  const out = { type, rowsInFile: rows.length, alreadyInData: 0, toAdd: [], toMarkSold: [], toReview: [] };
  const stmts = [];

  for (const r of rows) {
    const c = comcCard(r);
    if (!c.item_id) continue;
    const existing = have.get(c.item_id);
    if (type === 'purchases') {
      if (existing) { out.alreadyInData++; continue; }
      const price = toCentsStr(r['Purchase Price']), date = comcDate(r['Date Sold']);
      out.toAdd.push({ itemId: c.item_id, card: [c.year, c.set_name, c.variation, c.player_name].filter(Boolean).join(' '), price: (price / 100).toFixed(2), date });
      stmts.push(env.DB.prepare(`INSERT INTO cards (item_id, source, status, sport, year, set_name, variation, version, card_no, player_name,
        serial_no, qty_manufactured, purchase_item_cents, purchase_price_cents, date_purchased, purchased_from)
        VALUES (?, 'comc', 'owned', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(c.item_id, c.sport, c.year, c.set_name, c.variation, c.version,
        c.card_no, c.player_name, c.serial_no, c.qty_manufactured, price, price, date, r['Purchased From'] || null));
      continue;
    }
    // sales
    const sale = toCentsStr(r['Sale Price']), fees = (toCentsStr(r['Transaction Fee']) || 0) + (toCentsStr(r['Promotion Fee']) || 0);
    const soldAt = comcDate(r['Date Sold']), buyer = r['Purchased By'] || null;
    const label = [c.year, c.set_name, c.variation, c.player_name].filter(Boolean).join(' ');
    if (existing && existing.status === 'sold') {
      if (sameDay(existing.date_sold, soldAt)) { out.alreadyInData++; continue; }
      out.toReview.push({ itemId: c.item_id, card: label, reason: `already marked sold on ${existing.date_sold}` });
      stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO sale_review (order_id, sku, reason, title, sale_date, sale_price_cents, sale_tax_cents,
        sale_fees_cents, sale_shipping_cents, purchased_by) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?)`).bind(
        `COMC:${r['Batch #'] || soldAt}`, c.item_id, `COMC sale, card already marked sold on ${existing.date_sold}`, label, soldAt, sale, fees, buyer));
      continue;
    }
    if (existing && existing.status !== 'owned') {
      out.toReview.push({ itemId: c.item_id, card: label, reason: `card status is ${existing.status}` });
      continue;
    }
    if (existing) {
      out.toMarkSold.push({ itemId: c.item_id, card: label, sale: (sale / 100).toFixed(2), fees: (fees / 100).toFixed(2), date: soldAt });
      stmts.push(env.DB.prepare(`UPDATE cards SET status = 'sold', sale_price_cents = ?, sale_tax_cents = 0, sale_fees_cents = ?, sale_shipping_cents = 0,
        date_sold = ?, purchased_by = ?, updated_at = datetime('now') WHERE item_id = ?`).bind(sale, fees, soldAt, buyer, c.item_id));
    } else {
      const cost = toCentsStr(r['Purchase Price']);
      out.toAdd.push({ itemId: c.item_id, card: label, sale: (sale / 100).toFixed(2), date: soldAt, note: 'sold card not in data yet' });
      stmts.push(env.DB.prepare(`INSERT INTO cards (item_id, source, status, sport, year, set_name, variation, version, card_no, player_name,
        serial_no, qty_manufactured, purchase_price_cents, sale_price_cents, sale_tax_cents, sale_fees_cents, sale_shipping_cents, date_sold, purchased_by)
        VALUES (?, 'comc', 'sold', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?)`).bind(c.item_id, c.sport, c.year, c.set_name, c.variation,
        c.version, c.card_no, c.player_name, c.serial_no, c.qty_manufactured, cost, sale, fees, soldAt, buyer));
    }
  }
  if (commit) for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return {
    committed: !!commit, type, rowsInFile: out.rowsInFile, alreadyInData: out.alreadyInData,
    added: out.toAdd.length, markedSold: out.toMarkSold.length, sentToReview: out.toReview.length,
    addedSample: out.toAdd.slice(0, 15), markedSoldSample: out.toMarkSold.slice(0, 15), review: out.toReview
  };
}

// ── BACKUP SHEET (rewritten after each scheduled run) ─────────────────────────
const BACKUP_SID = '1h5BT7MXGR1i_w0glZEImcfkdjjkZMcICiMEkieovW24';
const FINAL_HEADERS = ['ItemID', 'Sport', 'Year', 'Set', 'Variation', 'Version', 'Card No', 'Player Name', 'Serial No', 'Qty Manufactured',
  'Purchase Price', 'Sale Price', 'Sale Fees', 'Net Profit', 'Profit %', 'Date Purchased', 'Transaction Date', 'Purchased From',
  'Purchased By', 'Days Owned', 'Grade', 'Full Card'];
const ALL_COLS = ['item_id', 'legacy_item_id', 'source', 'status', 'file_name', 'sport', 'year', 'set_name', 'variation', 'version', 'card_no',
  'player_name', 'serial_no', 'qty_manufactured', 'grade', 'purchase_item_cents', 'purchase_shipping_cents', 'purchase_tax_cents',
  'purchase_price_cents', 'date_purchased', 'purchased_from', 'purchase_order_id', 'purchase_ebay_item_id', 'sale_price_cents',
  'sale_tax_cents', 'sale_fees_cents', 'sale_shipping_cents', 'date_sold', 'purchased_by', 'sale_order_id', 'refund_date', 'created_at', 'updated_at'];

const dollars = c => (c == null ? '' : Math.round(c) / 100);
const isSoldLike = c => c.status === 'sold' || c.status === 'refunded';
// Deductions from the sale: new model (tax recorded) = tax + fees + shipping; untouched history = |old Sale Fees|
const saleDeductions = c => c.sale_tax_cents != null
  ? (c.sale_tax_cents || 0) + (c.sale_fees_cents || 0) + (c.sale_shipping_cents || 0)
  : Math.abs(c.sale_fees_cents || 0);
const netProfitCents = c => (c.sale_price_cents || 0) - (c.purchase_price_cents || 0) - saleDeductions(c);
const daysBetween = (a, b) => {
  if (!a || !b) return '';
  const t = x => Date.parse(String(x).slice(0, 10) + 'T00:00:00Z');
  const d = Math.round((t(b) - t(a)) / 86400000);
  return Number.isFinite(d) ? d : '';
};
const fullCard = c => [c.year, c.set_name, c.variation, c.card_no ? '#' + c.card_no : null, c.version, c.player_name,
  c.qty_manufactured ? '/' + c.qty_manufactured : null, c.grade].filter(x => x != null && String(x).trim() !== '').join(' ');

function finalRow(c) {
  const sold = isSoldLike(c);
  const net = netProfitCents(c);
  const profitPct = sold && c.sale_price_cents != null && c.purchase_price_cents ? Math.round((net / c.purchase_price_cents) * 10000) / 10000 : '';
  return [c.item_id, c.sport, c.year, c.set_name, c.variation, c.version, c.card_no, c.player_name, c.serial_no, c.qty_manufactured,
    dollars(c.purchase_price_cents), dollars(c.sale_price_cents), sold ? dollars(saleDeductions(c)) : '', dollars(net), profitPct,
    c.date_purchased, sold ? (c.date_sold || c.refund_date) : c.date_purchased, c.purchased_from, c.purchased_by,
    sold ? daysBetween(c.date_purchased, c.date_sold || c.refund_date) : '', c.grade, fullCard(c)].map(v => v ?? '');
}

async function ensureBackupTabs(env) {
  const meta = await sheetsFetch(env, '?fields=sheets.properties', {}, BACKUP_SID);
  const titles = meta.sheets.map(s => s.properties.title);
  const add = ['Card Cost Tracker Final', 'All Data'].filter(t => !titles.includes(t));
  if (add.length) await sheetsFetch(env, ':batchUpdate', { method: 'POST',
    body: JSON.stringify({ requests: add.map(title => ({ addSheet: { properties: { title } } })) }) }, BACKUP_SID);
}

async function writeBackup(env) {
  const { results } = await env.DB.prepare(`SELECT * FROM cards ORDER BY COALESCE(date_sold, refund_date, date_purchased) DESC, item_id`).all();
  await ensureBackupTabs(env);
  const finalValues = [FINAL_HEADERS, ...results.map(finalRow)];
  const meta = await readCardMeta(env);
  const allValues = [[...ALL_COLS, 'tags', 'in_hand', 'backed_up_at'], ...results.map((c, i) => {
    const m = meta[c.item_id] || { tags: [], inHand: false };
    return [...ALL_COLS.map(k => c[k] ?? ''), m.tags.join(', '), m.inHand ? 'TRUE' : '', i === 0 ? new Date().toISOString() : ''];
  })];
  await sheetsFetch(env, '/values:batchClear', { method: 'POST',
    body: JSON.stringify({ ranges: ["'Card Cost Tracker Final'!A:Z", "'All Data'!A:AZ"] }) }, BACKUP_SID);
  await sheetsFetch(env, '/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: [
    { range: "'Card Cost Tracker Final'!A1", values: finalValues },
    { range: "'All Data'!A1", values: allValues }
  ] }) }, BACKUP_SID);
  const sum = results.reduce((a, c) => { a.net += netProfitCents(c); a[c.status] = (a[c.status] || 0) + 1; return a; }, { net: 0 });
  return { rowsWritten: results.length, statusCounts: Object.fromEntries(Object.entries(sum).filter(([k]) => k !== 'net')),
    netProfitAllCards: (sum.net / 100).toFixed(2), sheet: `https://docs.google.com/spreadsheets/d/${BACKUP_SID}` };
}

// ── APP CARD FEED (same 22 columns the app reads from Card Cost Tracker Final) ─
// Dates as M/D/YYYY[ H:MM] and Profit % as "12.34%" so the app's existing parsers work unchanged
// (Safari can't parse "YYYY-MM-DD HH:MM", and date-only ISO strings would shift a day in Eastern time).
const appDate = v => {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return String(v);
  const d = `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}/${m[1]}`;
  return m[4] ? `${d} ${parseInt(m[4], 10)}:${m[5]}` : d;
};

async function appCards(env) {
  const { results } = await env.DB.prepare(`SELECT * FROM cards ORDER BY COALESCE(date_sold, refund_date, date_purchased) DESC, item_id`).all();
  const values = results.map(c => {
    const r = finalRow(c);
    r[14] = r[14] === '' ? '' : (r[14] * 100).toFixed(2) + '%';
    r[15] = appDate(r[15]);
    r[16] = appDate(r[16]);
    return r.map(v => (v === null || v === undefined) ? '' : String(v));
  });
  return { source: 'card-tracker-db', count: values.length, values };
}

// ── EDIT METADATA (card modal) ────────────────────────────────────────────────
const EDIT_FIELD_COLS = {
  'Sport': 'sport', 'Year': 'year', 'Set': 'set_name', 'Variation': 'variation', 'Version': 'version', 'Card No': 'card_no',
  'Player Name': 'player_name', 'Serial No': 'serial_no', 'Qty Manufactured': 'qty_manufactured', 'Purchased From': 'purchased_from', 'Grade': 'grade'
};
async function updateCard(env, itemId, fields) {
  const card = await env.DB.prepare(`SELECT * FROM cards WHERE item_id = ?`).bind(itemId).first();
  if (!card) throw new Error('card not found');
  const sets = [], vals = [], before = {}, after = {};
  for (const [label, raw] of Object.entries(fields || {})) {
    const col = EDIT_FIELD_COLS[label];
    if (!col) continue;
    const v = String(raw ?? '').trim();
    sets.push(`${col} = ?`); vals.push(v === '' ? null : v);
    before[col] = card[col]; after[col] = v === '' ? null : v;
  }
  if (!sets.length) throw new Error('no changes');
  await env.DB.batch([
    env.DB.prepare(`UPDATE cards SET ${sets.join(', ')}, updated_at = datetime('now') WHERE item_id = ?`).bind(...vals, itemId),
    env.DB.prepare(`INSERT INTO card_events (item_id, event, details) VALUES (?, 'edit', ?)`).bind(itemId, JSON.stringify({ before, after }))
  ]);
  return { ok: true, itemId, changed: after };
}

// ── CARD DETAIL (sale breakdown for the card modal) ───────────────────────────
async function cardDetail(env, itemId) {
  const c = await env.DB.prepare(`SELECT * FROM cards WHERE item_id = ?`).bind(itemId).first();
  if (!c) throw new Error('card not found');
  const hasBreakdown = c.sale_tax_cents != null;
  const deductions = saleDeductions(c);
  return {
    itemId: c.item_id, status: c.status, source: c.source, hasBreakdown,
    salePrice: c.sale_price_cents, tax: hasBreakdown ? c.sale_tax_cents : null,
    fees: hasBreakdown ? c.sale_fees_cents : Math.abs(c.sale_fees_cents || 0),
    shipping: hasBreakdown ? c.sale_shipping_cents : null,
    netProceeds: c.sale_price_cents == null ? null : c.sale_price_cents - deductions,
    cost: c.purchase_price_cents, profit: netProfitCents(c),
    purchase: { item: c.purchase_item_cents, shipping: c.purchase_shipping_cents, tax: c.purchase_tax_cents },
    soldTo: c.purchased_by, orderId: c.sale_order_id, refundDate: c.refund_date
  };
}

// Tags + In Hand from the Worker's card-meta KV (read-only), for the backup sheet
async function readCardMeta(env) {
  const out = {};
  let cursor;
  do {
    const page = await env.CACHE.list({ prefix: 'card-meta:', cursor });
    for (const k of page.keys) {
      const id = k.name.slice('card-meta:'.length);
      out[id] = { tags: (k.metadata && Array.isArray(k.metadata.tags)) ? k.metadata.tags : [], inHand: !!(k.metadata && k.metadata.inHand) };
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}


// ── GEMINI FILE-NAME SUGGESTIONS (read-only test) ─────────────────────────────
// eBay title + similar cards from your own data → suggested file name in your format.
const GEMINI_MODEL = 'gemini-3.8-flash'; // override per run with ?model=
const NAME_STOP = new Set(('topps panini bowman upper deck donruss optic prizm select chrome refractor finest mosaic phoenix stadium club heritage ' +
  'update series sapphire cosmic national treasures immaculate contenders score fleer leaf gold silver black blue red green orange purple ' +
  'pink yellow white aqua bronze lava wave ice scope parallel insert base auto autograph autographs signature signatures patch rookie rookies ' +
  'rc sp ssp card cards first 1st rare hof qb rb wr nfl nba mlb nhl psa bgs sgc cgc gem mint mt').split(/\s+/));

const fileNameFromCard = c => {
  let n = `${c.year || ''} ${c.set_name || ''}`;
  if (c.variation) n += ` - ${c.variation}`;
  if (c.card_no) n += ` #${c.card_no}`;
  n += ` - ${c.version ? c.version + ' - ' : ''}${c.player_name || ''}`;
  if (c.qty_manufactured) n += ` /${c.qty_manufactured}`;
  if (c.grade) n += ` [${c.grade}]`;
  return n.replace(/\s+/g, ' ').trim();
};

async function similarCardExamples(env, title) {
  const year = (title.match(/\b(19[5-9]\d|20[0-3]\d)\b/) || [])[1] || null;
  const words = title.replace(/[^A-Za-z'.\-\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !NAME_STOP.has(w.toLowerCase()));
  const pairs = [];
  for (let i = 0; i < Math.min(words.length - 1, 4); i++) pairs.push(`${words[i]} ${words[i + 1]}`);
  const brand = (title.match(/\b(Topps|Panini|Bowman|Upper Deck|Donruss|Leaf|Fleer|Pok[eé]mon)\b/i) || [])[1] || null;
  const rows = [];
  const add = list => { for (const r of list) if (!rows.some(x => x.item_id === r.item_id)) rows.push(r); };
  for (const p of pairs) {
    const { results } = await env.DB.prepare(`SELECT * FROM cards WHERE player_name LIKE ? ORDER BY COALESCE(date_purchased,'') DESC LIMIT 4`).bind(`%${p}%`).all();
    add(results);
  }
  if (year && brand) {
    const { results } = await env.DB.prepare(`SELECT * FROM cards WHERE year LIKE ? AND set_name LIKE ? ORDER BY COALESCE(date_purchased,'') DESC LIMIT 6`)
      .bind(`${year}%`, `%${brand}%`).all();
    add(results);
  }
  return rows.slice(0, 12).map(fileNameFromCard);
}

const GEMINI_INSTRUCTIONS = `You convert an eBay trading card listing title into the collector's file-name format.
Format: "{Year} {Set} - {Insert or subset (optional)} - {Parallel (optional)} #{Card No} - {Version (optional)} - {Player} /{Print run (optional)} [{Grade (optional)}]"
- Year is the season as printed on the product (e.g. 2025, 2025-26). Set is the product line (e.g. Topps Chrome, Panini Prizm).
- Insert/subset and parallel come after the set, separated by " - ". Omit "[Base]".
- Version is for things like "Rookie Signature Materials" or a Pokémon rarity; usually omitted.
- Print run is the serial denominator only (219/250 -> /250). Grade only if graded, as "PSA 10" or "BGS 9.5".
- Copy the collector's naming from the EXAMPLES whenever the same set, parallel or player appears (exact spelling and wording).
- Use ONLY information in the title or the examples. Do NOT guess card numbers, parallels or sets that aren't there; leave them out instead.
- Drop marketing words (RC, Rookie, SSP, Hot, Invest, team names, positions).
Return JSON: {"file_name": string, "missing": [list of fields you could not determine]}.`;

async function geminiSuggest(env, title, model = GEMINI_MODEL) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  const examples = await similarCardExamples(env, title);
  const prompt = `EXAMPLES (collector's existing file names):\n${examples.map(e => '- ' + e).join('\n') || '(none)'}\n\nTITLE: ${title}`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: GEMINI_INSTRUCTIONS }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 }
  });
  // Free tier returns 503 (overloaded) / 429 (rate limit) at times — retry with backoff.
  let res, d;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 2000 * 2 ** (attempt - 1)));
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body
    });
    d = await res.json().catch(() => ({}));
    if (res.status !== 503 && res.status !== 429) break;
  }
  if (!res.ok) return { examples: examples.length, error: `Gemini ${res.status}: ${d.error?.message || 'error'}` };
  const text = d.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  let parsed = {};
  try { parsed = JSON.parse(text); } catch (e) { return { examples: examples.length, error: 'unreadable response', raw: text.slice(0, 200) }; }
  return { examples: examples.length, suggestion: parsed.file_name || null, missing: parsed.missing || [] };
}

async function runGeminiTest(env, days, model = GEMINI_MODEL) {
  const raw = await fetchPurchaseOrders(env, days);
  const out = [];
  for (const xml of raw) {
    const o = purchaseOrderToCards(xml);
    if (o.seller === 'comc_consignment') continue;
    for (const c of o.cards) {
      const mine = await env.DB.prepare(`SELECT * FROM cards WHERE item_id = ?1 OR legacy_item_id = ?1 OR purchase_ebay_item_id = ?1 LIMIT 1`).bind(c.itemId).first();
      const g = await geminiSuggest(env, c.title, model).catch(e => ({ error: e.message }));
      out.push({ ebayTitle: c.title, yourCard: mine ? fileNameFromCard(mine) : '(not in your data)', gemini: g.suggestion || null,
        missing: g.missing, examplesUsed: g.examples, error: g.error });
    }
  }
  return { readOnly: true, model, cards: out };
}

// ── Routes (called from worker.js) ────────────────────────────────────────────
const CARD_DB_ROUTES = new Set([
  'GET:/cards', 'GET:/card-detail', 'POST:/card-update', 'POST:/card-refund', 'GET:/card-search',
  'GET:/intake-counts', 'GET:/pending', 'POST:/pending/confirm', 'POST:/pending/skip', 'GET:/parse', 'GET:/sports',
  'POST:/manual-add', 'POST:/comc-import', 'GET:/sale-review', 'POST:/sale-review/dismiss',
  'GET:/sale-import', 'GET:/purchase-import', 'GET:/backup-run', 'GET:/gemini-test'
]);

export async function handleCardDb(request, env, cors) {
  const url = new URL(request.url);
  const key = `${request.method}:${url.pathname}`;
  if (!CARD_DB_ROUTES.has(key)) return null;
  const out = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  const keyOk = request.headers.get('X-App-Key') === env.APP_KEY
    || (key === 'GET:/gemini-test' && url.searchParams.get('key') === env.APP_KEY); // test link opened in a browser
  if (!keyOk) return out({ error: 'unauthorized' }, 401);
  try {
    const p = url.pathname, q = n => url.searchParams.get(n);
    const days = () => Math.min(89, Math.max(1, parseInt(q('days') || String(LOOKBACK_DAYS), 10) || LOOKBACK_DAYS));
    const body = async () => request.json();
    switch (p) {
      case '/cards': return out(await appCards(env));
      case '/card-detail': return out(await cardDetail(env, q('item_id') || ''));
      case '/card-update': { const b = await body(); return out(await updateCard(env, b.itemId || b.item_id, b.fields)); }
      case '/card-refund': { const b = await body(); return out(await refundCard(env, b.item_id, b.type)); }
      case '/card-search': return out(await cardSearch(env, q('q')));
      case '/intake-counts': {
        const a = await env.DB.prepare(`SELECT COUNT(*) n FROM pending_metadata WHERE status = 'pending'`).first();
        const b = await env.DB.prepare(`SELECT COUNT(*) n FROM sale_review WHERE status = 'open'`).first();
        return out({ pending: a.n, review: b.n });
      }
      case '/pending': return out(await listPending(env));
      case '/pending/confirm': { const b = await body(); return out(await confirmPending(env, b.item_id, b.file_name || '', b.sport)); }
      case '/pending/skip': { const b = await body(); return out(await skipPending(env, b.item_id)); }
      case '/parse': {
        const f = parseFileName(q('name') || '');
        let suggested_sport = null;
        if (f.player_name) {
          const r = await env.DB.prepare(`SELECT sport, COUNT(*) n FROM cards WHERE LOWER(player_name) = LOWER(?) AND sport IS NOT NULL
            GROUP BY sport ORDER BY n DESC LIMIT 1`).bind(f.player_name).first();
          suggested_sport = r ? r.sport : null;
        }
        return out({ ...f, suggested_sport });
      }
      case '/sports': {
        const { results } = await env.DB.prepare(`SELECT sport FROM cards WHERE sport IS NOT NULL GROUP BY sport ORDER BY COUNT(*) DESC`).all();
        return out(results.map(r => r.sport));
      }
      case '/manual-add': return out(await manualAdd(env, await body()));
      case '/comc-import': {
        const type = q('type');
        if (!['purchases', 'sales'].includes(type)) return out({ error: 'type must be purchases or sales' }, 400);
        return out(await runComcImport(env, type, await request.text(), q('commit') === '1'));
      }
      case '/sale-review': {
        const { results } = await env.DB.prepare(`SELECT * FROM sale_review WHERE status = 'open' ORDER BY sale_date`).all();
        return out({ open: results.length, rows: results });
      }
      case '/sale-review/dismiss': {
        const b = await body();
        await env.DB.prepare(`UPDATE sale_review SET status = 'dismissed' WHERE order_id = ? AND sku = ?`).bind(b.order_id, b.sku || '').run();
        return out({ dismissed: true });
      }
      case '/sale-import': return out(await runSaleImport(env, days()));
      case '/purchase-import': return out(await runPurchaseImport(env, days()));
      case '/backup-run': return out(await writeBackup(env));
      case '/gemini-test': return out(await runGeminiTest(env, days(), (url.searchParams.get('model') || GEMINI_MODEL).replace(/[^a-z0-9.\-]/gi, '')));
    }
    return null;
  } catch (e) {
    return out({ error: e.message }, 500);
  }
}

// ── Scheduled: 7am / 7pm Eastern (run from the hourly cron at 11:00 and 23:00 UTC) ─
export async function runCardDbJobs(env) {
  for (const [name, job] of [['sale-import', runSaleImport], ['purchase-import', runPurchaseImport], ['backup', writeBackup]]) {
    try { await job(env); }
    catch (e) { await notifyCronFailure(env, `card-db-${name}`, e.message); }
  }
}
