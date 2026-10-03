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

export default {
  async scheduled(event, env, ctx) {
    try {
      await runSalesFeed(env);
    } catch (e) {
      console.error('sales-feed-staging cron failed:', e.message);
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/sales-feed-run' && url.pathname !== '/purchases-test') return json({ error: 'not found' }, 404);
    if (!env.APP_KEY || url.searchParams.get('key') !== env.APP_KEY) return json({ error: 'unauthorized' }, 401);
    try {
      if (url.pathname === '/purchases-test') return json(await runPurchasesTest(env, Math.min(89, Math.max(1, parseInt(url.searchParams.get('days') || String(LOOKBACK_DAYS), 10) || LOOKBACK_DAYS))));
      return json(await runSalesFeed(env, { dryRun: url.searchParams.get('dry') === '1' }));
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }
};
