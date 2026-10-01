// ── ebay-listings.js — view and edit every live/scheduled eBay listing ───────────
// Two kinds of listing, edited two different ways:
//  • 'app'     — published by this app through the Inventory API. eBay locks these from
//                Seller Hub and from the Trading API, so they're revised by updating the
//                inventory item + offer.
//  • 'trading' — everything else (Seller Hub, CSV, older tools). Revised with ReviseItem.
import { MARKETPLACE, PACKAGE_BY_POLICY, json, getAccessToken, ebay, stepError } from './ebay-publish.js';

const TRADING_URL = 'https://api.ebay.com/ws/api.dll';

const decodeXml = (s) => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const escXml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cdata = (s) => `<![CDATA[${String(s || '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
const money = (v) => (Math.round(parseFloat(v) * 100) / 100).toFixed(2);

// First <tag>…</tag> inside xml (tag name matched exactly, attributes allowed).
function pick(xml, tag) {
  const m = String(xml || '').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`));
  return m ? decodeXml(m[1]).trim() : '';
}
function pickAll(xml, tag) {
  return [...String(xml || '').matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'g'))].map(m => decodeXml(m[1]).trim());
}
function section(xml, tag) {
  const m = String(xml || '').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1] : '';
}

async function trading(token, callName, inner) {
  const res = await fetch(TRADING_URL, {
    method: 'POST',
    headers: {
      'X-EBAY-API-SITEID': '0',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
      'X-EBAY-API-CALL-NAME': callName,
      'X-EBAY-API-IAF-TOKEN': token,
      'Content-Type': 'text/xml',
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
<${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">
${inner}
</${callName}Request>`
  });
  const xml = await res.text();
  const ack = pick(xml, 'Ack');
  const errors = [...xml.matchAll(/<Errors>([\s\S]*?)<\/Errors>/g)].map(m => ({
    code: pick(m[1], 'ErrorCode'),
    severity: pick(m[1], 'SeverityCode'),
    message: pick(m[1], 'LongMessage') || pick(m[1], 'ShortMessage'),
  }));
  const ok = res.ok && (ack === 'Success' || ack === 'Warning');
  return {
    ok, xml,
    errors: errors.filter(e => e.severity !== 'Warning'),
    warnings: errors.filter(e => e.severity === 'Warning').map(e => e.message),
  };
}

function tradingError(step, r) {
  const msg = r.errors.map(e => `${e.code}: ${e.message}`).join(' | ') || 'eBay request failed';
  return { step, message: msg, errors: r.errors };
}

// ── List ──
function parseListItem(x, status) {
  const type = pick(x, 'ListingType');
  const isAuction = type === 'Chinese';
  const current = pick(section(x, 'SellingStatus'), 'CurrentPrice');
  const price = parseFloat(isAuction ? (current || pick(x, 'StartPrice')) : (current || pick(x, 'BuyItNowPrice') || pick(x, 'StartPrice'))) || 0;
  const details = section(x, 'ListingDetails');
  return {
    listingId: pick(x, 'ItemID'),
    sku: pick(x, 'SKU'),
    title: pick(x, 'Title'),
    format: isAuction ? 'auction' : 'fixed',
    price,
    bidCount: parseInt(pick(section(x, 'SellingStatus'), 'BidCount'), 10) || 0,
    watchCount: parseInt(pick(x, 'WatchCount'), 10) || 0,
    startTime: pick(details, 'StartTime') || pick(x, 'StartTime') || null,
    endTime: pick(details, 'EndTime') || null,
    image: pick(section(x, 'PictureDetails'), 'GalleryURL') || null,
    url: pick(details, 'ViewItemURL') || null,
    status,
  };
}

async function fetchListPage(token, listTag, page) {
  const r = await trading(token, 'GetMyeBaySelling', `
  <${listTag}>
    <Include>true</Include>
    <Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination>
  </${listTag}>
  <DetailLevel>ReturnAll</DetailLevel>`);
  if (!r.ok) return { error: tradingError(listTag, r) };
  const sec = section(r.xml, listTag);
  const status = listTag === 'ScheduledList' ? 'scheduled' : 'active';
  const items = [...sec.matchAll(/<Item(?:\s[^>]*)?>([\s\S]*?)<\/Item>/g)].map(m => parseListItem(m[1], status));
  const pages = parseInt(pick(sec, 'TotalNumberOfPages'), 10) || 1;
  return { items, pages };
}

async function fetchList(token, listTag) {
  const first = await fetchListPage(token, listTag, 1);
  if (first.error) return first;
  const items = [...first.items];
  for (let p = 2; p <= Math.min(first.pages, 10); p++) {
    const next = await fetchListPage(token, listTag, p);
    if (next.error) return next;
    items.push(...next.items);
  }
  return { items };
}

// GET /ebay-my-listings → { ok, listings: [...] } (scheduled first, then active)
export async function handleEbayMyListings(request, env, cors) {
  try {
    const token = await getAccessToken(env);
    if (!token) return json({ error: 'not_authenticated', authUrl: '/auth' }, 401, cors);
    const [scheduled, active] = await Promise.all([fetchList(token, 'ScheduledList'), fetchList(token, 'ActiveList')]);
    if (scheduled.error) return json({ error: scheduled.error }, 502, cors);
    if (active.error) return json({ error: active.error }, 502, cors);
    const seen = new Set();
    const listings = [];
    for (const it of [...scheduled.items, ...active.items]) {
      if (!it.listingId || seen.has(it.listingId)) continue;
      seen.add(it.listingId);
      listings.push(it);
    }
    return json({ ok: true, listings, fetchedAt: new Date().toISOString() }, 200, cors);
  } catch (e) {
    return json({ error: e.message }, 500, cors);
  }
}

// ── Detail ──
async function getItem(token, listingId) {
  const r = await trading(token, 'GetItem', `
  <ItemID>${escXml(listingId)}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
  <IncludeWatchCount>true</IncludeWatchCount>`);
  if (!r.ok) return { error: tradingError('get_item', r) };
  const x = section(r.xml, 'Item');
  const type = pick(x, 'ListingType');
  const isAuction = type === 'Chinese';
  const status = section(x, 'SellingStatus');
  const details = section(x, 'ListingDetails');
  const start = pick(details, 'StartTime');
  return {
    listingId: pick(x, 'ItemID') || String(listingId),
    sku: pick(x, 'SKU'),
    title: pick(x, 'Title'),
    description: pick(x, 'Description'),
    format: isAuction ? 'auction' : 'fixed',
    price: parseFloat(isAuction ? pick(x, 'StartPrice') : (pick(status, 'CurrentPrice') || pick(x, 'StartPrice'))) || 0,
    currentPrice: parseFloat(pick(status, 'CurrentPrice')) || 0,
    bidCount: parseInt(pick(status, 'BidCount'), 10) || 0,
    listingStatus: pick(status, 'ListingStatus'),
    watchCount: parseInt(pick(x, 'WatchCount'), 10) || 0,
    allowOffers: pick(section(x, 'BestOfferDetails'), 'BestOfferEnabled') === 'true',
    offerAuto: parseFloat(pick(details, 'BestOfferAutoAcceptPrice')) || null,
    offerMin: parseFloat(pick(details, 'MinimumBestOfferPrice')) || null,
    shippingPolicyId: pick(section(x, 'SellerShippingProfile'), 'ShippingProfileID') || null,
    startTime: start || null,
    endTime: pick(details, 'EndTime') || null,
    scheduled: !!start && Date.parse(start) > Date.now(),
    url: pick(details, 'ViewItemURL') || null,
    images: pickAll(section(x, 'PictureDetails'), 'PictureURL'),
    condition: pick(x, 'ConditionDisplayName') || null,
  };
}

// The app's own published offer for this listing, if it made it.
async function findAppOffer(token, sku, listingId) {
  if (!sku) return null;
  const r = await ebay(token, 'GET', `/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${MARKETPLACE}`);
  const offers = r.ok && r.data && Array.isArray(r.data.offers) ? r.data.offers : [];
  return offers.find(o => o.status === 'PUBLISHED' && o.listing && String(o.listing.listingId) === String(listingId)) || null;
}

// GET /ebay-listing-detail?listingId=… → { ok, listing: {..., source: 'app'|'trading'} }
export async function handleEbayListingDetail(request, env, cors) {
  try {
    const listingId = new URL(request.url).searchParams.get('listingId');
    if (!listingId) return json({ error: 'missing listingId' }, 400, cors);
    const token = await getAccessToken(env);
    if (!token) return json({ error: 'not_authenticated', authUrl: '/auth' }, 401, cors);
    const item = await getItem(token, listingId);
    if (item.error) return json({ error: item.error }, 502, cors);
    const offer = await findAppOffer(token, item.sku, item.listingId);
    if (offer) {
      // The offer is the source of truth for these on app listings.
      const pol = offer.listingPolicies || {};
      const terms = pol.bestOfferTerms || {};
      if (offer.listingDescription) item.description = offer.listingDescription;
      if (pol.fulfillmentPolicyId) item.shippingPolicyId = pol.fulfillmentPolicyId;
      item.allowOffers = !!terms.bestOfferEnabled;
      item.offerAuto = terms.autoAcceptPrice ? parseFloat(terms.autoAcceptPrice.value) : null;
      item.offerMin = terms.autoDeclinePrice ? parseFloat(terms.autoDeclinePrice.value) : null;
    }
    item.source = offer ? 'app' : 'trading';
    item.locked = item.bidCount > 0;
    return json({ ok: true, listing: item }, 200, cors);
  } catch (e) {
    return json({ error: e.message }, 500, cors);
  }
}

// ── Update ──
// Keys updateOffer accepts; everything else from GET /offer (offerId, status, listing…) is dropped.
const OFFER_KEYS = ['availableQuantity', 'categoryId', 'charity', 'extendedProducerResponsibility', 'hideBuyerDetails',
  'includeCatalogProductDetails', 'listingDescription', 'listingDuration', 'listingPolicies', 'lotSize',
  'merchantLocationKey', 'pricingSummary', 'quantityLimitPerBuyer', 'regulatory', 'secondaryCategoryId',
  'storeCategoryNames', 'tax'];
const ITEM_KEYS = ['availability', 'condition', 'conditionDescription', 'conditionDescriptors', 'packageWeightAndSize', 'product'];

function cleanChanges(c) {
  const out = {};
  if (!c || typeof c !== 'object') return { error: 'missing changes' };
  if (c.title !== undefined) {
    const t = String(c.title).replace(/\s+/g, ' ').trim();
    if (!t) return { error: 'title can\'t be empty' };
    if (t.length > 80) return { error: 'title is over 80 characters' };
    out.title = t;
  }
  if (c.description !== undefined) out.description = String(c.description);
  if (c.price !== undefined) {
    const p = parseFloat(c.price);
    if (!(p > 0)) return { error: 'price must be more than 0' };
    out.price = money(p);
  }
  if (c.allowOffers !== undefined) {
    out.allowOffers = !!c.allowOffers;
    const a = c.offerAuto === '' || c.offerAuto == null ? null : parseFloat(c.offerAuto);
    const m = c.offerMin === '' || c.offerMin == null ? null : parseFloat(c.offerMin);
    if (a !== null && !(a > 0)) return { error: 'auto-accept must be a number' };
    if (m !== null && !(m > 0)) return { error: 'auto-decline must be a number' };
    out.offerAuto = out.allowOffers && a ? money(a) : null;
    out.offerMin = out.allowOffers && m ? money(m) : null;
  }
  if (c.shippingPolicyId !== undefined) {
    if (!/^\d+$/.test(String(c.shippingPolicyId))) return { error: 'bad shipping policy' };
    out.shippingPolicyId = String(c.shippingPolicyId);
  }
  if (!Object.keys(out).length) return { error: 'nothing to change' };
  return { changes: out };
}

async function updateAppListing(token, offer, ch) {
  const sku = offer.sku;
  const warnings = [];

  // Inventory item: title, description, package size (follows the shipping policy).
  if (ch.title !== undefined || ch.description !== undefined || ch.shippingPolicyId !== undefined) {
    const got = await ebay(token, 'GET', `/inventory_item/${encodeURIComponent(sku)}`);
    if (!got.ok) return { error: stepError('inventory_item_get', got) };
    const item = {};
    for (const k of ITEM_KEYS) if (got.data[k] !== undefined) item[k] = got.data[k];
    item.product = { ...(item.product || {}) };
    if (ch.title !== undefined) item.product.title = ch.title;
    if (ch.description !== undefined) item.product.description = ch.description;
    if (ch.shippingPolicyId !== undefined && PACKAGE_BY_POLICY[ch.shippingPolicyId]) {
      item.packageWeightAndSize = PACKAGE_BY_POLICY[ch.shippingPolicyId];
    }
    let put = await ebay(token, 'PUT', `/inventory_item/${encodeURIComponent(sku)}`, item);
    if (!put.ok && put.status >= 500) {
      await new Promise(r => setTimeout(r, 2000));
      put = await ebay(token, 'PUT', `/inventory_item/${encodeURIComponent(sku)}`, item);
    }
    if (!put.ok) return { error: stepError('inventory_item', put) };
    for (const w of (put.data && put.data.warnings) || []) warnings.push(w.longMessage || w.message);
  }

  // Offer: description shown on the listing, price, offers, shipping policy.
  if (ch.description !== undefined || ch.price !== undefined || ch.allowOffers !== undefined || ch.shippingPolicyId !== undefined) {
    const body = {};
    for (const k of OFFER_KEYS) if (offer[k] !== undefined) body[k] = JSON.parse(JSON.stringify(offer[k]));
    // Keep a future start date on scheduled listings; a past one isn't needed.
    if (offer.listingStartDate && Date.parse(offer.listingStartDate) > Date.now()) body.listingStartDate = offer.listingStartDate;
    body.listingPolicies = body.listingPolicies || {};
    if (ch.description !== undefined) body.listingDescription = ch.description;
    if (ch.price !== undefined) {
      const price = { value: ch.price, currency: 'USD' };
      body.pricingSummary = { ...(body.pricingSummary || {}) };
      if (offer.format === 'AUCTION') body.pricingSummary.auctionStartPrice = price;
      else body.pricingSummary.price = price;
    }
    if (ch.allowOffers !== undefined) {
      if (ch.allowOffers) {
        const terms = { bestOfferEnabled: true };
        if (ch.offerAuto) terms.autoAcceptPrice = { value: ch.offerAuto, currency: 'USD' };
        if (ch.offerMin) terms.autoDeclinePrice = { value: ch.offerMin, currency: 'USD' };
        body.listingPolicies.bestOfferTerms = terms;
      } else {
        body.listingPolicies.bestOfferTerms = { bestOfferEnabled: false };
      }
    }
    if (ch.shippingPolicyId !== undefined) body.listingPolicies.fulfillmentPolicyId = ch.shippingPolicyId;
    const put = await ebay(token, 'PUT', `/offer/${offer.offerId}`, body);
    if (!put.ok) return { error: stepError('offer_update', put) };
    for (const w of (put.data && put.data.warnings) || []) warnings.push(w.longMessage || w.message);
  }
  return { ok: true, warnings };
}

async function updateTradingListing(token, item, ch) {
  const parts = [`<ItemID>${escXml(item.listingId)}</ItemID>`];
  const deleted = [];
  if (ch.title !== undefined) parts.push(`<Title>${escXml(ch.title)}</Title>`);
  if (ch.description !== undefined) parts.push(`<Description>${cdata(ch.description)}</Description>`);
  if (ch.price !== undefined) parts.push(`<StartPrice currencyID="USD">${ch.price}</StartPrice>`);
  if (ch.allowOffers !== undefined) {
    parts.push(`<BestOfferDetails><BestOfferEnabled>${ch.allowOffers ? 'true' : 'false'}</BestOfferEnabled></BestOfferDetails>`);
    const ld = [];
    if (ch.offerAuto) ld.push(`<BestOfferAutoAcceptPrice currencyID="USD">${ch.offerAuto}</BestOfferAutoAcceptPrice>`);
    else if (item.offerAuto) deleted.push('Item.ListingDetails.BestOfferAutoAcceptPrice');
    if (ch.offerMin) ld.push(`<MinimumBestOfferPrice currencyID="USD">${ch.offerMin}</MinimumBestOfferPrice>`);
    else if (item.offerMin) deleted.push('Item.ListingDetails.MinimumBestOfferPrice');
    if (ld.length) parts.push(`<ListingDetails>${ld.join('')}</ListingDetails>`);
  }
  // Package weight/size on these listings is left exactly as it was set in Seller Hub.
  if (ch.shippingPolicyId !== undefined) {
    parts.push(`<SellerProfiles><SellerShippingProfile><ShippingProfileID>${ch.shippingPolicyId}</ShippingProfileID></SellerShippingProfile></SellerProfiles>`);
  }
  const r = await trading(token, 'ReviseItem', `
  <Item>${parts.join('\n    ')}</Item>
  ${deleted.map(f => `<DeletedField>${f}</DeletedField>`).join('\n  ')}`);
  if (!r.ok) return { error: tradingError('revise_item', r) };
  return { ok: true, warnings: r.warnings };
}

// POST /ebay-listing-update { listingId, changes: { title?, description?, price?, allowOffers?, offerAuto?, offerMin?, shippingPolicyId? } }
export async function handleEbayListingUpdate(request, env, cors) {
  try {
    const { listingId, changes } = await request.json();
    if (!listingId) return json({ error: 'missing listingId' }, 400, cors);
    const cleaned = cleanChanges(changes);
    if (cleaned.error) return json({ error: cleaned.error }, 400, cors);
    const ch = cleaned.changes;
    const token = await getAccessToken(env);
    if (!token) return json({ error: 'not_authenticated', authUrl: '/auth' }, 401, cors);

    const item = await getItem(token, listingId);
    if (item.error) return json({ error: item.error }, 502, cors);
    if (item.listingStatus && item.listingStatus !== 'Active') return json({ error: `listing is ${item.listingStatus.toLowerCase()} — it can't be edited` }, 409, cors);
    if (item.bidCount > 0) return json({ error: 'auction has bids — eBay only allows limited edits, do it on eBay' }, 409, cors);
    if (ch.allowOffers && item.format === 'auction') return json({ error: 'offers are only for Buy It Now listings' }, 400, cors);

    const offer = await findAppOffer(token, item.sku, item.listingId);
    const result = offer ? await updateAppListing(token, offer, ch) : await updateTradingListing(token, item, ch);
    if (result.error) return json({ error: result.error, source: offer ? 'app' : 'trading' }, 502, cors);
    return json({ ok: true, listingId: item.listingId, source: offer ? 'app' : 'trading', changed: Object.keys(ch), warnings: result.warnings || [] }, 200, cors);
  } catch (e) {
    return json({ error: e.message }, 500, cors);
  }
}

// ── End ──
// POST /ebay-listing-end { listingId } — ends a live or scheduled listing (no bids).
export async function handleEbayListingEnd(request, env, cors) {
  try {
    const { listingId } = await request.json();
    if (!listingId) return json({ error: 'missing listingId' }, 400, cors);
    const token = await getAccessToken(env);
    if (!token) return json({ error: 'not_authenticated', authUrl: '/auth' }, 401, cors);
    const item = await getItem(token, listingId);
    if (item.error) return json({ error: item.error }, 502, cors);
    if (item.listingStatus && item.listingStatus !== 'Active') return json({ error: `listing is already ${item.listingStatus.toLowerCase()}` }, 409, cors);
    if (item.bidCount > 0) return json({ error: 'auction has bids — end it on eBay' }, 409, cors);

    const offer = await findAppOffer(token, item.sku, item.listingId);
    if (offer) {
      const r = await ebay(token, 'POST', `/offer/${offer.offerId}/withdraw`);
      if (!r.ok) return json({ error: stepError('withdraw', r), source: 'app' }, 502, cors);
      return json({ ok: true, listingId: item.listingId, source: 'app' }, 200, cors);
    }
    const r = await trading(token, 'EndItem', `
  <ItemID>${escXml(item.listingId)}</ItemID>
  <EndingReason>NotAvailable</EndingReason>`);
    if (!r.ok) return json({ error: tradingError('end_item', r), source: 'trading' }, 502, cors);
    return json({ ok: true, listingId: item.listingId, source: 'trading' }, 200, cors);
  } catch (e) {
    return json({ error: e.message }, 500, cors);
  }
}
