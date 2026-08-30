// ── debug.js — temporary debug endpoints, delete when no longer needed ────────

export async function handleDebugToken(request, env, cors) {
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
