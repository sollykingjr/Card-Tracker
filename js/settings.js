// ── settings.js — Settings tab ──────────────────────────────────────────────────

function settingsFmtDate(iso) {
  if (!iso) return 'never';
  const d = new Date(iso);
  return isNaN(d) ? 'never' : d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function renderSettings() {
  const root = document.getElementById('settings-root');
  if (!root) return;
  if (typeof ctHydrateScanIndex === 'function') ctHydrateScanIndex();
  const idx = (typeof ctScanIndex !== 'undefined' && ctScanIndex) || {};
  const counts = idx.counts;
  root.innerHTML = `
    <div style="max-width:640px;margin:0 auto;padding:16px">
      <div class="mname" style="font-size:20px;margin-bottom:16px">Settings</div>
      <div class="srow" style="margin:0 0 16px">
        <div style="font-size:15px;font-weight:700;color:var(--tx);margin-bottom:4px">Card photos</div>
        <div style="font-size:13px;color:var(--tx2);line-height:1.5;margin-bottom:12px">
          Rebuilds the photo list for every card from Google Drive: picks up new scans and replaces COMC images
          with your own scans wherever you have one. Photos only change when you run this
          (or ⋮ → Refresh Scans on a single card).
        </div>
        <div id="settings-photo-status" style="font-size:12px;color:var(--tx3);margin-bottom:12px">
          Last refreshed: ${settingsFmtDate(idx.builtAt || idx.version)}${counts ? ` · ${counts.withPhoto} of ${counts.cards} cards have photos (${counts.own} your scans, ${counts.comc} COMC, ${counts.missing} none)` : ''}
        </div>
        <button id="settings-photo-btn" onclick="settingsRefreshPhotos()" style="width:100%;height:44px;border:none;border-radius:10px;background:var(--acc);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Refresh all photos</button>
      </div>
    </div>`;
}

async function settingsRefreshPhotos() {
  const btn = document.getElementById('settings-photo-btn');
  const status = document.getElementById('settings-photo-status');
  const ids = (typeof cards !== 'undefined' ? cards : []).map(c => c.itemId).filter(Boolean);
  if (!ids.length) { if (status) status.textContent = 'Card list is still loading — try again in a moment.'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Refreshing photos…'; btn.style.opacity = '.6'; }
  if (status) status.textContent = `Scanning Google Drive for ${ids.length} cards…`;
  try {
    const res = await fetch(`${WORKER_URL}/scan-index-rebuild`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Key': APP_KEY },
      body: JSON.stringify({ itemIds: ids })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    await ctLoadScanIndex(true); // download the new index to this device
    const c = data.counts;
    if (status) {
      status.style.color = 'var(--up)';
      status.textContent = `✓ Done in ${(data.ms / 1000).toFixed(1)}s · ${c.withPhoto} of ${c.cards} cards have photos (${c.own} your scans, ${c.comc} COMC, ${c.missing} none)${c.changed != null ? ` · ${c.changed} changed` : ''} · ${c.images} images in Drive`;
    }
  } catch (e) {
    if (status) { status.style.color = 'var(--dn)'; status.textContent = `Couldn't refresh photos: ${e.message}`; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Refresh all photos'; btn.style.opacity = '1'; }
  }
}
