// ── debug.js — temporary debug endpoints, delete when no longer needed ────────
import { fetchMyeBaySelling } from './ebay-selling.js';

export async function handleDebugSelling(request, env, cors) {
  const result = await fetchMyeBaySelling(env);

  const listIds = async (prefix) => {
    const ids = [];
    let cursor;
    do {
      const page = await env.CACHE.list({ prefix, cursor });
      for (const k of page.keys) ids.push(k.name.slice(prefix.length));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return ids;
  };

  const migrationFlag = await env.CACHE.get('migration:sku-matching-v1');
  const listingState = await listIds('listing-state:');
  const tagSnapshots = await listIds('tag-snapshot:');

  return new Response(JSON.stringify({
    fetchResult: result,
    migrationFlag,
    listingState,
    tagSnapshots,
  }, null, 2), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}

export async function handleDebugRawWatchlist(request, env, cors) {
  const accessToken = await env.CACHE.get('ebay_access_token');
  if (!accessToken) {
    return new Response(JSON.stringify({ error: 'no_token' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const res = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: {
      'X-EBAY-API-SITEID': '0',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
      'X-EBAY-API-CALL-NAME': 'GetMyeBayBuying',
      'X-EBAY-API-IAF-TOKEN': accessToken,
      'Content-Type': 'text/xml',
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
      <GetMyeBayBuyingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${accessToken}</eBayAuthToken>
        </RequesterCredentials>
        <WatchList>
          <Include>true</Include>
          <Pagination>
            <EntriesPerPage>1</EntriesPerPage>
            <PageNumber>1</PageNumber>
          </Pagination>
        </WatchList>
        <DetailLevel>ReturnAll</DetailLevel>
      </GetMyeBayBuyingRequest>`
  });

  const xml = await res.text();
  return new Response(JSON.stringify({ raw: xml }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}
