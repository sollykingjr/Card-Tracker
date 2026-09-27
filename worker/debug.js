// ── debug.js — temporary debug endpoints, delete when no longer needed ────────

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

// Confirms whether the current eBay access token actually carries the
// sell.inventory scope (vs. it being silently dropped / needing a growth
// check). Calls Inventory API's getInventoryItems — a 200 (even with an
// empty list) means the scope is live; look at the status/body otherwise.
export async function handleDebugInventoryScope(request, env, cors) {
  const accessToken = await env.CACHE.get('ebay_access_token');
  if (!accessToken) {
    return new Response(JSON.stringify({ error: 'no_token' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const res = await fetch('https://api.ebay.com/sell/inventory/v1/inventory_item?limit=1', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Language': 'en-US',
    },
  });

  const body = await res.text();
  return new Response(JSON.stringify({ status: res.status, body }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}
