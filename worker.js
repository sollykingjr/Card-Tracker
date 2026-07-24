// ── [1] Constants ─────────────────────────────────────────────────────────────
const RUNAME = 'Max_Solomon-MaxSolom-MCSTra-anhpmrm';
const SCOPES = 'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory.readonly https://api.ebay.com/oauth/api_scope/commerce.identity.readonly';

// ── [2] Main router ───────────────────────────────────────────────────────────
export default {
  async scheduled(event, env, ctx) {
    await checkPromotions(env);
    if (event.cron === '0 10 * * *') {
      await checkNightlySearches(env);
    } else {
      await checkPlayerSearches(env);
    }
    if (event.cron === '0 13 * * *') {
      await sendDailyStatsNotification(env);
    }
    if (event.cron === '0 12 * * *') {
      await sendPlayerDigestNotification(env);
    }
    if (event.cron === '0 5 * * *') {
      await clearPlayerDigests(env);
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    if (path === '/auth') return handleAuth(env);
    if (path === '/callback') return handleCallback(request, env);
    if (path === '/watchlist') return handleWatchlist(env, cors);
    if (path === '/save-title') return handleSaveTitle(request, env, cors);
    if (path === '/test-promotions') return handleTestPromotions(env, cors);
    if (path === '/daily-stats') return handleDailyStats(env, cors);  
    if (path === '/player-digest') return handlePlayerDigest(request, env, cors);
    if (path === '/player-digest-json') return handlePlayerDigestJson(request, env, cors);
    if (path === '/search-alerts' && request.method === 'GET') return handleSearchAlertsGet(env, cors);
    if (path === '/run-search' && request.method === 'POST') return handleRunSearch(request, env, cors);
    if (path === '/search-alerts' && request.method === 'POST') return handleSearchAlertsPost(request, env, cors);
    if (path === '/sb-data' && request.method === 'GET') return handleSbDataGet(env, cors);
    if (path === '/sb-data' && request.method === 'POST') return handleSbDataPost(request, env, cors);
    if (path === '/mark-seen' && request.method === 'POST') return handleMarkSeen(request, env, cors);
    if (path === '/mark-seen-urls' && request.method === 'POST') return handleMarkSeenUrls(request, env, cors);
    if (path === '/set-snipe' && request.method === 'POST') return handleSetSnipe(request, env, cors);
    if (path === '/scan' && request.method === 'GET') return handleScan(request, env, cors);
    return new Response('card-app worker running', { headers: cors });
  }
};

// ── [3] handleAuth ────────────────────────────────────────────────────────────
function handleAuth(env) {
  const authUrl = `https://auth.ebay.com/oauth2/authorize?client_id=${env.EBAY_CLIENT_ID}&response_type=code&redirect_uri=${RUNAME}&scope=${encodeURIComponent(SCOPES)}`;
  return Response.redirect(authUrl, 302);
}

// ── [4] handleCallback ────────────────────────────────────────────────────────
async function handleCallback(request, env) {
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
async function handleWatchlist(env, cors) {
  let accessToken = await env.CACHE.get('ebay_access_token');

  if (!accessToken) {
    const refreshToken = await env.CACHE.get('ebay_refresh_token');
    if (!refreshToken) {
      return new Response(JSON.stringify({ error: 'not_authenticated', authUrl: '/auth' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
    accessToken = await refreshAccessToken(refreshToken, env);
    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'refresh_failed', authUrl: '/auth' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
      });
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

    rawItems.push({
      itemId: get('ItemID'),
      title: get('Title'),
      endTime,
      currentPrice: get('CurrentPrice'),
      currency: get('CurrencyID'),
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

  return new Response(JSON.stringify({ items, count: items.length }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}

// ── [6] handleSaveTitle ───────────────────────────────────────────────────────
async function handleSaveTitle(request, env, cors) {
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
async function refreshAccessToken(refreshToken, env) {
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

// ── [8] checkPromotions ───────────────────────────────────────────────────────
async function checkPromotions(env) {
  const today = new Date().toLocaleString('en-CA', { timeZone: 'America/New_York' }).split(',')[0];
  const lastSeenId = await env.CACHE.get('milb_last_transaction_id');

  // Fetch portfolio player names
  const portfolioRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/12sNofzPwhb8uR68hT_bJNiLD2MrM0rdoQMPXGTlx2_s/values/Card%20Cost%20Tracker%20Final!H:H?key=AIzaSyCl43LqZrRJ-MlPkKiKjk51O2Aklv-T0RE`
  );
  const portfolioData = await portfolioRes.json();
  const portfolioNames = (portfolioData.values || [])
    .flat()
    .map(n => n.trim().toLowerCase())
    .filter(Boolean);

  // Fetch all prospect names from all tabs
  const sheetsRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/15pRN3ILeyfbPG2OMRxh0OUtqg6MZCaLMMjwf4yxDV74?key=AIzaSyCl43LqZrRJ-MlPkKiKjk51O2Aklv-T0RE`
  );
  const sheetsData = await sheetsRes.json();
  const tabNames = sheetsData.sheets.map(s => s.properties.title);

  const prospectNames = new Set();
  for (const tab of tabNames) {
    const tabRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/15pRN3ILeyfbPG2OMRxh0OUtqg6MZCaLMMjwf4yxDV74/values/${encodeURIComponent(tab)}!A:Z?key=AIzaSyCl43LqZrRJ-MlPkKiKjk51O2Aklv-T0RE`
    );
    const tabData = await tabRes.json();
    (tabData.values || []).forEach(row => {
      row.forEach(cell => {
        if (cell && cell.trim()) prospectNames.add(cell.trim().toLowerCase());
      });
    });
  }

  // Fetch today's transactions from MLB Stats API
  const apiUrl = `https://statsapi.mlb.com/api/v1/transactions?startDate=${today}&endDate=${today}&sportId=11`;
  const apiRes = await fetch(apiUrl);
  const apiData = await apiRes.json();
  const transactions = apiData.transactions || [];

  if (transactions.length === 0) return;

  // Save the newest transaction ID
  const newestId = String(transactions[0].id);
  if (lastSeenId === newestId) return;
  await env.CACHE.put('milb_last_transaction_id', newestId);

  // Find only transactions newer than last seen
  const newTransactions = [];
  for (const t of transactions) {
    if (String(t.id) === lastSeenId) break;
    newTransactions.push(t);
  }

  for (const t of newTransactions) {
    const desc = t.description || '';
    const isPromotion = desc.includes('assigned to') || desc.includes('selected the contract of');
    if (!isPromotion) continue;

    const playerName = t.person?.fullName || '';
    if (!playerName) continue;
    const playerLower = playerName.toLowerCase();

    // Check graduated list
    const graduated = await env.CACHE.get(`graduated:${playerLower}`);
    if (graduated) continue;

    // Must be in both portfolio and prospect list
    if (!portfolioNames.includes(playerLower)) continue;
    if (!prospectNames.has(playerLower)) continue;

    // Check if first MLB call-up
    const isCallUp = desc.includes('selected the contract of');
    if (isCallUp) {
      await env.CACHE.put(`graduated:${playerLower}`, '1');
    }

    const message = isCallUp
      ? `🚨 MLB Call-Up: ${playerName} selected to roster!`
      : `⬆️ Promotion: ${playerName} assigned up in minors`;

    await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: env.PUSHOVER_TOKEN,
        user: env.PUSHOVER_USER,
        message,
        title: 'Prospect Promotion Alert'
      })
    });
  }
}

// ── [9] handleSbData ─────────────────────────────────────────────────────────
async function handleSbDataGet(env, cors) {
  try {
    const saved = await env.CACHE.get('sb_saved_searches');
    const favs  = await env.CACHE.get('sb_fav_sellers');
    return new Response(JSON.stringify({
      savedSearches: saved ? JSON.parse(saved) : [],
      favSellers:    favs  ? JSON.parse(favs)  : ['dcsports87', 'comc_consignment'],
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

async function handleSbDataPost(request, env, cors) {
  try {
    const { savedSearches, favSellers } = await request.json();
    if (savedSearches !== undefined) {
      await env.CACHE.put('sb_saved_searches', JSON.stringify(savedSearches));
    }
    if (favSellers !== undefined) {
      await env.CACHE.put('sb_fav_sellers', JSON.stringify(favSellers));
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

// ── [10] handleTestPromotions ─────────────────────────────────────────────────
  async function handleTestPromotions(env, cors) {
  const today = new Date().toLocaleString('en-CA', { timeZone: 'America/New_York' }).split(',')[0];
  const results = { date: today, transactions: [], matches: [] };

  // Fetch portfolio names
  const portfolioRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/12sNofzPwhb8uR68hT_bJNiLD2MrM0rdoQMPXGTlx2_s/values/Card%20Cost%20Tracker%20Final!H:H?key=AIzaSyCl43LqZrRJ-MlPkKiKjk51O2Aklv-T0RE`
  );
  const portfolioData = await portfolioRes.json();
  const portfolioNames = (portfolioData.values || []).flat().map(n => n.trim().toLowerCase()).filter(Boolean);
  results.portfolioCount = portfolioNames.length;

  // Fetch prospect names
  const sheetsRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/15pRN3ILeyfbPG2OMRxh0OUtqg6MZCaLMMjwf4yxDV74?key=AIzaSyCl43LqZrRJ-MlPkKiKjk51O2Aklv-T0RE`
  );
  const sheetsData = await sheetsRes.json();
  const tabNames = sheetsData.sheets.map(s => s.properties.title);

  const prospectNames = new Set();
  for (const tab of tabNames) {
    const tabRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/15pRN3ILeyfbPG2OMRxh0OUtqg6MZCaLMMjwf4yxDV74/values/${encodeURIComponent(tab)}!A:Z?key=AIzaSyCl43LqZrRJ-MlPkKiKjk51O2Aklv-T0RE`
    );
    const tabData = await tabRes.json();
    (tabData.values || []).forEach(row => {
      row.forEach(cell => {
        if (cell && cell.trim()) prospectNames.add(cell.trim().toLowerCase());
      });
    });
  }
  results.prospectCount = prospectNames.size;

  // Fetch transactions
  const apiUrl = `https://statsapi.mlb.com/api/v1/transactions?startDate=${today}&endDate=${today}&sportId=11`;
  const apiRes = await fetch(apiUrl);
  const apiData = await apiRes.json();
  const transactions = apiData.transactions || [];
  results.totalTransactions = transactions.length;

  for (const t of transactions) {
    const desc = t.description || '';
    const isPromotion = desc.includes('assigned to') || desc.includes('selected the contract of');
    if (!isPromotion) continue;

    results.transactions.push(desc);

    const playerName = t.person?.fullName || '';
    const playerLower = playerName.toLowerCase();

    const inPortfolio = portfolioNames.includes(playerLower);
    const inProspects = prospectNames.has(playerLower);

    if (inPortfolio && inProspects) {
      results.matches.push(playerName);
    }
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}
// ── [11] dailyStats ───────────────────────────────────────────────────────────
async function handleDailyStats(env, cors) {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const date = yesterday.toLocaleString('en-CA', { timeZone: 'America/New_York' }).split(',')[0];

    const testPlayers = ['Steele Hall', 'Nathan Flewelling', 'Cooper Flemming', 'Bo Davison', 'Josh Owens'];

    const levelGroups = {};

    for (const name of testPlayers) {
      const searchRes = await fetch(
        `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}&sportId=11`
      );
      const searchData = await searchRes.json();
      const people = searchData.people || [];
      if (people.length === 0) continue;

      const playerId = people[0].id;

      const logRes = await fetch(
        `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=gameLog&gameType=R&leagueListId=milb_all&group=hitting,pitching&season=2026&hydrate=team(league)`
      );
      const logData = await logRes.json();
      const stats = logData.stats || [];

      for (const statGroup of stats) {
        const splits = statGroup.splits || [];
        const yesterdaySplit = splits.find(s => s.date === date);
        if (!yesterdaySplit) continue;

        const team = yesterdaySplit.team?.name || 'Unknown';
        const league = yesterdaySplit.team?.league?.name || 'MiLB';
        const level = league.includes('International') || league.includes('Pacific Coast') ? 'Triple-A' :
                      league.includes('Eastern') || league.includes('Southern') || league.includes('Texas') ? 'Double-A' :
                      league.includes('Midwest') || league.includes('South Atlantic') || league.includes('California') ? 'Single-A' :
                      league.includes('High') ? 'High-A' : league || 'MiLB';

        const s = yesterdaySplit.stat;
        const isHitter = statGroup.group?.displayName === 'hitting';
        const statLine = isHitter
          ? `${s.atBats}AB ${s.hits}H ${s.runs}R ${s.doubles}2B ${s.triples}3B ${s.homeRuns}HR ${s.rbi}RBI ${s.baseOnBalls}BB ${s.strikeOuts}K ${s.stolenBases}SB`
          : `${s.inningsPitched}IP ${s.hits}H ${s.runs}R ${s.earnedRuns}ER ${s.baseOnBalls}BB ${s.strikeOuts}K ${s.homeRuns}HR ${s.numberOfPitches}P`;

        if (!levelGroups[level]) levelGroups[level] = [];
        levelGroups[level].push({ name: people[0].fullName, team, statLine });
      }
    }

    const levelOrder = ['Triple-A', 'Double-A', 'High-A', 'Single-A', 'MiLB'];
    let html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Daily Stats — ${date}</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #0f0f0f; color: #eee; padding: 16px; max-width: 600px; margin: 0 auto; }
  h1 { font-size: 18px; color: #fff; margin-bottom: 4px; }
  .date { color: #888; font-size: 13px; margin-bottom: 24px; }
  h2 { font-size: 14px; color: #aaa; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #333; padding-bottom: 6px; margin-top: 24px; }
  .player { padding: 10px 0; border-bottom: 1px solid #1a1a1a; }
  .player-name { font-weight: 600; font-size: 15px; }
  .player-team { color: #888; font-size: 12px; margin-bottom: 4px; }
  .stat-line { font-size: 14px; color: #4ade80; font-family: monospace; }
  .empty { color: #555; font-size: 14px; padding: 16px 0; }
</style></head><body>
<h1>Prospect Daily Stats</h1>
<div class="date">${date}</div>`;

    let hasAny = false;
    for (const level of levelOrder) {
      if (!levelGroups[level] || levelGroups[level].length === 0) continue;
      hasAny = true;
      html += `<h2>${level}</h2>`;
      for (const p of levelGroups[level]) {
        html += `<div class="player">
          <div class="player-name">${p.name}</div>
          <div class="player-team">${p.team}</div>
          <div class="stat-line">${p.statLine}</div>
        </div>`;
      }
    }

    if (!hasAny) {
      html += `<div class="empty">No games played yesterday by your prospects.</div>`;
    }

    html += `</body></html>`;

    return new Response(html, {
      headers: { ...cors, 'Content-Type': 'text/html' }
    });
  } catch(e) {
    return new Response(`Error: ${e.message}`, { status: 500, headers: cors });
  }
}
// ── [12] sendDailyStatsNotification ──────────────────────────────────────────
async function sendDailyStatsNotification(env) {
  await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: env.PUSHOVER_TOKEN,
      user: env.PUSHOVER_USER,
      message: 'Tap to view your prospects\' stats from last night.',
      title: '📊 Daily Prospect Stats',
      url: 'https://card-app.maxcsolomon.workers.dev/daily-stats',
      url_title: 'View Stats'
    })
  });
}
// ── [13] checkPlayerSearches ──────────────────────────────────────────────────
async function checkPlayerSearches(env) {
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
  if (!tokenData.access_token) return;

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
      let q = search.query || '';
      if (search.sport) q = q ? `${q} ${search.sport}` : search.sport;
      if (!q && !search.seller) continue;
      const filterStr = filters.length ? `&filter=${encodeURIComponent(filters.join(','))}` : '';
      let items = [];
      let page = 1;
      const maxPages = 5;
      let keepPaging = true;
      while (keepPaging && page <= maxPages) {
        const offset = (page - 1) * 200;
        const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&category_ids=212&sort=newlyListed${filterStr}&limit=200&offset=${offset}`;
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
        seen: false
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

    // Build filters
    const filters = [];
    if (search.listingType && search.listingType !== 'BOTH') {
      filters.push(`buyingOptions:{${search.listingType}}`);
    }
    if (search.seller) {
      if (search.sellerMode === 'include') {
        filters.push(`sellers:{${search.seller}}`);
      } else {
        filters.push(`excludeSellers:{${search.seller}}`);
      }
    }
    if (search.condition === 'Graded') filters.push('conditionIds:{2750}');
    if (search.condition === 'Ungraded') filters.push('conditionIds:{4000}');
    if (search.usOnly) filters.push('itemLocationCountry:US');
    if (search.minPrice || search.maxPrice) {
      const min = search.minPrice || '0';
      const max = search.maxPrice || '';
      filters.push(`price:[${min}..${max}]`);
      filters.push('priceCurrency:USD');
    }
    const aspectFilter = search.serial ? `&aspect_filter=${encodeURIComponent('categoryId:212,Features:{Serial Numbered}')}` : '';

    // Build query
    let q = search.query || '';
    if (search.sport) q = q ? `${q} ${search.sport}` : search.sport;
    if (!q && !search.seller) continue;

    const filterStr = filters.length ? `&filter=${encodeURIComponent(filters.join(','))}` : '';
    let newItems = [];
    let page = 1;
    const maxPages = 5;
    let keepPaging = true;
    while (keepPaging && page <= maxPages) {
      const offset = (page - 1) * 200;
      const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&category_ids=212&sort=newlyListed${filterStr}${aspectFilter}&limit=200&offset=${offset}`;
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
async function checkNightlySearches(env) {
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
  if (!tokenData.access_token) return;

  const now = Date.now();
  const cutoff = now - (24 * 60 * 60 * 1000);

  for (const group of groups) {
    const groupSearches = data.searches.filter(s => s.groupId === group.id);
    if (groupSearches.length === 0) continue;

    const groupMapped = [];
    for (const search of groupSearches) {
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
      let q = search.query || '';
    const aspectFilter = search.serial ? `&aspect_filter=${encodeURIComponent('categoryId:212,Features:{Serial Numbered}')}` : '';
    if (search.sport) q = q ? `${q} ${search.sport}` : search.sport;
    if (!q && !search.seller) continue;

    const filterStr = filters.length ? `&filter=${encodeURIComponent(filters.join(','))}` : '';
    let newItems = [];
    let page = 1;
    const maxPages = 15;
    let keepPaging = true;
    let hitLimit = false;
    while (keepPaging && page <= maxPages) {
      const offset = (page - 1) * 200;
      const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&category_ids=212&sort=newlyListed${filterStr}${aspectFilter}&limit=200&offset=${offset}`;
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
        seen: false
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
    const aspectFilter = search.serial ? `&aspect_filter=${encodeURIComponent('categoryId:212,Features:{Serial Numbered}')}` : '';
    let q = search.query || '';
    if (search.sport) q = q ? `${q} ${search.sport}` : search.sport;
    if (!q && !search.seller) continue;

    const filterStr = filters.length ? `&filter=${encodeURIComponent(filters.join(','))}` : '';
    let items = [];
    let page = 1;
    const maxPages = 15;
    let keepPaging = true;
    let hitLimit = false;
    while (keepPaging && page <= maxPages) {
      const offset = (page - 1) * 200;
      const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&category_ids=212&sort=newlyListed${filterStr}${aspectFilter}&limit=200&offset=${offset}`;
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
async function sendPlayerDigestNotification(env) {
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
async function handlePlayerDigest(request, env, cors) {
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
async function clearPlayerDigests(env) {
  const saved = await env.CACHE.get('player_search_alerts');
  const data = saved ? JSON.parse(saved) : { groups: [], searches: [] };
  const groupKeys = (data.groups || []).map(g => g.digestKey);
  const searchKeys = (data.searches || []).filter(s => !s.groupId).map(s => s.digestKey);
  for (const key of [...groupKeys, ...searchKeys]) {
    await env.CACHE.delete(key);
  }
}
// ── [18] handleSearchAlerts ───────────────────────────────────────────────────
async function handleSearchAlertsGet(env, cors) {
  try {
    const saved = await env.CACHE.get('player_search_alerts');
    let data = saved ? JSON.parse(saved) : { groups: [], searches: [] };
    if (Array.isArray(data)) data = { groups: [], searches: data };
    return new Response(JSON.stringify(data), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

async function handleSearchAlertsPost(request, env, cors) {
  try {
    const { groups, searches, deleteKeys } = await request.json();
    const saved = await env.CACHE.get('player_search_alerts');
    let current = saved ? JSON.parse(saved) : { groups: [], searches: [] };
    if (Array.isArray(current)) current = { groups: [], searches: current };
    if (groups !== undefined) current.groups = groups;
    if (searches !== undefined) current.searches = searches;
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
async function handleMarkSeenUrls(request, env, cors) {
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
async function handleMarkSeen(request, env, cors) {
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

// ── [21] handleSetSnipe ───────────────────────────────────────────────────────
async function handleSetSnipe(request, env, cors) {
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

// ── [22] handleScan — Drive scan lookup by ItemID ────────────────────────────
async function handleScan(request, env, cors) {
  try {
    const url = new URL(request.url);
    const itemId = url.searchParams.get('id');
    if (!itemId) return new Response(JSON.stringify({ error: 'missing id' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    });

    const cacheKey = `scan:${itemId}`;
    const cached = await env.CACHE.get(cacheKey);
    if (cached) return new Response(cached, { headers: { ...cors, 'Content-Type': 'application/json' } });

    const token = await getGoogleAccessToken(env);
    const q = `name contains '${itemId}' and mimeType contains 'image/' and trashed=false`;
    const driveUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&pageSize=10`;
    const driveRes = await fetch(driveUrl, { headers: { Authorization: `Bearer ${token}` } });
    const driveData = await driveRes.json();
    const files = driveData.files || [];

    const back = files.find(f => /back/i.test(f.name));
    const front = files.find(f => f !== back) || files[0] || null;

    const result = {
      front: front ? { id: front.id, link: front.webViewLink, thumb: `https://drive.google.com/thumbnail?id=${front.id}&sz=w800` } : null,
      back: back ? { id: back.id, link: back.webViewLink, thumb: `https://drive.google.com/thumbnail?id=${back.id}&sz=w800` } : null
    };

    const body = JSON.stringify(result);
    await env.CACHE.put(cacheKey, body, { expirationTtl: 604800 });
    return new Response(body, { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

// ── [22b] cleanSecret ──────────────────────────────────────────────────────────
const cleanSecret = s => (s || '').trim().replace(/^"|"$/g, '').replace(/,$/, '').trim();

// ── [23] getGoogleAccessToken ─────────────────────────────────────────────────
async function getGoogleAccessToken(env) {
  const cached = await env.CACHE.get('google_access_token');
  if (cached) return cached;

  const now = Math.floor(Date.now() / 1000);
  const enc = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: cleanSecret(env.GOOGLE_SA_EMAIL),
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })}`;

  const key = await importPrivateKey(cleanSecret(env.GOOGLE_SA_KEY));
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(unsigned)
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${sigB64}`
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('google_auth_failed: ' + JSON.stringify(data));

  await env.CACHE.put('google_access_token', data.access_token, { expirationTtl: 3500 });
  return data.access_token;
}

// ── [24] importPrivateKey ─────────────────────────────────────────────────────
async function importPrivateKey(pem) {
  let body = pem.trim();
  if (body.startsWith('"') && body.endsWith('"')) body = body.slice(1, -1);
  body = body.replace(/\\n/g, '\n')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/[^A-Za-z0-9+/=]/g, '');
  const binaryDer = Uint8Array.from(atob(body), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    binaryDer.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}
// ── [19] handlePlayerDigestJson ───────────────────────────────────────────────
async function handlePlayerDigestJson(request, env, cors) {
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
// ── [20] handleRunSearch ──────────────────────────────────────────────────────
async function handleRunSearch(request, env, cors) {
  try {
    const { digestKey } = await request.json();
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
    const searchList = group ? data.searches.filter(s => s.groupId === group.id) : [search];
    const allItems = [];

    for (const s of searchList) {
      const filters = [];
      if (s.listingType && s.listingType !== 'BOTH') filters.push(`buyingOptions:{${s.listingType}}`);
      if (s.seller) {
        if (s.sellerMode === 'include') filters.push(`sellers:{${s.seller}}`);
        else filters.push(`excludeSellers:{${s.seller}}`);
      }
      if (s.condition === 'Graded') filters.push('conditionIds:{2750}');
      if (s.condition === 'Ungraded') filters.push('conditionIds:{4000}');
      if (s.usOnly) filters.push('itemLocationCountry:US');
      if (s.minPrice || s.maxPrice) {
        filters.push(`price:[${s.minPrice || '0'}..${s.maxPrice || ''}]`);
        filters.push('priceCurrency:USD');
      }
      const aspectFilter = s.serial ? `&aspect_filter=${encodeURIComponent('categoryId:212,Features:{Serial Numbered}')}` : '';
      let q = s.query || '';
      if (s.sport) q = q ? `${q} ${s.sport}` : s.sport;
      if (!q && !s.seller) continue;

      const filterStr = filters.length ? `&filter=${encodeURIComponent(filters.join(','))}` : '';
      const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&category_ids=212&sort=newlyListed${filterStr}${aspectFilter}&limit=200`;
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } });
      const apiData = await res.json();
      let filtered = (apiData.itemSummaries || []).filter(item => new Date(item.itemCreationDate).getTime() > cutoff);

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
        seen: false
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


    return new Response(JSON.stringify({ ok: true, count: items.length }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}
