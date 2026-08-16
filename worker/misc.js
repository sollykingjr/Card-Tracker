// ── misc.js — cron alerting, daily stats, promotions test, search-builder data

export async function notifyCronFailure(env, jobName, message) {
  const throttleKey = `cron-failure-alert:${jobName}`;
  const alreadyAlerted = await env.CACHE.get(throttleKey);
  if (alreadyAlerted) return;
  await env.CACHE.put(throttleKey, '1', { expirationTtl: 21600 }); // 6 hours
  await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: env.PUSHOVER_TOKEN,
      user: env.PUSHOVER_USER,
      title: `⚠️ Cron failure: ${jobName}`,
      message: message || 'Check Cloudflare Worker logs for details.',
    })
  });
}

// ── [9] handleSbData ─────────────────────────────────────────────────────────
export async function handleSbDataGet(env, cors) {
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

export async function handleSbDataPost(request, env, cors) {
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
  export async function handleTestPromotions(env, cors) {
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
export async function handleDailyStats(env, cors) {
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
export async function sendDailyStatsNotification(env) {
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
