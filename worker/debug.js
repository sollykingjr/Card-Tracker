// ── debug.js — temporary debug endpoints, delete when no longer needed ────────

export async function handleDebugAddToWatch(request, env, cors) {
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
      'X-EBAY-API-CALL-NAME': 'AddToWatchList',
      'X-EBAY-API-IAF-TOKEN': accessToken,
      'Content-Type': 'text/xml',
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
      <AddToWatchListRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${accessToken}</eBayAuthToken>
        </RequesterCredentials>
        <ItemID>147532790262</ItemID>
      </AddToWatchListRequest>`
  });

  const xml = await res.text();
  return new Response(JSON.stringify({ raw: xml }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}

export async function handleDebugToken(request, env, cors) {
  const accessToken = await env.CACHE.get('ebay_access_token');
  const refreshToken = await env.CACHE.get('ebay_refresh_token');

  return new Response(JSON.stringify({
    hasAccessToken: !!accessToken,
    accessToken,
    hasRefreshToken: !!refreshToken
  }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}
