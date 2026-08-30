// ── worker.js — entry point: router + imports
import { notifyCronFailure, handleDailyStats, sendDailyStatsNotification, handleTestPromotions, handleSbDataGet, handleSbDataPost, handleRateLimitCheck, handleMarketplaceInsightsTest } from './worker/misc.js';
import { handleAuth, handleCallback, handleWatchlist, handleSaveTitle, handleSetSnipe, handleAddToWatch, refreshWatchlistCache } from './worker/ebay-watchlist.js';
import {
  checkPlayerSearches, checkNightlySearches, sendPlayerDigestNotification, clearPlayerDigests,
  handlePlayerDigest, handlePlayerDigestJson, handleSearchAlertsGet, handleSearchAlertsPost,
  handleMarkSeen, handleMarkSeenUrls, handleRunSearch
} from './worker/search-alerts.js';
import {
  handleScan, handleScanBatch, handleCardMetaAll, handleCardMetaPost, handleCardMetaInHandAll,
  handleComcPulledAll, handleComcPulledPost, handleComcPulledInvalidateScans,
  handleCardOverride, handleCardOverridePendingAll, handleCardOverridePendingClear,
  handleCardImage, handleEbayQueuePost, handleEbayQueueAll, handleEbayQueueRemove
} from './worker/cardmeta.js';





// ── Main router ───────────────────────────────────────────────────────────────
const PROTECTED_ROUTES = new Set([
  'POST:/save-title',
  'POST:/run-search',
  'POST:/search-alerts',
  'POST:/sb-data',
  'POST:/mark-seen',
  'POST:/mark-seen-urls',
  'POST:/set-snipe',
  'POST:/watch-add',
  'POST:/scan-batch',
  'POST:/card-meta',
  'POST:/comc-pulled',
  'POST:/card-override',
  'POST:/card-override-pending-clear',
  'POST:/ebay-queue',
  'POST:/ebay-queue-remove',
  'GET:/test-promotions',
  'GET:/comc-pulled-invalidate-scans',
]);


export default {
  async scheduled(event, env, ctx) {
   try {
    if (event.cron === '*/15 * * * *') {
      await refreshWatchlistCache(env);
      return;
    }
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
   } catch (e) {
     await notifyCronFailure(env, event.cron, e.message);
   }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-App-Key',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    if (PROTECTED_ROUTES.has(`${request.method}:${path}`)) {
      if (request.headers.get('X-App-Key') !== env.APP_KEY) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
    }

    if (path.startsWith('/card-image/')) return handleCardImage(request, env, cors);
    if (path === '/auth') return handleAuth(env);
    if (path === '/callback') return handleCallback(request, env);
    if (path === '/watchlist') return handleWatchlist(request, env, cors);
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
    if (path === '/watch-add' && request.method === 'POST') return handleAddToWatch(request, env, cors);
    if (path === '/scan' && request.method === 'GET') return handleScan(request, env, cors);
    if (path === '/scan-batch' && request.method === 'POST') return handleScanBatch(request, env, cors);
    if (path === '/card-meta-all' && request.method === 'GET') return handleCardMetaAll(env, cors);
    if (path === '/card-meta' && request.method === 'POST') return handleCardMetaPost(request, env, cors);
    if (path === '/card-meta-inhand-all' && request.method === 'GET') return handleCardMetaInHandAll(env, cors);
    if (path === '/comc-pulled-all' && request.method === 'GET') return handleComcPulledAll(env, cors);
    if (path === '/comc-pulled' && request.method === 'POST') return handleComcPulledPost(request, env, cors);
    if (path === '/comc-pulled-invalidate-scans' && request.method === 'GET') return handleComcPulledInvalidateScans(env, cors);
    if (path === '/card-override' && request.method === 'POST') return handleCardOverride(request, env, cors);
    if (path === '/card-override-pending-all' && request.method === 'GET') return handleCardOverridePendingAll(env, cors);
    if (path === '/card-override-pending-clear' && request.method === 'POST') return handleCardOverridePendingClear(request, env, cors);
    if (path === '/ebay-queue' && request.method === 'POST') return handleEbayQueuePost(request, env, cors);
    if (path === '/ebay-queue-all' && request.method === 'GET') return handleEbayQueueAll(env, cors);
    if (path === '/ebay-queue-remove' && request.method === 'POST') return handleEbayQueueRemove(request, env, cors);
    if (path === '/rate-limit-check' && request.method === 'GET') return handleRateLimitCheck(env, cors);
    if (path === '/mi-test' && request.method === 'GET') return handleMarketplaceInsightsTest(env, cors);
    return new Response('card-app worker running', { headers: cors });
  }
};

