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

// Creates the test tab (headers + currency format on C:F) if it doesn't exist yet.
async function ensureTab(env) {
  const meta = await sheetsFetch(env, '?fields=sheets.properties');
  if (meta.sheets.some(s => s.properties.title === TAB)) return false;
  const added = await sheetsFetch(env, ':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB } } }] })
  });
  const sheetId = added.replies[0].addSheet.properties.sheetId;
  await sheetsFetch(env, `/values/${encodeURIComponent(`'${TAB}'!A1:L1`)}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: [HEADERS] })
  });
  await sheetsFetch(env, ':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ requests: [{ repeatCell: {
      range: { sheetId, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 6 },
      cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '$#,##0.00' } } },
      fields: 'userEnteredFormat.numberFormat'
    } }] })
  });
  return true;
}

async function runSalesFeed(env, { dryRun = false } = {}) {
  const orders = await fetchOrders(env);
  if (dryRun) {
    return { dryRun: true, ordersFound: orders.length, sample: orders.slice(0, 3).map(orderToRow) };
  }
  const tabCreated = await ensureTab(env);
  const existing = await sheetsFetch(env, `/values/${encodeURIComponent(`'${TAB}'!A:A`)}`);
  const seen = new Set((existing.values || []).map(r => r[0]));
  const newRows = orders.filter(o => !seen.has(o.orderId))
    .sort((a, b) => a.creationDate.localeCompare(b.creationDate))
    .map(orderToRow);
  if (newRows.length) {
    await sheetsFetch(env,
      `/values/${encodeURIComponent(`'${TAB}'!A:L`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: JSON.stringify({ values: newRows }) });
  }
  return { tabCreated, ordersFound: orders.length, appended: newRows.length, appendedOrderIds: newRows.map(r => r[0]) };
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
    if (url.pathname !== '/sales-feed-run') return json({ error: 'not found' }, 404);
    if (!env.APP_KEY || url.searchParams.get('key') !== env.APP_KEY) return json({ error: 'unauthorized' }, 401);
    try {
      return json(await runSalesFeed(env, { dryRun: url.searchParams.get('dry') === '1' }));
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }
};
