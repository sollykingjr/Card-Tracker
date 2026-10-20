// ── search-alerts.js — eBay search building, cron jobs, digests, run/mark-seen
import { notifyCronFailure } from './misc.js';
import { listBuyList, listRecentEvList } from './prospect-current.js';
import { builtInWatchSearches } from './prospect-watch.js';

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
  // Older searches have no categoryType saved (the editor shows them as "sports"). eBay ignores
  // item-specific filters (Serial Numbered, Sport) without a category, so default to sports when either is on.
  const categoryId = categoryMap[search.categoryType] || ((search.serial || search.sport) ? categoryMap.sports : null);

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

// ── Prospect Buy Score list searches ──────────────────────────────────────────
// A saved search can carry prospectList: {min, max, side, base} or {recentEvDays, side?, base}. Its eBay query is built here, every run, from the current Buy Score
// list (GET /prospect-buy-list logic), so the search stays current on its own. Lists longer than PROSPECT_CHUNK names are split into
// several queries that share the search's id, label and digest; only the first one sends a notification. Never saved back.
export const PROSPECT_MAX_QUERY = 1500; // longest query confirmed read in full by eBay is 1,528 characters
export const PROSPECT_CHUNK = 100; // eBay read a 100-name (~1.5k char) query in full; see Test 1-3 runs 2026-10-19
export async function expandProspectSearches(env, searches) {
  const out = [];
  for (const s of searches || []) {
    if (!s.prospectList) { out.push(s); continue; }
    const pl = s.prospectList;
    // recentEvDays: every non-graduated player with an Expected Value in the last N days (both sides unless one is set), only those with a first auto on file
    const r = pl.recentEvDays ? await listRecentEvList(env, pl.recentEvDays, pl.side || null, pl.requireFirstAuto !== false) : await listBuyList(env, pl.min, pl.max, pl.side || null);
    const names = r.players.map(p => p.name.replace(/[(),"]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const base = String(pl.base ?? 'Bowman Chrome Auto').trim();
    // A chunk ends at PROSPECT_CHUNK names or PROSPECT_MAX_QUERY characters, whichever comes first, so a list of long names never goes past the tested length.
    const chunks = [];
    let cur = [];
    for (const n of names) {
      const len = `${base} (${[...cur, n].join(', ')})`.length;
      if (cur.length && (cur.length >= PROSPECT_CHUNK || len > PROSPECT_MAX_QUERY)) { chunks.push(cur); cur = []; }
      cur.push(n);
    }
    if (cur.length) chunks.push(cur);
    chunks.forEach((c, i) => out.push({ ...s, query: `${base} (${c.join(', ')})`.trim(), notify: i === 0 ? s.notify : false }));
  }
  return out;
}

// Returns only the incoming items not already in `existing`, and not repeated within `incoming`.
// Matches on eBay itemId, falling back to URL (older stored items have no itemId).
export function dedupeNewItems(existing, incoming) {
  const keysOf = i => [i.itemId, i.url].filter(Boolean);
  const seen = new Set();
  for (const i of existing) keysOf(i).forEach(k => seen.add(k));
  const out = [];
  for (const i of incoming) {
    const keys = keysOf(i);
    if (keys.some(k => seen.has(k))) continue;
    keys.forEach(k => seen.add(k));
    out.push(i);
  }
  return out;
}

// ── First-auto filter ─────────────────────────────────────────────────────────
// Prospect-list searches only want each player's FIRST Bowman auto (the earliest CPA-/CDA- card in bowman_first_cards).
// The eBay query stays name-only ("Bowman Chrome Auto (names)"); listings are checked against the player's first auto here, after the fetch.
// Fail-open: no table, no player match or no first-auto row for that player keeps the listing, as before.
const normTitle = t => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.'’`]/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

export async function loadFirstAutoMap(env, searches) {
  if (!(searches || []).some(s => s.prospectList)) return null;
  try {
    const rows = (await env.DB.prepare(
      `SELECT p.prospect_id, p.norm_name, b.year, b.product, b.card_number FROM bowman_first_cards b
       JOIN prospects p ON p.prospect_id = b.prospect_id WHERE b.card_type = 'auto' ORDER BY b.year, b.pc, b.id`).all()).results;
    const map = new Map(); // norm name -> first auto
    const seen = new Set();
    for (const r of rows) {
      if (seen.has(r.prospect_id)) continue; // rows are ordered earliest first
      seen.add(r.prospect_id);
      map.set(normTitle(r.norm_name), { year: r.year, product: r.product, card: String(r.card_number || '').toUpperCase() });
    }
    return map.size ? map : null;
  } catch (e) { return null; }
}

// items: raw eBay item summaries. Returns only listings that can be the matched player's first auto.
export function filterFirstAutos(items, map) {
  if (!map || !items.length) return items;
  const names = [...map.keys()].sort((a, b) => b.length - a.length);
  return items.filter(item => {
    const t = ' ' + normTitle(item.title) + ' ';
    const name = names.find(n => t.includes(' ' + n + ' '));
    if (!name) return true;
    const fa = map.get(name);
    if (!t.includes(String(fa.year))) return false;
    const codes = [...String(item.title).toUpperCase().matchAll(/\b(CPA|CDA)[-\s]?([A-Z]{1,4})\b/g)].map(m => m[1] + '-' + m[2]);
    if (codes.length && !codes.includes(fa.card)) return false;
    if (fa.product !== 'Bowman Draft' && /\bdraft\b/.test(t) && !codes.includes(fa.card)) return false;
    return true;
  });
}

// ── [14] checkPlayerSearches ──────────────────────────────────────────────────
export async function checkPlayerSearches(env) {
  const saved = await env.CACHE.get('player_search_alerts');
  const data = saved ? JSON.parse(saved) : { groups: [], searches: [] };
  data.searches = await expandProspectSearches(env, [...(data.searches || []), ...(await builtInWatchSearches(env))]);   // saved searches + the built-in Prospect Watch pair
  const firstAutoMap = await loadFirstAutoMap(env, data.searches);
  const searches = (data.searches || []).filter(s => !s.groupId);
  const groups = data.groups || [];
  if (searches.length === 0 && groups.length === 0) return;

  const credentials = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
  let tokenData;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const tokenRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
    });
    tokenData = await tokenRes.json();
    if (tokenData.access_token) break;
    if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
    else {
      await notifyCronFailure(env, 'checkPlayerSearches-token', `eBay client-credentials auth failed after 3 attempts (${tokenRes.status}): ${tokenData.error || 'unknown'} — ${tokenData.error_description || 'no description'}`);
      return;
    }
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

      if (search.prospectList) items = filterFirstAutos(items, firstAutoMap);
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
        itemId: item.itemId || null,
        title: item.title,
        price: item.currentBidPrice?.value || item.price?.value || '?',
        url: item.itemWebUrl,
        type: item.buyingOptions?.includes('AUCTION') ? 'Auction' : 'BIN',
        date: item.itemCreationDate,
        endDate: item.itemEndDate || null,
        image: item.thumbnailImages?.[0]?.imageUrl || item.image?.imageUrl || null,
        seller: item.seller?.username || null,
        seen: false,
        searchId: search.id,
        searchLabel: search.label
      })));
    }

    if (groupMapped.length === 0) continue;

    // Store in group digest (a listing matching 2+ searches in the group is stored once)
    const existing = await env.CACHE.get(group.digestKey);
    const digestItems = existing ? JSON.parse(existing) : [];
    const newGroupItems = dedupeNewItems(digestItems, groupMapped);
    if (newGroupItems.length > 0) {
      await env.CACHE.put(group.digestKey, JSON.stringify([...digestItems, ...newGroupItems]));
    }

    // 7-day archive
    const archiveKey = group.digestKey + '_archive';
    const existingArchive = await env.CACHE.get(archiveKey);
    const archiveItems = existingArchive ? JSON.parse(existingArchive) : [];
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const trimmed = archiveItems.filter(item => new Date(item.date).getTime() > sevenDaysAgo);
    await env.CACHE.put(archiveKey, JSON.stringify([...trimmed, ...dedupeNewItems(trimmed, groupMapped)]));

    // Pushover
    const etHour = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
    const hour = parseInt(etHour);
    if (group.notify !== false && hour >= 7 && hour < 22 && newGroupItems.length > 0) {
      await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: env.PUSHOVER_TOKEN,
          user: env.PUSHOVER_USER,
          title: `🔍 ${group.label}: ${newGroupItems.length} new listing${newGroupItems.length !== 1 ? 's' : ''}`,
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
    if (search.prospectList) filteredItems = filterFirstAutos(filteredItems, firstAutoMap);
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
      seller: item.seller?.username || null,
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
    await env.CACHE.put(search.digestKey, JSON.stringify([...digestItems, ...dedupeNewItems(digestItems, newMapped)]));

    // 7-day archive — drop anything older than 7 days
    const archiveKey = search.digestKey + '_archive';
    const existingArchive = await env.CACHE.get(archiveKey);
    const archiveItems = existingArchive ? JSON.parse(existingArchive) : [];
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const trimmed = archiveItems.filter(item => new Date(item.date).getTime() > sevenDaysAgo);
    await env.CACHE.put(archiveKey, JSON.stringify([...trimmed, ...dedupeNewItems(trimmed, newMapped)]));
  }
}

// ── [13b] checkNightlySearches ────────────────────────────────────────────────
export async function checkNightlySearches(env) {
  const saved = await env.CACHE.get('player_search_alerts');
  const data = saved ? JSON.parse(saved) : { groups: [], searches: [] };
  data.searches = await expandProspectSearches(env, [...(data.searches || []), ...(await builtInWatchSearches(env))]);   // saved searches + the built-in Prospect Watch pair
  const firstAutoMap = await loadFirstAutoMap(env, data.searches);
  const groups = (data.groups || []).filter(g => g.schedule === 'nightly');
  const searches = (data.searches || []).filter(s => !s.groupId && s.schedule === 'nightly');
  if (groups.length === 0 && searches.length === 0) return;

  const credentials = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
  let tokenData;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const tokenRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
    });
    tokenData = await tokenRes.json();
    if (tokenData.access_token) break;
    if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
    else {
      await notifyCronFailure(env, 'checkNightlySearches-token', `eBay client-credentials auth failed after 3 attempts (${tokenRes.status}): ${tokenData.error || 'unknown'} — ${tokenData.error_description || 'no description'}`);
      return;
    }
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

      if (search.prospectList) newItems = filterFirstAutos(newItems, firstAutoMap);
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
        itemId: item.itemId || null,
        title: item.title,
        price: item.currentBidPrice?.value || item.price?.value || '?',
        url: item.itemWebUrl,
        type: item.buyingOptions?.includes('AUCTION') ? 'Auction' : 'BIN',
        date: item.itemCreationDate,
        endDate: item.itemEndDate || null,
        image: item.thumbnailImages?.[0]?.imageUrl || item.image?.imageUrl || null,
        seller: item.seller?.username || null,
        seen: false,
        searchId: search.id,
        searchLabel: search.label
      })));
    }

    if (groupMapped.length === 0) continue;

    const existing = await env.CACHE.get(group.digestKey);
    const digestItems = existing ? JSON.parse(existing) : [];
    await env.CACHE.put(group.digestKey, JSON.stringify([...digestItems, ...dedupeNewItems(digestItems, groupMapped)]));

    const archiveKey = group.digestKey + '_archive';
    const existingArchive = await env.CACHE.get(archiveKey);
    const archiveItems = existingArchive ? JSON.parse(existingArchive) : [];
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const trimmed = archiveItems.filter(item => new Date(item.date).getTime() > sevenDaysAgo);
    await env.CACHE.put(archiveKey, JSON.stringify([...trimmed, ...dedupeNewItems(trimmed, groupMapped)]));
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

    if (search.prospectList) items = filterFirstAutos(items, firstAutoMap);
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
      seller: item.seller?.username || null,
      seen: false
    }));

    const existing = await env.CACHE.get(search.digestKey);
    const digestItems = existing ? JSON.parse(existing) : [];
    await env.CACHE.put(search.digestKey, JSON.stringify([...digestItems, ...dedupeNewItems(digestItems, newMapped)]));

    const archiveKey = search.digestKey + '_archive';
    const existingArchive = await env.CACHE.get(archiveKey);
    const archiveItems = existingArchive ? JSON.parse(existingArchive) : [];
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const trimmed = archiveItems.filter(item => new Date(item.date).getTime() > sevenDaysAgo);
    await env.CACHE.put(archiveKey, JSON.stringify([...trimmed, ...dedupeNewItems(trimmed, newMapped)]));
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
  const searchKeys = [...(data.searches || []).filter(s => !s.groupId), ...(await builtInWatchSearches(env))].map(s => s.digestKey);
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
    const search = !group ? ((data.searches || []).find(s => s.digestKey === digestKey) || (await builtInWatchSearches(env)).find(s => s.digestKey === digestKey)) : null;
    if (!group && !search) return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404, headers: { ...cors, 'Content-Type': 'application/json' }
    });

    const credentials = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
    let tokenData, tokenStatus;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const tokenRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
      });
      tokenData = await tokenRes.json();
      tokenStatus = tokenRes.status;
      if (tokenData.access_token) break;
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
    if (!tokenData.access_token) return new Response(JSON.stringify({ error: 'token_failed', detail: tokenData, status: tokenStatus }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });

    const cutoff = Date.now() - (2 * 60 * 60 * 1000);
    const searchList = await expandProspectSearches(env, group
      ? data.searches.filter(s => s.groupId === group.id && (!searchId || s.id === searchId))
      : [search]);
    const allItems = [];
    const firstAutoMap = await loadFirstAutoMap(env, searchList);

    for (const s of searchList) {
      if (!s.query && !s.seller) continue;
      const url = buildEbaySearchUrl(s);
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } });
      const apiData = await res.json();
      const allSummaries = apiData.itemSummaries || [];
      let filtered = s.prospectList ? allSummaries.slice() : allSummaries.filter(item => new Date(item.itemCreationDate).getTime() > cutoff);
      if (filtered.length < 10) {
        const haveUrls = new Set(filtered.map(i => i.itemWebUrl));
        const backfill = allSummaries.filter(i => !haveUrls.has(i.itemWebUrl)).slice(0, 10 - filtered.length);
        filtered = [...filtered, ...backfill];
      }

      if (s.prospectList) filtered = filterFirstAutos(filtered, firstAutoMap);
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
        itemId: item.itemId || null,
        title: item.title,
        price: item.currentBidPrice?.value || item.price?.value || '?',
        url: item.itemWebUrl,
        type: item.buyingOptions?.includes('AUCTION') ? 'Auction' : 'BIN',
        date: item.itemCreationDate,
        endDate: item.itemEndDate || null,
        image: item.thumbnailImages?.[0]?.imageUrl || item.image?.imageUrl || null,
        seller: item.seller?.username || null,
        seen: false,
        searchId: s.id,
        searchLabel: s.label
      })));
    }

    const items = dedupeNewItems([], allItems);
    const targetKey = (group || search).digestKey;
    const existing = await env.CACHE.get(targetKey);
    const existingItems = existing ? JSON.parse(existing) : [];
    const deduped = dedupeNewItems(existingItems, items);
    const merged = [...existingItems, ...deduped];
    await env.CACHE.put(targetKey, JSON.stringify(merged));

    // Also merge into 7-day archive, same as scheduled runs
    const archiveKey = targetKey + '_archive';
    const existingArchive = await env.CACHE.get(archiveKey);
    const archiveItems = existingArchive ? JSON.parse(existingArchive) : [];
    const archiveDeduped = dedupeNewItems(archiveItems, items);
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
