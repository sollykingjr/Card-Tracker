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

// TEMPORARY: isolates which inventory_item field triggers eBay 25001.
// Uses throwaway SKUs (debug-variant-N), never lists anything, deletes them after.
export async function handleDebugInventoryVariants(request, env, cors) {
  const token = await env.CACHE.get('ebay_access_token');
  if (!token) return new Response(JSON.stringify({ error: 'no_token' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  const page = await env.CACHE.list({ prefix: 'ebay-queue:' });
  const firstKey = page.keys[0] && page.keys[0].name;
  const cardId = firstKey ? firstKey.slice('ebay-queue:'.length) : '';
  const listing = firstKey ? JSON.parse(await env.CACHE.get(firstKey)) : {};
  const base = {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition: 'USED_VERY_GOOD',
    product: {
      title: 'Debug test item - do not list',
      description: 'test',
      aspects: { Sport: ['Basketball'] },
      imageUrls: [`https://card-app.maxcsolomon.workers.dev/card-image/${cardId}-front.jpg`]
    }
  };
  const desc = { conditionDescriptors: [{ name: '40001', values: ['400011'] }] };
  const pkg = (h) => ({ packageWeightAndSize: { weight: { value: 1, unit: 'OUNCE' }, dimensions: { length: 6, width: 4, height: h, unit: 'INCH' } } });
  const variants = {
    '1_bare': { ...base },
    '2_with_condition_descriptor': { ...base, ...desc },
    '3_with_package_height_0.2': { ...base, ...pkg(0.2) },
    '4_with_package_height_1': { ...base, ...pkg(1) },
    '5_descriptor_plus_package_0.2': { ...base, ...desc, ...pkg(0.2) },
    '6_no_images': { ...base, product: { ...base.product, imageUrls: undefined } },
  };
  const hdrs = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Language': 'en-US', 'Accept-Language': 'en-US' };
  const out = { cardIdUsedForImage: cardId, queuedListing: listing, results: {} };
  let i = 0;
  for (const [name, body] of Object.entries(variants)) {
    i++;
    const sku = `debug-variant-${i}`;
    const r = await fetch(`https://api.ebay.com/sell/inventory/v1/inventory_item/${sku}`, { method: 'PUT', headers: hdrs, body: JSON.stringify(body) });
    const text = await r.text();
    out.results[name] = { status: r.status, body: text.slice(0, 500) };
    await fetch(`https://api.ebay.com/sell/inventory/v1/inventory_item/${sku}`, { method: 'DELETE', headers: hdrs });
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { ...cors, 'Content-Type': 'application/json' } });
}
