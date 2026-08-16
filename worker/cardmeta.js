// ── cardmeta.js — card scans, tags/In-Hand, COMC tracking, sheet overrides

export async function handleScan(request, env, cors) {
  try {
    const url = new URL(request.url);
    const itemId = url.searchParams.get('id');
    if (!itemId) return new Response(JSON.stringify({ error: 'missing id' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    });

    const debug = url.searchParams.get('debug');
    const cacheKey = `scan:${itemId}`;
    const cached = await env.CACHE.get(cacheKey);
    if (cached && !debug) return new Response(cached, { headers: { ...cors, 'Content-Type': 'application/json' } });

    const token = await getGoogleAccessToken(env);
    const q = `name contains '${itemId}' and mimeType contains 'image/' and trashed=false`;
    const driveUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink,parents)&pageSize=10`;
    const driveRes = await fetch(driveUrl, { headers: { Authorization: `Bearer ${token}` } });
    const driveData = await driveRes.json();
    const allFiles = driveData.files || [];

    const COMC_FOLDER_ID = '19S73azDgJwYkqfkMsx6c1nlp2XN5pjT0';
    const isComc = f => (f.parents || []).includes(COMC_FOLDER_ID);
    const nonComcFiles = allFiles.filter(f => !isComc(f));
    const files = nonComcFiles.length > 0 ? nonComcFiles : allFiles;

    const back = files.find(f => /back/i.test(f.name));
    const front = files.find(f => f !== back) || files[0] || null;

    const result = {
      front: front ? { id: front.id, link: front.webViewLink, thumb: `https://drive.google.com/thumbnail?id=${front.id}&sz=w800`, thumbSm: `https://drive.google.com/thumbnail?id=${front.id}&sz=w200` } : null,
      back: back ? { id: back.id, link: back.webViewLink, thumb: `https://drive.google.com/thumbnail?id=${back.id}&sz=w800`, thumbSm: `https://drive.google.com/thumbnail?id=${back.id}&sz=w200` } : null
    };

    const body = JSON.stringify(result);
    await env.CACHE.put(cacheKey, body, { expirationTtl: 604800 }); // cache 7 days

    if (debug) {
      return new Response(JSON.stringify({ httpStatus: driveRes.status, query: q, driveData, cachedResult: result }, null, 2), {
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    return new Response(body, { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

// ── [22a] handleScanBatch — batch Drive scan lookup for a page of results ────
export async function handleScanBatch(request, env, cors) {
  try {
    const body = await request.json();
    const itemIds = Array.isArray(body.itemIds) ? [...new Set(body.itemIds.filter(Boolean))] : [];
    if (!itemIds.length) {
      return new Response(JSON.stringify({ error: 'missing itemIds' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const token = await getGoogleAccessToken(env);

    const forceFresh = !!body.fresh;

    const results = await Promise.all(itemIds.map(async (itemId) => {
      const cacheKey = `scan:${itemId}`;
      const cached = await env.CACHE.get(cacheKey);
      if (cached && !forceFresh) return [itemId, JSON.parse(cached)];

      try {
        const q = `name contains '${itemId}' and mimeType contains 'image/' and trashed=false`;
        const driveUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&pageSize=10`;
        const driveRes = await fetch(driveUrl, { headers: { Authorization: `Bearer ${token}` } });
        const driveData = await driveRes.json();
        const files = driveData.files || [];

        const back = files.find(f => /back/i.test(f.name));
        const front = files.find(f => f !== back) || files[0] || null;

        const result = {
          front: front ? { id: front.id, link: front.webViewLink, thumb: `https://drive.google.com/thumbnail?id=${front.id}&sz=w800`, thumbSm: `https://drive.google.com/thumbnail?id=${front.id}&sz=w200` } : null,
          back: back ? { id: back.id, link: back.webViewLink, thumb: `https://drive.google.com/thumbnail?id=${back.id}&sz=w800`, thumbSm: `https://drive.google.com/thumbnail?id=${back.id}&sz=w200` } : null
        };

        await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 604800 });
        return [itemId, result];
      } catch (e) {
        return [itemId, { front: null, back: null }];
      }
    }));

    return new Response(JSON.stringify(Object.fromEntries(results)), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

// ── [22b] cleanSecret ──────────────────────────────────────────────────────────
// ── [22c] handleCardMetaAll — bulk read of all card tags via KV list metadata ─
export async function handleCardMetaAll(env, cors) {
  try {
    const result = {};
    let cursor;
    do {
      const page = await env.CACHE.list({ prefix: 'card-meta:', cursor });
      for (const k of page.keys) {
        const itemId = k.name.slice('card-meta:'.length);
        const tags = (k.metadata && Array.isArray(k.metadata.tags)) ? k.metadata.tags : [];
        result[itemId] = tags;
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

// ── [22c-2] handleCardMetaInHandAll — bulk read of In Hand status via KV list metadata ─
export async function handleCardMetaInHandAll(env, cors) {
  try {
    const result = {};
    let cursor;
    do {
      const page = await env.CACHE.list({ prefix: 'card-meta:', cursor });
      for (const k of page.keys) {
        const itemId = k.name.slice('card-meta:'.length);
        if (k.metadata && k.metadata.inHand) result[itemId] = true;
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

// ── [22d] handleCardMetaPost — set (or clear) tags for one card ─────────────
export async function handleCardMetaPost(request, env, cors) {
  try {
    const body = await request.json();
    const itemId = body.itemId;
    if (!itemId) {
      return new Response(JSON.stringify({ error: 'missing itemId' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
    const key = `card-meta:${itemId}`;
    const existing = await env.CACHE.get(key, { type: 'json' });
    const tags = Object.prototype.hasOwnProperty.call(body, 'tags')
      ? (Array.isArray(body.tags) ? [...new Set(body.tags.filter(Boolean))] : [])
      : (existing && Array.isArray(existing.tags) ? existing.tags : []);
    const inHand = Object.prototype.hasOwnProperty.call(body, 'inHand')
      ? !!body.inHand
      : (existing && existing.inHand ? true : false);
    if (!tags.length && !inHand) {
      await env.CACHE.delete(key);
    } else {
      await env.CACHE.put(key, JSON.stringify({ tags, inHand }), { metadata: { tags, inHand } });
    }
    return new Response(JSON.stringify({ itemId, tags, inHand }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

// ── [22e] handleComcPulledAll — bulk list of COMC items already pulled ──────
export async function handleComcPulledAll(env, cors) {
  try {
    let pulled = ';';
    let cursor;
    do {
      const page = await env.CACHE.list({ prefix: 'comc-pulled:', cursor });
      for (const k of page.keys) {
        pulled += k.name.slice('comc-pulled:'.length) + ';';
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return new Response(pulled, {
      headers: { ...cors, 'Content-Type': 'text/plain' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

// ── [22f] handleComcPulledPost — mark one item+side as pulled, permanently ──
export async function handleComcPulledPost(request, env, cors) {
  try {
    const body = await request.json();
    const itemId = body.itemId;
    const side = body.side;
    if (!itemId || !side) {
      return new Response(JSON.stringify({ error: 'missing itemId or side' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
    const key = `comc-pulled:${itemId}-${side}`;
    await env.CACHE.put(key, 'true');
    await env.CACHE.delete(`scan:${itemId}`);
    return new Response(JSON.stringify({ itemId, side, ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

// ── [22g] handleComcPulledInvalidateScans — one-time bulk cache-bust for
// every item the automation has ever touched, so the app's normal (cached)
// scan lookup stops serving stale "no scan" results for cards that got
// scanned after their cache entry was already set.
export async function handleComcPulledInvalidateScans(env, cors) {
  try {
    const itemIds = new Set();
    let cursor;
    do {
      const page = await env.CACHE.list({ prefix: 'comc-pulled:', cursor });
      for (const k of page.keys) {
        const suffix = k.name.slice('comc-pulled:'.length);
        const itemId = suffix.substring(0, suffix.lastIndexOf('-'));
        itemIds.add(itemId);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    let count = 0;
    for (const itemId of itemIds) {
      await env.CACHE.delete(`scan:${itemId}`);
      count++;
    }

    return new Response(JSON.stringify({ invalidated: count }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

export const cleanSecret = s => (s || '').trim().replace(/^"|"$/g, '').replace(/,$/, '').trim();

// ── [22f] handleCardOverridePendingAll — bulk read of all pending metadata overrides ─
export async function handleCardOverridePendingAll(env, cors) {
  try {
    const result = {};
    let cursor;
    do {
      const page = await env.CACHE.list({ prefix: 'pending-override:', cursor });
      for (const k of page.keys) {
        const itemId = k.name.slice('pending-override:'.length);
        const raw = await env.CACHE.get(k.name);
        if (raw) result[itemId] = JSON.parse(raw);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

// ── [22g] handleCardOverridePendingClear — remove pending flag once resolved ─
export async function handleCardOverridePendingClear(request, env, cors) {
  try {
    const body = await request.json();
    const itemId = body.itemId;
    if (!itemId) {
      return new Response(JSON.stringify({ error: 'missing itemId' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
    await env.CACHE.delete(`pending-override:${itemId}`);
    return new Response(JSON.stringify({ itemId, cleared: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

// ── [25a] handleEbayQueuePost — save (or update) a card's full eBay listing draft ─
export async function handleEbayQueuePost(request, env, cors) {
  try {
    const body = await request.json();
    const itemId = body.itemId;
    if (!itemId) {
      return new Response(JSON.stringify({ error: 'missing itemId' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
    const { itemId: _drop, ...listing } = body;
    await env.CACHE.put(`ebay-queue:${itemId}`, JSON.stringify(listing));
    return new Response(JSON.stringify({ itemId, ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

// ── [25b] handleEbayQueueAll — bulk read of every queued listing ────────────
export async function handleEbayQueueAll(env, cors) {
  try {
    const result = {};
    let cursor;
    do {
      const page = await env.CACHE.list({ prefix: 'ebay-queue:', cursor });
      for (const k of page.keys) {
        const itemId = k.name.slice('ebay-queue:'.length);
        const raw = await env.CACHE.get(k.name);
        if (raw) result[itemId] = JSON.parse(raw);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

// ── [25c] handleEbayQueueRemove — drop one card from the queue ──────────────
export async function handleEbayQueueRemove(request, env, cors) {
  try {
    const body = await request.json();
    const itemId = body.itemId;
    if (!itemId) {
      return new Response(JSON.stringify({ error: 'missing itemId' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
    await env.CACHE.delete(`ebay-queue:${itemId}`);
    return new Response(JSON.stringify({ itemId, removed: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

// ── [23a] getGoogleAccessTokenForSheets ───────────────────────────────────────
export async function getGoogleAccessTokenForSheets(env) {
  const cached = await env.CACHE.get('google_access_token_sheets');
  if (cached) return cached;

  const now = Math.floor(Date.now() / 1000);
  const enc = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: cleanSecret(env.GOOGLE_SA_EMAIL),
    scope: 'https://www.googleapis.com/auth/spreadsheets',
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
  if (!data.access_token) throw new Error('google_auth_failed_sheets: ' + JSON.stringify(data));

  await env.CACHE.put('google_access_token_sheets', data.access_token, { expirationTtl: 3500 });
  return data.access_token;
}

// ── [23b] handleCardOverride ─────────────────────────────────────────────────
export const OVERRIDE_SHEET_ID = '1W413RgDo5q2H7Zu0edx8r9Jngw2NJ_bPsJGdNQ_Oh-w';
export const OVERRIDE_TAB = "'ItemID Overrides'";
export const OVERRIDE_COLUMNS = {
  ItemID: 'A', Sport: 'B', Year: 'C', Set: 'D', Variation: 'E', Version: 'F',
  'Card No': 'G', 'Player Name': 'H', 'Serial No': 'I', 'Qty Manufactured': 'J',
  'Purchased From': 'R', Grade: 'U'
};

export async function handleCardOverride(request, env, cors) {
  try {
    const body = await request.json();
    const itemId = body.itemId;
    const fields = body.fields || {};
    if (!itemId) {
      return new Response(JSON.stringify({ error: 'missing itemId' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const allowedFields = Object.keys(fields).filter(f => OVERRIDE_COLUMNS[f] && f !== 'ItemID');
    if (!allowedFields.length) {
      return new Response(JSON.stringify({ error: 'no valid fields provided' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const token = await getGoogleAccessTokenForSheets(env);

    // Find existing row for this ItemID
    const colARes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${OVERRIDE_SHEET_ID}/values/${encodeURIComponent(OVERRIDE_TAB + '!A:A')}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const colAData = await colARes.json();
    const rows = colAData.values || [];
    const rowIndex = rows.findIndex(r => String(r[0]).trim() === String(itemId).trim());

    if (rowIndex !== -1) {
      // Row exists (0-indexed array, +1 for sheet row number)
      const sheetRow = rowIndex + 1;
      const data = allowedFields.map(f => ({
        range: `${OVERRIDE_TAB}!${OVERRIDE_COLUMNS[f]}${sheetRow}`,
        values: [[fields[f]]]
      }));

      const updateRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${OVERRIDE_SHEET_ID}/values:batchUpdate`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ valueInputOption: 'RAW', data })
        }
      );
      const updateData = await updateRes.json();
      await env.CACHE.put(`pending-override:${itemId}`, JSON.stringify({ fields }));
      return new Response(JSON.stringify({ ok: updateRes.ok, mode: 'update', row: sheetRow, data: updateData }), {
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    } else {
      // Append new row
      const newRow = new Array(22).fill('');
      newRow[0] = itemId;
      allowedFields.forEach(f => {
        const colLetter = OVERRIDE_COLUMNS[f];
        const colIndex = colLetter.charCodeAt(0) - 65;
        newRow[colIndex] = fields[f];
      });

      const appendRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${OVERRIDE_SHEET_ID}/values/${encodeURIComponent(OVERRIDE_TAB + '!A:V')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [newRow] })
        }
      );
      const appendData = await appendRes.json();
      await env.CACHE.put(`pending-override:${itemId}`, JSON.stringify({ fields }));
      return new Response(JSON.stringify({ ok: appendRes.ok, mode: 'append', data: appendData }), {
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

// ── [22h] handleCardImage — serves scan bytes at a URL ending in .jpg, for eBay's importer ─
export async function handleCardImage(request, env, cors) {
  try {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/card-image\/(.+)-(front|back)\.jpg$/);
    if (!match) {
      return new Response('Not found', { status: 404, headers: cors });
    }
    const [, itemId, side] = match;

    const cacheKey = `scan:${itemId}`;
    let scanData;
    const cached = await env.CACHE.get(cacheKey);
    if (cached) {
      scanData = JSON.parse(cached);
    } else {
      const token = await getGoogleAccessToken(env);
      const q = `name contains '${itemId}' and mimeType contains 'image/' and trashed=false`;
      const driveUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink,parents)&pageSize=10`;
      const driveRes = await fetch(driveUrl, { headers: { Authorization: `Bearer ${token}` } });
      const driveData = await driveRes.json();
      const allFiles = driveData.files || [];

      const COMC_FOLDER_ID = '19S73azDgJwYkqfkMsx6c1nlp2XN5pjT0';
      const isComc = f => (f.parents || []).includes(COMC_FOLDER_ID);
      const nonComcFiles = allFiles.filter(f => !isComc(f));
      const files = nonComcFiles.length > 0 ? nonComcFiles : allFiles;

      const back = files.find(f => /back/i.test(f.name));
      const front = files.find(f => f !== back) || files[0] || null;

      scanData = {
        front: front ? { id: front.id, link: front.webViewLink, thumb: `https://drive.google.com/thumbnail?id=${front.id}&sz=w800`, thumbSm: `https://drive.google.com/thumbnail?id=${front.id}&sz=w200` } : null,
        back: back ? { id: back.id, link: back.webViewLink, thumb: `https://drive.google.com/thumbnail?id=${back.id}&sz=w800`, thumbSm: `https://drive.google.com/thumbnail?id=${back.id}&sz=w200` } : null
      };
      await env.CACHE.put(cacheKey, JSON.stringify(scanData), { expirationTtl: 604800 });
    }

    const fileInfo = scanData[side];
    if (!fileInfo || !fileInfo.id) {
      return new Response('Image not found', { status: 404, headers: cors });
    }

    const token = await getGoogleAccessToken(env);
    const imgRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileInfo.id}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!imgRes.ok) {
      return new Response('Could not fetch image', { status: 502, headers: cors });
    }
    const imageBuffer = await imgRes.arrayBuffer();
    return new Response(imageBuffer, {
      headers: { ...cors, 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' }
    });
  } catch(e) {
    return new Response(`Error: ${e.message}`, { status: 500, headers: cors });
  }
}

// ── [23] getGoogleAccessToken ─────────────────────────────────────────────────
export async function getGoogleAccessToken(env) {
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
export async function importPrivateKey(pem) {
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
