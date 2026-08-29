// ── search-alerts.js — eBay search building, cron jobs, digests, run/mark-seen
import { notifyCronFailure } from './misc.js';

export function buildEbaySearchUrl(search, offset) {
  const filters = [];
  if (search.listingType && search.listingType !== 'BOTH') filters.push(`buyingOptions:{${search.listingType}}`);
  if (search.seller) {
    if (search.sellerMode === 'include') filters.push(`sellers:{${search.seller}}`);
    else filters.push(`excludeSellers:{${search.seller}}`);
  }
  if (search.condition === 'Graded') filters.push('conditionIds:{2750}');
  if (search.condition === 'Ungraded') filters.push('conditionIds:{4000}');
  if (search.usOnly) filters.push('itemLocationCountry:US');
  if (search.minPrice || search.maxPrice) {
    filters.push(`price:[${search.minPrice || '0'}..${search.maxPrice || ''}]`);
    filters.push('priceCurrency:USD');
  }
  const filterStr = filters.length ? `&filter=${encodeURIComponent(filters.join(','))}` : '';

  const categoryMap = { sports: '212', gaming: '183454', nonsport: '183050' };
  const categoryId = categoryMap[search.categoryType] || null;

  const aspects = [];
  if (search.serial && categoryId !== '183454') aspects.push('Features:{Serial Numbered}');
  if (search.sport && categoryId === '212') aspects.push(`Sport:{${search.sport}}`);
  const aspectPrefix = categoryId ? `categoryId:${categoryId},` : '';
  const aspectFilter = aspects.length ? `&aspect_filter=${encodeURIComponent(`${aspectPrefix}${aspects.join(',')}`)}` : '';

  const q = search.query || '';
  const offsetStr = offset !== undefined ? `&offset=${offset}` : '';
  const categoryParam = categoryId ? `&category_ids=${categoryId}` : '';
  return `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&sort=newlyListed${categoryParam}${filterStr}${aspectFilter}&limit=200${offsetStr}`;
}

// ── [14] checkPlayerSearches ──────────────────────────────────────────────────
export async function checkPlayerSearches(env) {
  const saved = await env.CACHE.get('player_search_alerts');
  const data = saved ? JSON.parse(saved) : { groups: [], searches: [] };
  const searches = (data.searches || []).filter(s => !s.groupId);
  const groups = data.groups || [];
  if (searches.length === 0 && groups.length === 0) return;

  const credentials = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
  const tokenRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    await notifyCronFailure(env, 'checkPlayerSearches-token', 'eBay client-credentials auth failed — hourly search alerts are not running.');
    return;
  }

  const now = Date.now();
  const lastRun = await env.CACHE.get('player_search_last_run');
  const cutoff = lastRun ? parseInt(lastRun) : now - (60 * 60 * 1000);
  await env.CACHE.put('player_search_last_run', String(now));

  for (const group of groups) {
    if (group.schedule === 'nightly') continue;
    const groupSearches = data.searches.filter(s => s.groupId === group.id);
    if (groupSearches.length === 0) continue;

    const groupMapped = [];
    for (const search of groupSearches) {
      if (!search.query && !search.seller) continue;
      let items = [];
      let page = 1;
      const maxPages = 5;
      let keepPaging = true;
      while (keepPaging && page <= maxPages) {
        const offset = (page - 1) * 200;
        const url = buildEbaySearchUrl(search, offset);
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } });
        const apiData = await res.json();
        const pageItems = (apiData.itemSummaries || []);
        const newInWindow = pageItems.filter(item => new Date(item.itemCreationDate).getTime() > cutoff);
        items.push(...newInWindow);
        if (pageItems.length < 200 || newInWindow.length < pageItems.length) keepPaging = false;
        page++;
      }

      if (search.excludeKeywords) {
        const excl = search.excludeKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
        items = items.filter(item => !excl.some(kw => item.title.toLowerCase().includes(kw)));
      }
      if (search.includeKeywords) {
        const incl = search.includeKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
        if (incl.length > 0) {
          items = search.includeLogic === 'AND'
            ? items.filter(item => incl.every(kw => item.title.toLowerCase().includes(kw)))
            : items.filter(item => incl.some(kw => item.title.toLowerCase().includes(kw)));
        }
      }

      groupMapped.push(...items.map(item => ({
        title: item.title,
        price: item.currentBidPrice?.value || item.price?.value || '?',
        url: item.itemWebUrl,
        type: item.buyingOptions?.includes('AUCTION') ? 'Auction' : 'BIN',
        date: item.itemCreationDate,
        endDate: item.itemEndDate || null,
        image: item.thumbnailImages?.[0]?.imageUrl || item.image?.imageUrl || null,
        seen: false,
        searchId: search.id,
        searchLabel: search.label
      })));
    }

    if (groupMapped.length === 0) continue;

    // Store in group digest
    const existing = await env.CACHE.get(group.digestKey);
    const digestItems = existing ? JSON.parse(existing) : [];
    await env.CACHE.put(group.digestKey, JSON.stringify([...digestItems, ...groupMapped]));

    // 7-day archive
    const archiveKey = group.digestKey + '_archive';
    const existingArchive = await env.CACHE.get(archiveKey);
    const archiveItems = existingArchive ? JSON.parse(existingArchive) : [];
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const trimmed = archiveItems.filter(item => new Date(item.date).getTime() > sevenDaysAgo);
    await env.CACHE.put(archiveKey, JSON.stringify([...trimmed, ...groupMapped]));

    // Pushover
    const etHour = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
    const hour = parseInt(etHour);
    if (group.notify !== false && hour >= 7 && hour < 22) {
      await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: env.PUSHOVER_TOKEN,
          user: env.PUSHOVER_USER,
          title: `🔍 ${group.label}: ${groupMapped.length} new listing${groupMapped.length !== 1 ? 's' : ''}`,
          message: 'Tap to view new listings.',
          url: `https://sollykingjr.github.io/Card-Tracker?digest=${group.digestKey}`,
          url_title: 'View in App'
        })
      });
    }
  }

for (const search of searches) {
    // Skip nightly searches on hourly runs
    if (search.schedule === 'nightly') continue;
    if (!search.query && !search.seller) continue;

    let newItems = [];
    let page = 1;
    const maxPages = 5;
    let keepPaging = true;
    while (keepPaging && page <= maxPages) {
      const offset = (page - 1) * 200;
      const url = buildEbaySearchUrl(search, offset);
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } });
      const apiData = await res.json();
      const pageItems = (apiData.itemSummaries || []);
      const newInWindow = pageItems.filter(item => new Date(item.itemCreationDate).getTime() > cutoff);
      newItems.push(...newInWindow);
      if (pageItems.length < 200 || newInWindow.length < pageItems.length) keepPaging = false;
      page++;
    }

    if (newItems.length === 0) continue;

    // Apply exclude/include keyword filters
    let filteredItems = newItems;
    if (search.excludeKeywords) {
      const excl = search.excludeKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
      filteredItems = filteredItems.filter(item => !excl.some(kw => item.title.toLowerCase().includes(kw)));
    }
    if (search.includeKeywords) {
      const incl = search.includeKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
      if (incl.length > 0) {
        if (search.includeLogic === 'AND') {
          filteredItems = filteredItems.filter(item => incl.every(kw => item.title.toLowerCase().includes(kw)));
        } else {
          filteredItems = filteredItems.filter(item => incl.some(kw => item.title.toLowerCase().includes(kw)));
        }
      }
    }

    if (filteredItems.length === 0) continue;

    // Map new items
    const newMapped = filteredItems.map(item => ({
      title: item.title,
      price: item.currentBidPrice?.value || item.price?.value || '?',
      url: item.itemWebUrl,
      type: item.buyingOptions?.includes('AUCTION') ? 'Auction' : 'BIN',
      date: item.itemCreationDate,
      endDate: item.itemEndDate || null,
      image: item.thumbnailImages?.[0]?.imageUrl || item.image?.imageUrl || null,
      seen: false
    }));

   // Send single hourly Pushover if notify is on and within quiet hours
    const etHour = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
    const hour = parseInt(etHour);
    const withinHours = hour >= 7 && hour < 22;
    if (search.notify !== false && withinHours && filteredItems.length > 0) {
      await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: env.PUSHOVER_TOKEN,
          user: env.PUSHOVER_USER,
          title: `🔍 ${search.label}: ${filteredItems.length} new listing${filteredItems.length !== 1 ? 's' : ''}`,
          message: 'Tap to view new listings.',
          url: `https://sollykingjr.github.io/Card-Tracker?digest=${search.digestKey}`,
          url_title: 'View in App'
        })
      });
    }

    // Daily digest
    const existing = await env.CACHE.get(search.digestKey);
    const digestItems = existing ? JSON.parse(existing) : [];
    await env.CACHE.put(search.digestKey, JSON.stringify([...digestItems, ...newMapped]));

    // 7-day archive — drop anything older than 7 days
    const archiveKey = search.digestKey + '_archive';
    const existingArchive = await env.CACHE.get(archiveKey);
    const archiveItems = existingArchive ? JSON.parse(existingArchive) : [];
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const trimmed = archiveItems.filter(item => new Date(item.date).getTime() > sevenDaysAgo);
    await env.CACHE.put(archiveKey, JSON.stringify([...trimmed, ...newMapped]));
  }
}

// ── [13b] checkNightlySearches ────────────────────────────────────────────────
export async function checkNightlySearches(env) {
  const saved = await env.CACHE.get('player_search_alerts');
  const data = saved ? JSON.parse(saved) : { groups: [], searches: [] };
  const groups = (data.groups || []).filter(g => g.schedule === 'nightly');
  const searches = (data.searches || []).filter(s => !s.groupId && s.schedule === 'nightly');
  if (groups.length === 0 && searches.length === 0) return;

  const credentials = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
  const tokenRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    await notifyCronFailure(env, 'checkNightlySearches-token', 'eBay client-credentials auth failed — nightly search alerts are not running.');
    return;
  }

  const now = Date.now();
  const cutoff = now - (24 * 60 * 60 * 1000);

  for (const group of groups) {
    const groupSearches = data.searches.filter(s => s.groupId === group.id);
    if (groupSearches.length === 0) continue;

    const groupMapped = [];
    for (const search of groupSearches) {
      if (!search.query && !search.seller) continue;

    let newItems = [];
    let page = 1;
    const maxPages = 15;
    let keepPaging = true;
    let hitLimit = false;
    while (keepPaging && page <= maxPages) {
      const offset = (page - 1) * 200;
      const url = buildEbaySearchUrl(search, offset);
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } });
      const apiData = await res.json();
      const pageItems = (apiData.itemSummaries || []);
      const newInWindow = pageItems.filter(item => new Date(item.itemCreationDate).getTime() > cutoff);
      newItems.push(...newInWindow);
      if (pageItems.length < 200 || newInWindow.length < pageItems.length) keepPaging = false;
      if (page === maxPages && keepPaging) hitLimit = true;
      page++;
    }
    if (hitLimit) {
      await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: env.PUSHOVER_TOKEN,
          user: env.PUSHOVER_USER,
          title: `⚠️ ${search.label} hit 15 page limit`,
          message: 'Some listings may be missing. Consider narrowing the search.',
        })
      });
    }

      if (search.excludeKeywords) {
        const excl = search.excludeKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
        newItems = newItems.filter(item => !excl.some(kw => item.title.toLowerCase().includes(kw)));
      }
      if (search.includeKeywords) {
        const incl = search.includeKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
        if (incl.length > 0) {
          newItems = search.includeLogic === 'AND'
            ? newItems.filter(item => incl.every(kw => item.title.toLowerCase().includes(kw)))
            : newItems.filter(item => incl.some(kw => item.title.toLowerCase().includes(kw)));
        }
      }

      groupMapped.push(...newItems.map(item => ({
        title: item.title,
        price: item.currentBidPrice?.value || item.price?.value || '?',
        url: item.itemWebUrl,
        type: item.buyingOptions?.includes('AUCTION') ? 'Auction' : 'BIN',
        date: item.itemCreationDate,
        endDate: item.itemEndDate || null,
        image: item.thumbnailImages?.[0]?.imageUrl || item.image?.imageUrl || null,
        seen: false,
        searchId: search.id,
        searchLabel: search.label
      })));
    }

    if (groupMapped.length === 0) continue;

    const existing = await env.CACHE.get(group.digestKey);
    const digestItems = existing ? JSON.parse(existing) : [];
    await env.CACHE.put(group.digestKey, JSON.stringify([...digestItems, ...groupMapped]));

    const archiveKey = group.digestKey + '_archive';
    const existingArchive = await env.CACHE.get(archiveKey);
    const archiveItems = existingArchive ? JSON.parse(existingArchive) : [];
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const trimmed = archiveItems.filter(item => new Date(item.date).getTime() > sevenDaysAgo);
    await env.CACHE.put(archiveKey, JSON.stringify([...trimmed, ...groupMapped]));
  }

  for (const search of searches) {
    if (!search.query && !search.seller) continue;

    let items = [];
    let page = 1;
    const maxPages = 15;
    let keepPaging = true;
    let hitLimit = false;
    while (keepPaging && page <= maxPages) {
      const offset = (page - 1) * 200;
      const url = buildEbaySearchUrl(search, offset);
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } });
      const apiData = await res.json();
      const pageItems = (apiData.itemSummaries || []);
      const newInWindow = pageItems.filter(item => new Date(item.itemCreationDate).getTime() > cutoff);
      items.push(...newInWindow);
      if (pageItems.length < 200 || newInWindow.length < pageItems.length) keepPaging = false;
      if (page === maxPages && keepPaging) hitLimit = true;
      page++;
    }
    if (hitLimit) {
      await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: env.PUSHOVER_TOKEN,
          user: env.PUSHOVER_USER,
          title: `⚠️ ${search.label} hit 15 page limit`,
          message: 'Some listings may be missing. Consider narrowing the search.',
        })
      });
    }

    if (search.excludeKeywords) {
      const excl = search.excludeKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
      items = items.filter(item => !excl.some(kw => item.title.toLowerCase().includes(kw)));
    }
    if (search.includeKeywords) {
      const incl = search.includeKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
      if (incl.length > 0) {
        items = search.includeLogic === 'AND'
          ? items.filter(item => incl.every(kw => item.title.toLowerCase().includes(kw)))
          : items.filter(item => incl.some(kw => item.title.toLowerCase().includes(kw)));
      }
    }

    if (items.length === 0) continue;

    const newMapped = items.map(item => ({
      title: item.title,
      price: item.currentBidPrice?.value || item.price?.value || '?',
      url: item.itemWebUrl,
      type: item.buyingOptions?.includes('AUCTION') ? 'Auction' : 'BIN',
      date: item.itemCreationDate,
      endDate: item.itemEndDate || null,
      image: item.thumbnailImages?.[0]?.imageUrl || item.image?.imageUrl || null,
      seen: false
    }));

    const existing = await env.CACHE.get(search.digestKey);
    const digestItems = existing ? JSON.parse(existing) : [];
    await env.CACHE.put(search.digestKey, JSON.stringify([...digestItems, ...newMapped]));

    const archiveKey = search.digestKey + '_archive';
    const existingArchive = await env.CACHE.get(archiveKey);
    const archiveItems = existingArchive ? JSON.parse(existingArchive) : [];
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const trimmed = archiveItems.filter(item => new Date(item.date).getTime() > sevenDaysAgo);
    await env.CACHE.put(archiveKey, JSON.stringify([...trimmed, ...newMapped]));
  }
}

// ── [14] sendPlayerDigestNotification ────────────────────────────────────────
export async function sendPlayerDigestNotification(env) {
  const saved = await env.CACHE.get('player_search_alerts');
  const data = saved ? JSON.parse(saved) : { groups: [], searches: [] };

  // Send for groups
  for (const group of (data.groups || []).filter(g => g.dailyDigest === true)) {
    const existing = await env.CACHE.get(group.digestKey);
    const items = existing ? JSON.parse(existing) : [];
    if (items.length === 0) continue;
    const unseen = items.filter(i => !i.seen);
    if (unseen.length === 0) continue;
    await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: env.PUSHOVER_TOKEN,
        user: env.PUSHOVER_USER,
        title: `🔍 ${group.label}: ${unseen.length} new listing${unseen.length !== 1 ? 's' : ''} overnight`,
        message: 'Tap to view new listings.',
        url: `https://sollykingjr.github.io/Card-Tracker?digest=${group.digestKey}`,
        url_title: 'View in App'
      })
    });
  }

  // Send for standalone searches
  for (const search of (data.searches || []).filter(s => !s.groupId && s.dailyDigest === true)) {
    const existing = await env.CACHE.get(search.digestKey);
    const items = existing ? JSON.parse(existing) : [];
    if (items.length === 0) continue;
    const unseen = items.filter(i => !i.seen);
    if (unseen.length === 0) continue;
    await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: env.PUSHOVER_TOKEN,
        user: env.PUSHOVER_USER,
        title: `🔍 ${search.label}: ${unseen.length} new listing${unseen.length !== 1 ? 's' : ''} overnight`,
        message: 'Tap to view new listings.',
        url: `https://sollykingjr.github.io/Card-Tracker?digest=${search.digestKey}`,
        url_title: 'View in App'
      })
    });
  }
}

// ── [15] handlePlayerDigest ───────────────────────────────────────────────────
export async function handlePlayerDigest(request, env, cors) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    if (!key) return new Response('Missing key', { status: 400, headers: cors });

    const existing = await env.CACHE.get(key);
    const items = existing ? JSON.parse(existing) : [];

    let html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>New Listings</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #0f0f0f; color: #eee; padding: 16px; max-width: 600px; margin: 0 auto; }
  h1 { font-size: 18px; color: #fff; margin-bottom: 4px; }
  .count { color: #888; font-size: 13px; margin-bottom: 24px; }
  .item { padding: 12px 0; border-bottom: 1px solid #1a1a1a; }
  .title { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
  .meta { font-size: 13px; color: #888; margin-bottom: 6px; }
  .price { font-size: 15px; color: #4ade80; font-family: monospace; }
  a { color: #60a5fa; text-decoration: none; font-size: 13px; }
  .empty { color: #555; font-size: 14px; padding: 16px 0; }
</style></head><body>
<h1>🔍 New Listings</h1>
<div class="count">${items.length} listing${items.length !== 1 ? 's' : ''}</div>
${!key.includes('_archive') ? `<a href="/player-digest?key=${key}_archive" style="display:inline-block;margin-bottom:16px;color:#60a5fa;font-size:13px;">View 7-day archive →</a>` : `<a href="/player-digest?key=${key.replace('_archive','')}" style="display:inline-block;margin-bottom:16px;color:#60a5fa;font-size:13px;">← View today only</a>`}`;

    if (items.length === 0) {
      html += `<div class="empty">No listings found.</div>`;
    } else {
      for (const item of items) {
        const date = new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        html += `<div class="item">
          <div class="title">${item.title}</div>
          <div class="meta">${item.type} · ${date}</div>
          <div class="price">$${item.price}</div>
          <a href="${item.url}" target="_blank">View on eBay →</a>
        </div>`;
      }
    }

    html += `</body></html>`;
    return new Response(html, { headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' } });
  } catch(e) {
    return new Response(`Error: ${e.message}`, { status: 500, headers: cors });
  }
}

// ── [17] clearPlayerDigests ───────────────────────────────────────────────────
export async function clearPlayerDigests(env) {
  const saved = await env.CACHE.get('player_search_alerts');
  const data = saved ? JSON.parse(saved) : { groups: [], searches: [] };
  const groupKeys = (data.groups || []).map(g => g.digestKey);
  const searchKeys = (data.searches || []).filter(s => !s.groupId).map(s => s.digestKey);
  for (const key of [...groupKeys, ...searchKeys]) {
    await env.CACHE.delete(key);
  }
}
// ── [18] handleSearchAlerts ───────────────────────────────────────────────────
export async function handleSearchAlertsGet(env, cors) {
  try {
    const saved = await env.CACHE.get('player_search_alerts');
    let data = saved ? JSON.parse(saved) : { groups: [], searches: [], sections: [] };
    if (Array.isArray(data)) data = { groups: [], searches: data, sections: [] };
    if (!data.sections) data.sections = [];
    return new Response(JSON.stringify(data), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

export async function handleSearchAlertsPost(request, env, cors) {
  try {
    const { groups, searches, sections, deleteKeys } = await request.json();
    const saved = await env.CACHE.get('player_search_alerts');
    let current = saved ? JSON.parse(saved) : { groups: [], searches: [], sections: [] };
    if (Array.isArray(current)) current = { groups: [], searches: current, sections: [] };
    if (groups !== undefined) current.groups = groups;
    if (searches !== undefined) current.searches = searches;
    if (sections !== undefined) current.sections = sections;
    await env.CACHE.put('player_search_alerts', JSON.stringify(current));
    if (deleteKeys && Array.isArray(deleteKeys)) {
      for (const key of deleteKeys) {
        await env.CACHE.delete(key);
      }
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}
// ── [19b] handleMarkSeenUrls ──────────────────────────────────────────────────
export async function handleMarkSeenUrls(request, env, cors) {
  try {
    const { key, urls } = await request.json();
    if (!key || !urls) return new Response(JSON.stringify({ error: 'missing key or urls' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    });
    const existing = await env.CACHE.get(key);
    if (!existing) return new Response(JSON.stringify({ ok: true, count: 0 }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
    const seenUrls = new Set(urls);
    const items = JSON.parse(existing).map(item => seenUrls.has(item.url) ? { ...item, seen: true } : item);
    await env.CACHE.put(key, JSON.stringify(items));
    return new Response(JSON.stringify({ ok: true, count: items.filter(i => i.seen).length }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

// ── [19] handleMarkSeen ───────────────────────────────────────────────────────
export async function handleMarkSeen(request, env, cors) {
  try {
    const { key } = await request.json();
    if (!key) return new Response(JSON.stringify({ error: 'missing key' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    });
    const existing = await env.CACHE.get(key);
    if (!existing) return new Response(JSON.stringify({ ok: true, count: 0 }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
    const items = JSON.parse(existing).map(item => ({ ...item, seen: true }));
    await env.CACHE.put(key, JSON.stringify(items));
    return new Response(JSON.stringify({ ok: true, count: items.length }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

export async function handlePlayerDigestJson(request, env, cors) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    if (!key) return new Response(JSON.stringify({ error: 'missing key' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    });

    const existing = await env.CACHE.get(key);
    const items = existing ? JSON.parse(existing) : [];

    return new Response(JSON.stringify({ items, count: items.length }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}
export async function handleRunSearch(request, env, cors) {
  try {
    const { digestKey, searchId } = await request.json();
    if (!digestKey) return new Response(JSON.stringify({ error: 'missing digestKey' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    });

    const saved = await env.CACHE.get('player_search_alerts');
    const data = saved ? JSON.parse(saved) : { groups: [], searches: [] };
    // Check if it's a group or standalone search
    const group = (data.groups || []).find(g => g.digestKey === digestKey);
    const search = !group ? (data.searches || []).find(s => s.digestKey === digestKey) : null;
    if (!group && !search) return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404, headers: { ...cors, 'Content-Type': 'application/json' }
    });

    const credentials = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
    const tokenRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return new Response(JSON.stringify({ error: 'token_failed' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });

    const cutoff = Date.now() - (2 * 60 * 60 * 1000);
    const searchList = group
      ? data.searches.filter(s => s.groupId === group.id && (!searchId || s.id === searchId))
      : [search];
    const allItems = [];

    for (const s of searchList) {
      if (!s.query && !s.seller) continue;
      const url = buildEbaySearchUrl(s);
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } });
      const apiData = await res.json();
      const allSummaries = apiData.itemSummaries || [];
      let filtered = allSummaries.filter(item => new Date(item.itemCreationDate).getTime() > cutoff);
      if (filtered.length < 10) {
        const haveUrls = new Set(filtered.map(i => i.itemWebUrl));
        const backfill = allSummaries.filter(i => !haveUrls.has(i.itemWebUrl)).slice(0, 10 - filtered.length);
        filtered = [...filtered, ...backfill];
      }

      if (s.excludeKeywords) {
        const excl = s.excludeKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
        filtered = filtered.filter(item => !excl.some(kw => item.title.toLowerCase().includes(kw)));
      }
      if (s.includeKeywords) {
        const incl = s.includeKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
        if (incl.length > 0) {
          filtered = s.includeLogic === 'AND'
            ? filtered.filter(item => incl.every(kw => item.title.toLowerCase().includes(kw)))
            : filtered.filter(item => incl.some(kw => item.title.toLowerCase().includes(kw)));
        }
      }

      allItems.push(...filtered.map(item => ({
        title: item.title,
        price: item.currentBidPrice?.value || item.price?.value || '?',
        url: item.itemWebUrl,
        type: item.buyingOptions?.includes('AUCTION') ? 'Auction' : 'BIN',
        date: item.itemCreationDate,
        endDate: item.itemEndDate || null,
        image: item.thumbnailImages?.[0]?.imageUrl || item.image?.imageUrl || null,
        seen: false,
        searchId: s.id,
        searchLabel: s.label
      })));
    }

    const items = allItems;
    const targetKey = (group || search).digestKey;
    const existing = await env.CACHE.get(targetKey);
    const existingItems = existing ? JSON.parse(existing) : [];
    const existingUrls = new Set(existingItems.map(i => i.url));
    const deduped = items.filter(i => !existingUrls.has(i.url));
    const merged = [...existingItems, ...deduped];
    await env.CACHE.put(targetKey, JSON.stringify(merged));

    // Also merge into 7-day archive, same as scheduled runs
    const archiveKey = targetKey + '_archive';
    const existingArchive = await env.CACHE.get(archiveKey);
    const archiveItems = existingArchive ? JSON.parse(existingArchive) : [];
    const archiveUrls = new Set(archiveItems.map(i => i.url));
    const archiveDeduped = items.filter(i => !archiveUrls.has(i.url));
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const trimmedArchive = archiveItems.filter(item => new Date(item.date).getTime() > sevenDaysAgo);
    await env.CACHE.put(archiveKey, JSON.stringify([...trimmedArchive, ...archiveDeduped]));

    return new Response(JSON.stringify({ ok: true, count: items.length }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}
