// ── ebay-publish.js — publish a queued card straight to eBay via the Inventory API
// Flow per card: inventory item (PUT) → offer (create or update) → publishOffer.
// Live = publish now. Scheduled = listingStartDate (max 3 weeks out, eBay's limit).
import { refreshAccessToken } from './ebay-watchlist.js';

const API = 'https://api.ebay.com/sell/inventory/v1';
const MARKETPLACE = 'EBAY_US';
const LOCATION_KEY = 'home-10022';
const MAX_SCHEDULE_MS = 21 * 24 * 60 * 60 * 1000;

// Business policies — IDs are the ones already shown in the app's shipping dropdown.
const RETURN_POLICY_ID = '238602691017';  // Mascot - No returns accepted
const PAYMENT_POLICY_ID = '239080495017'; // eBay Managed Payments BIN

// Package weight/size per shipping policy (decimals are allowed in this API).
const PACKAGE_BY_POLICY = {
  '254806132017': { // PWE - Not Flat Rate
    weight: { value: 1, unit: 'OUNCE' },
    dimensions: { length: 6, width: 4, height: 0.2, unit: 'INCH' }
  }
};

// Trading-card condition descriptor IDs (eBay MIP reference).
const GRADER_IDS = {
  PSA: '275010', BCCG: '275011', BVG: '275012', BGS: '275013', CSG: '275014', CGC: '275015',
  SGC: '275016', KSA: '275017', GMA: '275018', HGA: '275019', ISA: '2750110', PCA: '2750111',
  GSG: '2750112', PGS: '2750113', MNT: '2750114', TAG: '2750115', RCG: '2750117', PCG: '2750118',
  ACE: '2750119', CGA: '2750120', TCG: '2750121', ARK: '2750122', OTHER: '2750123'
};
const GRADE_IDS = {
  '10': '275020', '9.5': '275021', '9': '275022', '8.5': '275023', '8': '275024', '7.5': '275025',
  '7': '275026', '6.5': '275027', '6': '275028', '5.5': '275029', '5': '2750210', '4.5': '2750211',
  '4': '2750212', '3.5': '2750213', '3': '2750214', '2.5': '2750215', '2': '2750216', '1.5': '2750217',
  '1': '2750218', 'AUTHENTIC': '2750219'
};
const UNGRADED_IDS = {
  'Near mint or better': '400010', 'Excellent': '400011', 'Very good': '400012', 'Poor': '400013'
};

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...cors, 'Content-Type': 'application/json' }
  });
}

async function getAccessToken(env) {
  let token = await env.CACHE.get('ebay_access_token');
  if (token) return token;
  const refresh = await env.CACHE.get('ebay_refresh_token');
  if (!refresh) return null;
  return refreshAccessToken(refresh, env);
}

async function ebay(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US',
      'Accept-Language': 'en-US',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

function stepError(step, r) {
  const errs = (r.data && r.data.errors) || [];
  const msg = errs.map(e => `${e.errorId}: ${e.longMessage || e.message}`).join(' | ') || `HTTP ${r.status}`;
  return { step, status: r.status, message: msg, errors: errs };
}

// Creates the single ship-from location the first time it's needed.
async function ensureLocation(token) {
  const got = await ebay(token, 'GET', `/location/${LOCATION_KEY}`);
  if (got.ok) return null;
  const created = await ebay(token, 'POST', `/location/${LOCATION_KEY}`, {
    name: 'Home',
    merchantLocationStatus: 'ENABLED',
    locationTypes: ['WAREHOUSE'],
    location: { address: { city: 'New York', stateOrProvince: 'NY', postalCode: '10022', country: 'US' } }
  });
  return created.ok ? null : stepError('location', created);
}

function buildConditionAndDescriptors(l) {
  if (l.isGraded) {
    const graderId = GRADER_IDS[(l.grader || '').trim().toUpperCase()];
    const gradeId = GRADE_IDS[(l.grade || '').trim().toUpperCase()];
    if (!graderId) return { error: `Unknown grader "${l.grader}"` };
    if (!gradeId) return { error: `Unknown grade "${l.grade}"` };
    return {
      condition: 'LIKE_NEW',
      conditionDescriptors: [
        { name: '27501', values: [graderId] },
        { name: '27502', values: [gradeId] }
      ]
    };
  }
  const condId = UNGRADED_IDS[l.condition] || UNGRADED_IDS['Excellent'];
  return { condition: 'USED_VERY_GOOD', conditionDescriptors: [{ name: '40001', values: [condId] }] };
}

function buildAspects(l) {
  const aspects = {};
  const add = (name, val) => { if (val !== undefined && val !== null && String(val).trim() !== '') aspects[name] = [String(val).trim()]; };
  if ((l.cardType || 'sports') === 'sports') {
    add('Sport', l.sport);
    add('Player/Athlete', l.player);
    add('Team', l.team);
    add('League', l.league);
    add('Autographed', l.autographed);
  } else {
    add('Game', l.game);
  }
  add('Manufacturer', l.manufacturer);
  add('Season', l.season);
  const year = String(l.season || '').match(/\d{4}/); // "2023-24" → 2023 (eBay wants a number here)
  if (year) add('Year Manufactured', year[0]);
  add('Parallel/Variety', l.parallel);
  add('Set', l.set);
  add('Card Number', l.cardNo);
  add('Print Run', l.printRun);
  if (l.printRun) add('Features', 'Serial Numbered');
  add('Country of Origin', l.country);
  return aspects;
}

// ── Promoted Listings (general / cost-per-sale) ──
const MKT = 'https://api.ebay.com/sell/marketing/v1';
const CAMPAIGN_KV = 'ebay-promo-campaign-id';

async function mkt(token, method, path, body) {
  const res = await fetch(`${MKT}${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data, headers: res.headers };
}

// Reuses a running manual cost-per-sale campaign (cached in KV), else creates "Card Tracker".
async function getPromoCampaignId(token, env) {
  const cached = await env.CACHE.get(CAMPAIGN_KV);
  if (cached) {
    const c = await mkt(token, 'GET', `/ad_campaign/${cached}`);
    if (c.ok && c.data && ['RUNNING', 'SCHEDULED'].includes(c.data.campaignStatus)) return { id: cached };
  }
  const list = await mkt(token, 'GET', '/ad_campaign?campaign_status=RUNNING&limit=100');
  const found = list.ok && list.data && (list.data.campaigns || []).find(c =>
    c.marketplaceId === MARKETPLACE &&
    c.fundingStrategy && c.fundingStrategy.fundingModel === 'COST_PER_SALE' &&
    !c.campaignCriterion // rules-based campaigns can't take manually added listings
  );
  if (found) {
    await env.CACHE.put(CAMPAIGN_KV, found.campaignId);
    return { id: found.campaignId };
  }
  const created = await mkt(token, 'POST', '/ad_campaign', {
    campaignName: 'Card Tracker',
    marketplaceId: MARKETPLACE,
    startDate: new Date().toISOString(),
    fundingStrategy: { fundingModel: 'COST_PER_SALE', bidPercentage: '2.0' }
  });
  if (!created.ok) return { error: stepError('promo_campaign', created) };
  const loc = created.headers.get('Location') || '';
  const id = loc.split('/').pop();
  if (!id) return { error: { step: 'promo_campaign', message: 'no campaign id returned' } };
  await env.CACHE.put(CAMPAIGN_KV, id);
  return { id };
}

async function promoteListing(token, env, listingId, rate) {
  const camp = await getPromoCampaignId(token, env);
  if (camp.error) return camp;
  const ad = await mkt(token, 'POST', `/ad_campaign/${camp.id}/ad`, { listingId, bidPercentage: rate });
  if (!ad.ok) return { error: stepError('promo_ad', ad) };
  return { ok: true, campaignId: camp.id, rate };
}

export function buildInventoryItem(l, itemId, shippingPolicyId, cond) {
  cond = cond || buildConditionAndDescriptors(l);
  const item = {
    availability: { shipToLocationAvailability: { quantity: parseInt(l.quantity, 10) || 1 } },
    condition: cond.condition,
    conditionDescriptors: cond.conditionDescriptors,
    product: {
      title: (l.title || '').slice(0, 80),
      description: l.description || '',
      aspects: buildAspects(l),
      imageUrls: [
        `https://card-app.maxcsolomon.workers.dev/card-image/${itemId}-front.jpg`,
        `https://card-app.maxcsolomon.workers.dev/card-image/${itemId}-back.jpg`
      ]
    }
  };
  const pkg = PACKAGE_BY_POLICY[shippingPolicyId];
  if (pkg) item.packageWeightAndSize = pkg;
  return item;
}

// POST /ebay-publish  { itemId, shippingPolicyId, mode: 'live'|'scheduled', startDate?: ISO string }
export async function handleEbayPublish(request, env, cors) {
  try {
    const { itemId, shippingPolicyId, mode, startDate } = await request.json();
    if (!itemId || !shippingPolicyId) return json({ error: 'missing itemId or shippingPolicyId' }, 400, cors);
    if (mode !== 'live' && mode !== 'scheduled') return json({ error: 'mode must be live or scheduled' }, 400, cors);

    let listingStartDate;
    if (mode === 'scheduled') {
      const d = new Date(startDate || '');
      const diff = d.getTime() - Date.now();
      if (isNaN(d.getTime()) || diff <= 0) return json({ error: 'scheduled needs a future startDate' }, 400, cors);
      if (diff > MAX_SCHEDULE_MS) return json({ error: 'eBay only allows scheduling up to 3 weeks out' }, 400, cors);
      listingStartDate = d.toISOString();
    }

    const raw = await env.CACHE.get(`ebay-queue:${itemId}`);
    if (!raw) return json({ error: 'card not in eBay queue' }, 404, cors);
    const l = JSON.parse(raw);

    const cond = buildConditionAndDescriptors(l);
    if (cond.error) return json({ error: cond.error, step: 'condition' }, 400, cors);

    const token = await getAccessToken(env);
    if (!token) return json({ error: 'not_authenticated', authUrl: '/auth' }, 401, cors);

    const locErr = await ensureLocation(token);
    if (locErr) return json({ error: locErr }, 502, cors);

    const sku = itemId;
    const qty = parseInt(l.quantity, 10) || 1;

    // 1) Inventory item
    const item = buildInventoryItem(l, itemId, shippingPolicyId, cond);

    // PUT is idempotent, so retry once on eBay's transient 25001 "system error".
    let put = await ebay(token, 'PUT', `/inventory_item/${encodeURIComponent(sku)}`, item);
    if (!put.ok && put.status >= 500) {
      await new Promise(r => setTimeout(r, 2000));
      put = await ebay(token, 'PUT', `/inventory_item/${encodeURIComponent(sku)}`, item);
    }
    if (!put.ok) return json({ error: stepError('inventory_item', put) }, 502, cors);

    // 2) Offer
    const isAuction = l.format === 'Auction';
    const price = { value: String(parseFloat(l.price || 0).toFixed(2)), currency: 'USD' };
    const offer = {
      sku,
      marketplaceId: MARKETPLACE,
      format: isAuction ? 'AUCTION' : 'FIXED_PRICE',
      availableQuantity: qty,
      categoryId: (l.cardType || 'sports') === 'sports' ? '261328' : '183454',
      listingDescription: l.description || '',
      listingDuration: isAuction ? 'DAYS_7' : 'GTC',
      merchantLocationKey: LOCATION_KEY,
      pricingSummary: isAuction ? { auctionStartPrice: price } : { price },
      listingPolicies: {
        fulfillmentPolicyId: shippingPolicyId,
        paymentPolicyId: PAYMENT_POLICY_ID,
        returnPolicyId: RETURN_POLICY_ID
      }
    };
    if (!isAuction && l.allowOffers) {
      const terms = { bestOfferEnabled: true };
      if (l.offerAuto) terms.autoAcceptPrice = { value: String(parseFloat(l.offerAuto).toFixed(2)), currency: 'USD' };
      if (l.offerMin) terms.autoDeclinePrice = { value: String(parseFloat(l.offerMin).toFixed(2)), currency: 'USD' };
      offer.listingPolicies.bestOfferTerms = terms;
    }
    if (listingStartDate) offer.listingStartDate = listingStartDate;

    let offerId;
    const existing = await ebay(token, 'GET', `/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${MARKETPLACE}`);
    const prior = existing.ok && existing.data && Array.isArray(existing.data.offers) ? existing.data.offers[0] : null;
    if (prior) {
      if (prior.status === 'PUBLISHED') {
        return json({ error: 'already published on eBay', step: 'offer', listingId: prior.listing && prior.listing.listingId }, 409, cors);
      }
      offerId = prior.offerId;
      const upd = await ebay(token, 'PUT', `/offer/${offerId}`, offer);
      if (!upd.ok) return json({ error: stepError('offer_update', upd) }, 502, cors);
    } else {
      const created = await ebay(token, 'POST', '/offer', offer);
      if (!created.ok) return json({ error: stepError('offer_create', created) }, 502, cors);
      offerId = created.data.offerId;
    }

    // 3) Publish
    const pub = await ebay(token, 'POST', `/offer/${offerId}/publish`);
    if (!pub.ok) return json({ error: stepError('publish', pub), offerId }, 502, cors);

    const listingId = pub.data && pub.data.listingId;

    // 4) Optional Promoted Listings ad rate. A failure here doesn't undo the listing.
    let promo = null;
    const rateNum = parseFloat(l.adRate);
    if (listingId && !isNaN(rateNum) && rateNum > 0) {
      promo = await promoteListing(token, env, listingId, rateNum.toFixed(1));
    }

    return json({
      ok: true, itemId, offerId, listingId,
      mode, listingStartDate: listingStartDate || null,
      promo,
      warnings: (pub.data && pub.data.warnings) || []
    }, 200, cors);
  } catch (e) {
    return json({ error: e.message }, 500, cors);
  }
}
