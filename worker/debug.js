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

// TEMPORARY: list the account's business policies (read-only) to find an auction payment policy.
export async function handleDebugPolicies(request, env, cors) {
  const token = await env.CACHE.get('ebay_access_token');
  if (!token) return new Response(JSON.stringify({ error: 'no_token' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  const res = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: { 'X-EBAY-API-SITEID': '0', 'X-EBAY-API-COMPATIBILITY-LEVEL': '967', 'X-EBAY-API-CALL-NAME': 'GetUserPreferences', 'X-EBAY-API-IAF-TOKEN': token, 'Content-Type': 'text/xml' },
    body: `<?xml version="1.0" encoding="utf-8"?><GetUserPreferencesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ShowSellerProfilePreferences>true</ShowSellerProfilePreferences></GetUserPreferencesRequest>`
  });
  const xml = await res.text();
  const profiles = [];
  for (const m of xml.matchAll(/<SupportedSellerProfile[^>]*>([\s\S]*?)<\/SupportedSellerProfile>/g)) {
    const pick = t => { const x = m[1].match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`)); return x ? x[1] : ''; };
    profiles.push({ id: pick('ProfileID'), type: pick('ProfileType'), name: pick('ProfileName'), desc: pick('ShortSummary') });
  }
  return new Response(JSON.stringify({ status: res.status, profiles, rawIfEmpty: profiles.length ? undefined : xml.slice(0, 1500) }, null, 2), { headers: { ...cors, 'Content-Type': 'application/json' } });
}

