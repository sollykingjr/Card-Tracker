// ── prospect-watch.js — the built-in Prospect Watch searches (no saved search to create)
// Two searches are added to every cron run on top of the saved ones: BIN hourly and Auction nightly. Both cover every non-graduated
// prospect with an Expected Value in the last `days` days (and a first auto on file), through the same prospectList expansion and
// first-auto filter as the Buy Score lists. Their digests use fixed keys, so the app tab reads them like any other search results
// (same 7-day archive, same Mark Seen / Mark All Seen).
export const WATCH_BIN_KEY = 'prospect_watch_bin_digest';
export const WATCH_AUCTION_KEY = 'prospect_watch_auction_digest';
const SETTINGS_KEY = 'prospect_watch_settings';
const DEFAULTS = { enabled: true, days: 30, dealPct: 40 };   // days = expiry for a player with no new Expected Value; dealPct = how far under the estimate counts as a deal

export function sanitizeWatchSettings(b = {}, cur = DEFAULTS) {
  const num = (v, lo, hi, d) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  return {
    enabled: b.enabled === undefined ? cur.enabled : !!b.enabled,
    days: b.days === undefined ? cur.days : num(b.days, 1, 365, cur.days),
    dealPct: b.dealPct === undefined ? cur.dealPct : num(b.dealPct, 1, 95, cur.dealPct)
  };
}

export async function getWatchSettings(env) {
  try {
    const raw = await env.CACHE.get(SETTINGS_KEY);
    return sanitizeWatchSettings(raw ? JSON.parse(raw) : {}, DEFAULTS);
  } catch (e) { return { ...DEFAULTS }; }
}

export function watchSearches(settings) {
  if (!settings.enabled) return [];
  const common = {
    query: '', seller: '', groupId: null, sectionId: null, sellerMode: 'exclude', categoryType: 'sports', sport: '', condition: '', serial: false, usOnly: true,
    notify: false, dailyDigest: false, showOnHome: false, priorityKeywords: [], minPrice: '', maxPrice: '', includeKeywords: '', includeLogic: 'OR', excludeKeywords: '',
    builtIn: true, prospectList: { recentEvDays: settings.days, base: 'Bowman Chrome Auto' }
  };
  return [
    { ...common, id: 'pw_bin', label: 'Prospect Watch — BIN', digestKey: WATCH_BIN_KEY, listingType: 'FIXED_PRICE', schedule: 'hourly' },
    { ...common, id: 'pw_auction', label: 'Prospect Watch — Auctions', digestKey: WATCH_AUCTION_KEY, listingType: 'AUCTION', schedule: 'nightly' }
  ];
}

export async function builtInWatchSearches(env) { return watchSearches(await getWatchSettings(env)); }

// GET /prospect-watch-settings -> settings + digest keys; POST (app key) saves {enabled, days, dealPct}
export async function handleWatchSettings(request, env, cors) {
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  try {
    if (request.method === 'POST') {
      const body = await request.json();
      const next = sanitizeWatchSettings(body, await getWatchSettings(env));
      await env.CACHE.put(SETTINGS_KEY, JSON.stringify(next));
      return json({ ok: true, settings: next, keys: { bin: WATCH_BIN_KEY, auction: WATCH_AUCTION_KEY } });
    }
    return json({ settings: await getWatchSettings(env), keys: { bin: WATCH_BIN_KEY, auction: WATCH_AUCTION_KEY } });
  } catch (e) { return json({ error: e.message }, 500); }
}
