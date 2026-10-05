// ── ebay-selling.js — GetMyeBaySelling polling + tag reconciliation
import { refreshAccessToken } from './ebay-watchlist.js';

async function getSellingToken(env) {
  let accessToken = await env.CACHE.get('ebay_access_token');
  if (accessToken) return { accessToken };
  const refreshToken = await env.CACHE.get('ebay_refresh_token');
  if (!refreshToken) return { error: 'not_authenticated' };
  accessToken = await refreshAccessToken(refreshToken, env);
  return accessToken ? { accessToken } : { error: 'refresh_failed' };
}

const decodeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// One GetMyeBaySelling call for one list section + page. Returns parsed items and page count.
async function fetchSellingPage(accessToken, listTag, page) {
  const res = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: {
      'X-EBAY-API-SITEID': '0',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
      'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
      'X-EBAY-API-IAF-TOKEN': accessToken,
      'Content-Type': 'text/xml',
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
      <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials><eBayAuthToken>${accessToken}</eBayAuthToken></RequesterCredentials>
        <${listTag}>
          <Include>true</Include>
          <Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination>
        </${listTag}>
        <DetailLevel>ReturnAll</DetailLevel>
      </GetMyeBaySellingRequest>`
  });
  const xml = await res.text();
  const ack = (xml.match(/<Ack>([^<]*)<\/Ack>/) || [])[1];
  if (ack !== 'Success' && ack !== 'Warning') {
    const msg = ((xml.match(/<LongMessage>([^<]*)<\/LongMessage>/) || [])[1] || xml.slice(0, 200)).trim();
    const err = new Error(`GetMyeBaySelling ${listTag} ${ack || res.status}: ${msg}`);
    err.authFailed = /auth|token/i.test(msg);
    throw err;
  }
  const section = xml.match(new RegExp(`<${listTag}[^>]*>([\\s\\S]*?)<\\/${listTag}>`));
  if (!section) return { items: [], pages: 0 };
  const items = [];
  for (const m of section[1].matchAll(/<Item[^>]*>([\s\S]*?)<\/Item>/g)) {
    const pick = (tag) => { const x = m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)); return x ? decodeXml(x[1]).trim() : ''; };
    const sku = pick('SKU');
    if (sku) items.push({ sku, listingId: pick('ItemID'), startTime: pick('StartTime') });
  }
  const pagesMatch = section[1].match(/<TotalNumberOfPages[^>]*>(\d+)<\/TotalNumberOfPages>/);
  return { items, pages: pagesMatch ? parseInt(pagesMatch[1], 10) : 1 };
}

// All items in a list section, following pagination (capped at 10 pages = 2,000 items).
async function fetchSellingList(accessToken, listTag, allPages) {
  const first = await fetchSellingPage(accessToken, listTag, 1);
  const items = [...first.items];
  if (allPages) {
    for (let p = 2; p <= Math.min(first.pages, 10); p++) {
      items.push(...(await fetchSellingPage(accessToken, listTag, p)).items);
    }
  }
  return items;
}

// Runs fn(accessToken). If eBay rejects the token, drop the cached copy, fetch a fresh one and retry once.
// A missing/!refreshable connection comes back as { error } like before.
async function withFreshToken(env, fn) {
  for (let attempt = 0; ; attempt++) {
    const tok = await getSellingToken(env);
    if (tok.error) return { error: tok.error, authUrl: '/auth' };
    try {
      return await fn(tok.accessToken);
    } catch (e) {
      if (!e.authFailed || attempt >= 1) throw e;
      await env.CACHE.delete('ebay_access_token');
    }
  }
}

// Live listings (active + scheduled) with details, keyed by SKU = card Item ID.
export async function fetchLiveListings(env) {
  try {
    return await withFreshToken(env, async (accessToken) => {
      const [active, scheduled] = await Promise.all([
        fetchSellingList(accessToken, 'ActiveList', true),
        fetchSellingList(accessToken, 'ScheduledList', true),
      ]);
      return { active, scheduled };
    });
  } catch (e) {
    return { error: e.message };
  }
}

// Match listings to cards by Custom Label (SKU), which is set to the app's card Item ID.
// Scheduled listings count as listed. Listings with no SKU are skipped.
export async function fetchMyeBaySelling(env) {
  // A failed call throws (the cron then alerts): an auth error must never look like "no listings",
  // or every Listed tag would be stripped and sold cards would miss their Sold tag.
  return withFreshToken(env, async (accessToken) => {
    const [active, scheduled, sold, unsold] = await Promise.all([
      fetchSellingList(accessToken, 'ActiveList', true),
      fetchSellingList(accessToken, 'ScheduledList', true),
      fetchSellingList(accessToken, 'SoldList', false),
      fetchSellingList(accessToken, 'UnsoldList', false),
    ]);
    const skus = (arr) => [...new Set(arr.map(i => i.sku))];
    return {
      active: skus([...active, ...scheduled]),
      sold: skus(sold),
      unsold: skus(unsold),
    };
  });
}

export async function reconcileListingTags(env) {
  const getTags = async (itemId) => {
    const existing = await env.CACHE.get(`card-meta:${itemId}`, { type: 'json' });
    return (existing && Array.isArray(existing.tags)) ? existing.tags : [];
  };

  const setTags = async (itemId, tags) => {
    const key = `card-meta:${itemId}`;
    const existing = await env.CACHE.get(key, { type: 'json' });
    const inHand = existing && existing.inHand ? true : false;
    if (!tags.length && !inHand) {
      await env.CACHE.delete(key);
    } else {
      await env.CACHE.put(key, JSON.stringify({ tags, inHand }), { metadata: { tags, inHand } });
    }
  };

  const listIds = async (prefix) => {
    const ids = new Set();
    let cursor;
    do {
      const page = await env.CACHE.list({ prefix, cursor });
      for (const k of page.keys) ids.add(k.name.slice(prefix.length));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return ids;
  };

  // One-time cleanup: the previous version keyed listing-state:/tag-snapshot:/card-meta:
  // by eBay listing numbers instead of SKUs. Every such key present before this flag is set
  // came from that version — restore tags from snapshots and remove the stale keys.
  const MIGRATION_FLAG = 'migration:sku-matching-v1';
  if (!(await env.CACHE.get(MIGRATION_FLAG))) {
    const staleIds = new Set([
      ...(await listIds('listing-state:')),
      ...(await listIds('tag-snapshot:')),
    ]);
    for (const id of staleIds) {
      const snapshot = await env.CACHE.get(`tag-snapshot:${id}`, { type: 'json' });
      if (Array.isArray(snapshot)) {
        await setTags(id, snapshot);
      } else {
        const tags = await getTags(id);
        await setTags(id, tags.filter(t => t !== 'Listed' && t !== 'Sold'));
      }
      await env.CACHE.delete(`tag-snapshot:${id}`);
      await env.CACHE.delete(`listing-state:${id}`);
    }
    await env.CACHE.put(MIGRATION_FLAG, new Date().toISOString());
  }

  const { active, sold, unsold, error } = await fetchMyeBaySelling(env);
  if (error) return { error };

  const prevActive = await listIds('listing-state:');

  const activeSet = new Set(active);
  const soldSet = new Set(sold);

  for (const itemId of active) {
    if (prevActive.has(itemId)) continue;
    const tags = await getTags(itemId);
    await env.CACHE.put(`tag-snapshot:${itemId}`, JSON.stringify(tags));
    await setTags(itemId, [...new Set([...tags, 'Listed'])]);
    await env.CACHE.put(`listing-state:${itemId}`, 'active');
  }

  for (const itemId of prevActive) {
    if (activeSet.has(itemId)) continue;
    const tags = await getTags(itemId);
    if (soldSet.has(itemId)) {
      await setTags(itemId, [...new Set([...tags.filter(t => t !== 'Listed'), 'Sold'])]);
      await env.CACHE.delete(`tag-snapshot:${itemId}`);
    } else {
      const snapshot = await env.CACHE.get(`tag-snapshot:${itemId}`, { type: 'json' });
      const restored = Array.isArray(snapshot) ? snapshot : tags.filter(t => t !== 'Listed');
      await setTags(itemId, restored);
      await env.CACHE.delete(`tag-snapshot:${itemId}`);
    }
    await env.CACHE.delete(`listing-state:${itemId}`);
  }

  return { active: active.length, sold: sold.length, unsold: unsold.length };
}
