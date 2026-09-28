// ── scan-index.js — one KV index of every card's front/back Drive photo ─────────
// Replaces per-card, per-page Drive lookups. Rebuilt only on request (Settings →
// Refresh all photos) from a single paged Drive listing. Own scans win over COMC images.
import { getGoogleAccessToken } from './cardmeta.js';

const INDEX_KEY = 'scan-index';
const VERSION_KEY = 'scan-index-version';
const COMC_FOLDER_ID = '19S73azDgJwYkqfkMsx6c1nlp2XN5pjT0';

function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

// Same rules as the old per-card lookup: prefer non-COMC files; "back" in the name is the back.
// Returns [frontId|null, backId|null, fromComc 0/1] or null if no files.
function pickScans(files) {
  if (!files || !files.length) return null;
  const isComc = f => (f.parents || []).includes(COMC_FOLDER_ID);
  const own = files.filter(f => !isComc(f));
  const use = own.length ? own : files;
  const back = use.find(f => /back/i.test(f.name));
  const front = use.find(f => f !== back) || use[0] || null;
  return [front ? front.id : null, back ? back.id : null, own.length ? 0 : 1];
}

async function listAllDriveImages(token) {
  const files = [];
  let pageToken = '';
  for (let page = 0; page < 100; page++) {
    const q = "mimeType contains 'image/' and trashed=false";
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('nextPageToken,files(id,name,parents)')}&pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(`Drive listing failed (${res.status}): ${(data.error && data.error.message) || 'unknown'}`);
    files.push(...(data.files || []));
    if (!data.nextPageToken) return { files, pages: page + 1 };
    pageToken = data.nextPageToken;
  }
  throw new Error('Drive listing too large (over 100,000 images)');
}

// Matches files to cards the way the old lookup did ("file name contains the item ID").
// Numeric IDs use a digit-run lookup (fast); anything else falls back to a substring scan.
function buildMap(files, itemIds) {
  const byNumber = new Map();
  for (const f of files) {
    for (const run of new Set((f.name || '').match(/\d+/g) || [])) {
      if (!byNumber.has(run)) byNumber.set(run, []);
      byNumber.get(run).push(f);
    }
  }
  const map = {};
  for (const id of itemIds) {
    const matches = /^\d+$/.test(id)
      ? (byNumber.get(id) || [])
      : files.filter(f => (f.name || '').includes(id));
    const picked = pickScans(matches);
    if (picked) map[id] = picked;
  }
  return map;
}

async function saveIndex(env, index) {
  index.version = new Date().toISOString();
  await env.CACHE.put(INDEX_KEY, JSON.stringify(index));
  await env.CACHE.put(VERSION_KEY, index.version);
  return index.version;
}

async function loadIndex(env) {
  return await env.CACHE.get(INDEX_KEY, { type: 'json' });
}

// GET /scan-index-version → { version } (tiny; checked on every app open)
export async function handleScanIndexVersion(env, cors) {
  const version = await env.CACHE.get(VERSION_KEY);
  return json({ version: version || null }, 200, cors);
}

// GET /scan-index → full index
export async function handleScanIndexGet(env, cors) {
  const raw = await env.CACHE.get(INDEX_KEY);
  return new Response(raw || JSON.stringify({ version: null, map: {} }), { headers: { ...cors, 'Content-Type': 'application/json' } });
}

// POST /scan-index-rebuild { itemIds: [...] } → rebuilds the whole index from one Drive listing
export async function handleScanIndexRebuild(request, env, cors) {
  try {
    const started = Date.now();
    const body = await request.json();
    const itemIds = Array.isArray(body.itemIds) ? [...new Set(body.itemIds.map(String).filter(Boolean))] : [];
    if (!itemIds.length) return json({ error: 'missing itemIds' }, 400, cors);

    const token = await getGoogleAccessToken(env);
    const { files, pages } = await listAllDriveImages(token);
    const map = buildMap(files, itemIds);

    const entries = Object.values(map);
    const counts = {
      cards: itemIds.length,
      images: files.length,
      withPhoto: entries.length,
      own: entries.filter(e => !e[2]).length,
      comc: entries.filter(e => e[2]).length,
      missing: itemIds.length - entries.length,
    };
    const prev = await loadIndex(env);
    const prevMap = (prev && prev.map) || {};
    counts.changed = itemIds.filter(id => JSON.stringify(prevMap[id] || null) !== JSON.stringify(map[id] || null)).length;

    const version = await saveIndex(env, { builtAt: new Date().toISOString(), counts, map });
    return json({ ok: true, version, counts, driveListPages: pages, ms: Date.now() - started }, 200, cors);
  } catch (e) {
    return json({ error: e.message }, 500, cors);
  }
}

// POST /scan-index-update { itemId } → live Drive lookup for one card, written into the index
export async function handleScanIndexUpdate(request, env, cors) {
  try {
    const { itemId } = await request.json();
    if (!itemId) return json({ error: 'missing itemId' }, 400, cors);
    const token = await getGoogleAccessToken(env);
    const q = `name contains '${String(itemId).replace(/'/g, "\\'")}' and mimeType contains 'image/' and trashed=false`;
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,parents)&pageSize=20`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) return json({ error: `Drive lookup failed (${res.status})` }, 502, cors);
    const entry = pickScans(data.files || []);

    const index = (await loadIndex(env)) || { builtAt: null, counts: null, map: {} };
    if (entry) index.map[itemId] = entry; else delete index.map[itemId];
    const version = await saveIndex(env, index);
    await env.CACHE.delete(`scan:${itemId}`); // old per-card cache, so eBay photos match
    return json({ ok: true, version, itemId, entry: entry || null }, 200, cors);
  } catch (e) {
    return json({ error: e.message }, 500, cors);
  }
}

// For the eBay photo proxy: the Drive file ID for one side of a card, or undefined if not indexed.
export async function getIndexedFileId(env, itemId, side) {
  const index = await loadIndex(env);
  const entry = index && index.map && index.map[itemId];
  if (!entry) return undefined;
  return (side === 'back' ? entry[1] : entry[0]) || null;
}
