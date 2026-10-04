// ── worker.js — entry point: router + imports
import { notifyCronFailure, handleDailyStats, sendDailyStatsNotification, handleTestPromotions, handleSbDataGet, handleSbDataPost, handleRateLimitCheck, handleMarketplaceInsightsTest } from './worker/misc.js';
import { handleAuth, handleCallback, handleWatchlist, handleSaveTitle, handleSetSnipe, handleAddToWatch, handleRemoveFromWatch, refreshWatchlistCache } from './worker/ebay-watchlist.js';
import { reconcileListingTags } from './worker/ebay-selling.js';
import {
  checkPlayerSearches, checkNightlySearches, sendPlayerDigestNotification, clearPlayerDigests,
  handlePlayerDigest, handlePlayerDigestJson, handleSearchAlertsGet, handleSearchAlertsPost,
  handleMarkSeen, handleMarkSeenUrls, handleRunSearch
} from './worker/search-alerts.js';
import {
  handleScan, handleScanBatch, handleCardMetaAll, handleCardMetaPost, handleCardMetaInHandAll,
  handleComcPulledAll, handleComcPulledPost, handleComcPulledInvalidateScans,
  handleCardOverride, handleCardOverridePendingAll, handleCardOverridePendingClear,
  handleCardImage
} from './worker/cardmeta.js';
import { handleDebugRawWatchlist } from './worker/debug.js';
import { handleScanIndexVersion, handleScanIndexGet, handleScanIndexRebuild, handleScanIndexUpdate } from './worker/scan-index.js';
import { handleEbayPublish, handleEbayListingStatus, handleEbayFeePreview, handleEbayDiscard } from './worker/ebay-publish.js';
import { handleEbayMyListings, handleEbayListingDetail, handleEbayListingUpdate, handleEbayListingEnd } from './worker/ebay-listings.js';
import { handleCardDb, runCardDbJobs } from './worker/card-db.js';



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
  'POST:/watch-remove',
  'POST:/scan-batch',
  'POST:/card-meta',
  'POST:/comc-pulled',
  'POST:/card-override',
  'POST:/card-override-pending-clear',
  'POST:/ebay-publish',
  'POST:/scan-index-rebuild',
  'POST:/scan-index-update',
  'POST:/ebay-fee-preview',
  'POST:/ebay-discard',
  'GET:/ebay-listing-status',
  'GET:/ebay-my-listings',
  'GET:/ebay-listing-detail',
  'POST:/ebay-listing-update',
  'POST:/ebay-listing-end',
  'GET:/test-promotions',
  'GET:/comc-pulled-invalidate-scans',
]);


export default {
  async scheduled(event, env, ctx) {
   try {
        if (event.cron === '*/15 * * * *') {
      await refreshWatchlistCache(env);
      await reconcileListingTags(env);
      return;
    }
    // Card database jobs (eBay sales + purchases, backup sheet): 7am / 7pm Eastern = 11:00 / 23:00 UTC hourly runs
    if (event.cron === '0 * * * *') {
      const h = new Date(event.scheduledTime).getUTCHours();
      if (h === 11 || h === 23) ctx.waitUntil(runCardDbJobs(env));
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
    if (path === '/watch-remove' && request.method === 'POST') return handleRemoveFromWatch(request, env, cors);
    if (path === '/debug-raw-watchlist' && request.method === 'GET') return handleDebugRawWatchlist(request, env, cors);
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
    if (path === '/ebay-publish' && request.method === 'POST') return handleEbayPublish(request, env, cors);
    if (path === '/scan-index-version' && request.method === 'GET') return handleScanIndexVersion(env, cors);
    if (path === '/scan-index' && request.method === 'GET') return handleScanIndexGet(env, cors);
    if (path === '/scan-index-rebuild' && request.method === 'POST') return handleScanIndexRebuild(request, env, cors);
    if (path === '/scan-index-update' && request.method === 'POST') return handleScanIndexUpdate(request, env, cors);
    if (path === '/ebay-fee-preview' && request.method === 'POST') return handleEbayFeePreview(request, env, cors);
    if (path === '/ebay-discard' && request.method === 'POST') return handleEbayDiscard(request, env, cors);
    if (path === '/ebay-listing-status' && request.method === 'GET') return handleEbayListingStatus(request, env, cors);
    if (path === '/ebay-my-listings' && request.method === 'GET') return handleEbayMyListings(request, env, cors);
    if (path === '/ebay-listing-detail' && request.method === 'GET') return handleEbayListingDetail(request, env, cors);
    if (path === '/ebay-listing-update' && request.method === 'POST') return handleEbayListingUpdate(request, env, cors);
    if (path === '/ebay-listing-end' && request.method === 'POST') return handleEbayListingEnd(request, env, cors);
    if (path === '/rate-limit-check' && request.method === 'GET') return handleRateLimitCheck(env, cors);
    if (path === '/mi-test' && request.method === 'GET') return handleMarketplaceInsightsTest(env, cors);
    const cardDbRes = await handleCardDb(request, env, cors);
    if (cardDbRes) return cardDbRes;
    return new Response('card-app worker running', { headers: cors });
  }
};
