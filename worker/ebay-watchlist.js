// ── watchlist.js — eBay OAuth, watchlist caching, saved titles, sniping
import { notifyCronFailure } from './misc.js';

export const RUNAME = 'Max_Solomon-MaxSolom-MCSTra-anhpmrm';
export const SCOPES = 'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory.readonly https://api.ebay.com/oauth/api_scope/commerce.identity.readonly';

export function handleAuth(env) {
  const authUrl = `https://auth.ebay.com/oauth2/authorize?client_id=${env.EBAY_CLIENT_ID}&response_type=code&redirect_uri=${RUNAME}&scope=${encodeURIComponent(SCOPES)}`;
  return Response.redirect(authUrl, 302);
}

// ── [4] handleCallback ────────────────────────────────────────────────────────
export async function handleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (!code) return new Response('No code received.', { status: 400 });

  const credentials = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
  const body = `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${RUNAME}`;

  const tokenRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body
  });

  const tokens = await tokenRes.json();
  if (!tokens.access_token) {
    return new Response(`Token error: ${JSON.stringify(tokens)}`, { status: 500 });
  }

  await env.CACHE.put('ebay_access_token', tokens.access_token, { expirationTtl: 7200 });
  if (tokens.refresh_token) {
    await env.CACHE.put('ebay_refresh_token', tokens.refresh_token);
  }

  return new Response('Authentication successful! You can close this tab and return to the app.');
}

// ── [5] handleWatchlist ───────────────────────────────────────────────────────
export const WATCHLIST_CACHE_KEY = 'watchlist-cache';
export const WATCHLIST_CACHE_TTL = 1200; // 20 min — slightly longer than the 15-min cron, so a missed run falls back to live rather than serving stale data indefinitely

export async function fetchWatchlistFromEbay(env) {
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

  const watchRes = await fetch('https://api.ebay.com/ws/api.dll', {
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
            <EntriesPerPage>200</EntriesPerPage>
            <PageNumber>1</PageNumber>
          </Pagination>
        </WatchList>
        <DetailLevel>ReturnAll</DetailLevel>
        <OutputSelector>Item.ItemID</OutputSelector>
        <OutputSelector>Item.Title</OutputSelector>
        <OutputSelector>Item.EndTime</OutputSelector>
        <OutputSelector>Item.SellingStatus.CurrentPrice</OutputSelector>
        <OutputSelector>Item.PictureDetails.GalleryURL</OutputSelector>
      </GetMyeBayBuyingRequest>`
  });

  const xml = await watchRes.text();
  const now = Date.now();
  const itemMatches = xml.matchAll(/<Item>([\s\S]*?)<\/Item>/g);

  const rawItems = [];
  for (const match of itemMatches) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}>(.*?)<\/${tag}>`));
      return m ? m[1] : null;
    };

    const endTime = get('EndTime');
    if (endTime && new Date(endTime).getTime() < now) continue;

    const galleryMatch = block.match(/<GalleryURL>(.*?)<\/GalleryURL>/);

    rawItems.push({
      itemId: get('ItemID'),
      title: get('Title'),
      endTime,
      currentPrice: get('CurrentPrice'),
      currency: get('CurrencyID'),
      image: galleryMatch ? galleryMatch[1] : null,
    });
  }

  const savedTitles = await Promise.all(
    rawItems.map(item => item.itemId ? env.CACHE.get(`title:${item.itemId}`) : Promise.resolve(null))
  );

  const items = rawItems.map((item, i) => ({
    ...item,
    savedTitle: savedTitles[i],
  }));

  items.sort((a, b) => {
    if (!a.endTime && !b.endTime) return 0;
    if (!a.endTime) return 1;
    if (!b.endTime) return -1;
    return new Date(a.endTime) - new Date(b.endTime);
  });

  return { items, count: items.length };
}

export async function refreshWatchlistCache(env) {
  const data = await fetchWatchlistFromEbay(env);
  if (data.error) {
    if (data.error === 'refresh_failed') {
      await notifyCronFailure(env, 'watchlist-auth', 'Your eBay connection expired — tap Connect eBay in the app to reconnect.');
    }
    return; // don't overwrite a good cache with an auth failure
  }
  await env.CACHE.put(WATCHLIST_CACHE_KEY, JSON.stringify(data), { expirationTtl: WATCHLIST_CACHE_TTL });
}

export async function handleWatchlist(request, env, cors) {
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get('refresh') === '1';

  if (!forceRefresh) {
    const cached = await env.CACHE.get(WATCHLIST_CACHE_KEY);
    if (cached) {
      return new Response(cached, { headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  }

  const data = await fetchWatchlistFromEbay(env);
  if (data.error) {
    return new Response(JSON.stringify(data), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  await env.CACHE.put(WATCHLIST_CACHE_KEY, JSON.stringify(data), { expirationTtl: WATCHLIST_CACHE_TTL });
  return new Response(JSON.stringify(data), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}

// ── [6] handleSaveTitle ───────────────────────────────────────────────────────
export async function handleSaveTitle(request, env, cors) {
  try {
    const { itemId, title } = await request.json();
    if (!itemId || !title) {
      return new Response(JSON.stringify({ error: 'missing itemId or title' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
    await env.CACHE.put(`title:${itemId}`, title, { expirationTtl: 604800 });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

// ── [7] refreshAccessToken ────────────────────────────────────────────────────
export async function refreshAccessToken(refreshToken, env) {
  const credentials = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&scope=${encodeURIComponent(SCOPES)}`
  });
  const tokens = await res.json();
  if (!tokens.access_token) return null;
  await env.CACHE.put('ebay_access_token', tokens.access_token, { expirationTtl: 7200 });
  return tokens.access_token;
}

export async function handleAddToWatch(request, env, cors) {
  try {
    const { itemId } = await request.json();
    if (!itemId) {
      return new Response(JSON.stringify({ error: 'missing itemId' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    let accessToken = await env.CACHE.get('ebay_access_token');
    if (!accessToken) {
      const refreshToken = await env.CACHE.get('ebay_refresh_token');
      if (!refreshToken) {
        return new Response(JSON.stringify({ error: 'not_authenticated' }), {
          status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      accessToken = await refreshAccessToken(refreshToken, env);
      if (!accessToken) {
        return new Response(JSON.stringify({ error: 'refresh_failed' }), {
          status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
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
          <ItemID>${itemId}</ItemID>
        </AddToWatchListRequest>`
    });

    const xml = await res.text();
    const ack = xml.match(/<Ack>(.*?)<\/Ack>/)?.[1] || 'Unknown';
    const count = xml.match(/<WatchListCount>(.*?)<\/WatchListCount>/)?.[1];
    const max = xml.match(/<WatchListMaximum>(.*?)<\/WatchListMaximum>/)?.[1];

    return new Response(JSON.stringify({ ok: ack === 'Success' || ack === 'Warning', ack, count, max }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

export async function handleRemoveFromWatch(request, env, cors) {
  try {
    const { itemIds } = await request.json();
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return new Response(JSON.stringify({ error: 'missing itemIds array' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    let accessToken = await env.CACHE.get('ebay_access_token');
    if (!accessToken) {
      const refreshToken = await env.CACHE.get('ebay_refresh_token');
      if (!refreshToken) {
        return new Response(JSON.stringify({ error: 'not_authenticated' }), {
          status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      accessToken = await refreshAccessToken(refreshToken, env);
      if (!accessToken) {
        return new Response(JSON.stringify({ error: 'refresh_failed' }), {
          status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
    }

    const itemIdTags = itemIds.map(id => `<ItemID>${id}</ItemID>`).join('');

    const res = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: {
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-CALL-NAME': 'RemoveFromWatchList',
        'X-EBAY-API-IAF-TOKEN': accessToken,
        'Content-Type': 'text/xml',
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
        <RemoveFromWatchListRequest xmlns="urn:ebay:apis:eBLBaseComponents">
          <RequesterCredentials>
            <eBayAuthToken>${accessToken}</eBayAuthToken>
          </RequesterCredentials>
          ${itemIdTags}
        </RemoveFromWatchListRequest>`
    });

    const xml = await res.text();
    const ack = xml.match(/<Ack>(.*?)<\/Ack>/)?.[1] || 'Unknown';
    const count = xml.match(/<WatchListCount>(.*?)<\/WatchListCount>/)?.[1];

    return new Response(JSON.stringify({ ok: ack === 'Success' || ack === 'Warning', ack, count }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

export async function handleSetSnipe(request, env, cors) {
  try {
    const { itemId, maxBid } = await request.json();
    if (!itemId || !maxBid) return new Response(JSON.stringify({ error: 'missing itemId or maxBid' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    });

    const url = `https://www.gixen.com/api.php?username=${encodeURIComponent(env.GIXEN_USERNAME)}&password=${encodeURIComponent(env.GIXEN_PASSWORD)}&itemid=${encodeURIComponent(itemId)}&maxbid=${encodeURIComponent(maxBid)}&main=1`;
    const res = await fetch(url);
    const text = await res.text();

    const ok = text.includes('ERROR_CODE=0');
    return new Response(JSON.stringify({ ok: false, raw: text }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

