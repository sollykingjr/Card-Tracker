// ── ebay-selling.js — GetMyeBaySelling polling + tag reconciliation
import { refreshAccessToken } from './ebay-watchlist.js';

export async function fetchMyeBaySelling(env) {
  let accessToken = await env.CACHE.get('ebay_access_token');

  if (!accessToken) {
    const refreshToken = await env.CACHE.get('ebay_refresh_token');
    if (!refreshToken) {
      return { error: 'not_authenticated', authUrl: '/auth' };
    }
    accessToken = await refreshAccessToken(refreshToken, env);
    if (!accessToken) {
      return { error: 'refresh_failed', authUrl: '/auth' };
    }
  }

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
        <RequesterCredentials>
          <eBayAuthToken>${accessToken}</eBayAuthToken>
        </RequesterCredentials>
        <ActiveList>
          <Include>true</Include>
          <Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination>
        </ActiveList>
        <SoldList>
          <Include>true</Include>
          <Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination>
        </SoldList>
        <UnsoldList>
          <Include>true</Include>
          <Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination>
        </UnsoldList>
        <DetailLevel>ReturnAll</DetailLevel>
      </GetMyeBaySellingRequest>`
  });

  const xml = await res.text();

  const extractItemIds = (sectionTag) => {
    const sectionMatch = xml.match(new RegExp(`<${sectionTag}>([\\s\\S]*?)<\\/${sectionTag}>`));
    if (!sectionMatch) return [];
    const ids = [...sectionMatch[1].matchAll(/<ItemID>(.*?)<\/ItemID>/g)].map(m => m[1]);
    return [...new Set(ids)];
  };

    return {
    active: extractItemIds('ActiveList'),
    sold: extractItemIds('SoldList'),
    unsold: extractItemIds('UnsoldList'),
  };
}

export async function reconcileListingTags(env) {
  const { active, sold, unsold, error } = await fetchMyeBaySelling(env);
  if (error) return { error };

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

  const prevActive = new Set();
  let cursor;
  do {
    const page = await env.CACHE.list({ prefix: 'listing-state:', cursor });
    for (const k of page.keys) prevActive.add(k.name.slice('listing-state:'.length));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

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
