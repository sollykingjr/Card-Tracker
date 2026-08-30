// ── debug.js — temporary debug endpoints, delete when no longer needed ────────

export async function handleDebugToken(request, env, cors) {
  const appKey = request.headers.get('X-App-Key');
  if (appKey !== env.APP_KEY) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const accessToken = await env.CACHE.get('ebay_access_token');
  const refreshToken = await env.CACHE.get('ebay_refresh_token');

  return new Response(JSON.stringify({
    hasAccessToken: !!accessToken,
    accessToken,
    hasRefreshToken: !!refreshToken
  }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}
