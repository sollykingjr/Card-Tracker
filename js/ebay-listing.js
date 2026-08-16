// ── ebay-listing.js — per-card eBay listing form: open, save, load, remove ──
let ebayQueueCache = {}; // itemId -> saved listing object, hydrated from /ebay-queue-all
let ebayQueueLoaded = false;

async function ebayLoadQueue() {
  if (ebayQueueLoaded) return ebayQueueCache;
  try {
    const res = await fetch(`${WORKER_URL}/ebay-queue-all`);
    if (res.ok) {
      ebayQueueCache = await res.json();
      ebayQueueLoaded = true;
    }
  } catch (e) {}
  return ebayQueueCache;
}

function ebayGuessGraderGrade(gradeText) {
  const t = (gradeText || '').trim();
  if (!t) return { grader: '', grade: '' };
  const m = t.match(/^([A-Za-z]+)\s+([\d.]+)$/);
  if (m) return { grader: m[1], grade: m[2] };
  return { grader: '', grade: t };
}

function ebayBuildDefaultListing(c) {
  const isGraded = !!(c.grade && c.grade.trim());
  const { grader, grade } = ebayGuessGraderGrade(c.grade);
  const autographed = /auto/i.test(c.variation || '') || /auto/i.test(c.version || '');
  return {
    title: c.fullCard || c.playerDisplay || '',
    team: '',
    price: '',
    quantity: 1,
    format: 'FixedPrice',
    allowOffers: false,
    offerAuto: '',
    offerMin: '',
    action: 'draft',
    schedule: '',
    description: 'Please see scan for condition. Please reach out with any questions.',
    condition: 'Excellent',
    sport: c.sport || '',
    player: c.playerDisplay || '',
    manufacturer: '',
    season: c.year || '',
    parallel: c.variation || '',
    set: c.set || '',
    league: '',
    autographed: autographed ? 'Yes' : 'No',
    cardNo: c.cardNo || '',
    printRun: c.serialNo || '',
    grader: isGraded ? grader : '',
    grade: isGraded ? grade : '',
    country: 'United States',
    isGraded
  };
}

function ebayField(label, id, value, opts = {}) {
  const type = opts.type || 'text';
  const safeVal = (value ?? '').toString().replace(/"/g, '&quot;');
  if (type === 'textarea') {
    return `
      <div style="margin-bottom:12px">
        <div style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${label}</div>
        <textarea id="${id}" rows="3" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--bdr2);border-radius:8px;background:var(--surf2);color:var(--tx);font-size:13px;font-family:inherit;resize:vertical">${safeVal}</textarea>
      </div>`;
  }
  if (type === 'select') {
    const options = opts.options.map(o => `<option value="${o}" ${o === value ? 'selected' : ''}>${o}</option>`).join('');
    return `
      <div style="margin-bottom:12px">
        <div style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${label}</div>
        <select id="${id}" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--bdr2);border-radius:8px;background:var(--surf2);color:var(--tx);font-size:13px;font-family:inherit">${options}</select>
      </div>`;
  }
  if (type === 'checkbox') {
    return `
      <div style="margin-bottom:12px;display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="${id}" ${value ? 'checked' : ''} style="width:16px;height:16px" onchange="${opts.onchange || ''}">
        <label for="${id}" style="font-size:13px;color:var(--tx)">${label}</label>
      </div>`;
  }
  return `
    <div style="margin-bottom:12px">
      <div style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${label}</div>
      <input type="${type}" id="${id}" value="${safeVal}" autocomplete="off" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--bdr2);border-radius:8px;background:var(--surf2);color:var(--tx);font-size:13px;font-family:inherit">
    </div>`;
}

function ebayRenderOfferFields(l) {
  if (l.format !== 'FixedPrice') return '';
  return `
    ${ebayField('Allow Offers', 'el-allowOffers', l.allowOffers, { type: 'checkbox', onchange: 'ebayToggleOfferFields()' })}
    <div id="el-offer-fields" style="display:${l.allowOffers ? 'block' : 'none'}">
      ${ebayField('Auto-Accept Price', 'el-offerAuto', l.offerAuto, { type: 'number' })}
      ${ebayField('Minimum Offer Price', 'el-offerMin', l.offerMin, { type: 'number' })}
    </div>`;
}

function ebayToggleOfferFields() {
  const box = document.getElementById('el-allowOffers');
  const fields = document.getElementById('el-offer-fields');
  if (box && fields) fields.style.display = box.checked ? 'block' : 'none';
}

function ebayToggleFormatFields() {
  const format = document.getElementById('el-format').value;
  const offerBlock = document.getElementById('el-offer-block');
  if (!offerBlock) return;
  const current = {
    format,
    allowOffers: document.getElementById('el-allowOffers')?.checked ?? false,
    offerAuto: document.getElementById('el-offerAuto')?.value ?? '',
    offerMin: document.getElementById('el-offerMin')?.value ?? ''
  };
  offerBlock.innerHTML = format === 'FixedPrice' ? ebayRenderOfferFields(current) : '';
}

async function ebayOpenListingForm(itemId) {
  const c = cards.find(x => x.itemId === itemId);
  if (!c) return;

  await ebayLoadQueue();
  const existing = ebayQueueCache[itemId];
  const l = existing || ebayBuildDefaultListing(c);

  const html = `
    <div style="position:sticky;top:0;background:var(--bg);padding:10px 0 8px;z-index:10;margin-bottom:6px">
      <button onclick="document.getElementById('mcontent').innerHTML=_modalMainHtml"
        style="display:flex;align-items:center;gap:6px;background:none;border:none;color:var(--acc);font-size:14px;font-weight:500;cursor:pointer;font-family:inherit;padding:0">
        ← Back
      </button>
    </div>
    <div class="section-hdr">List on eBay</div>
    <div style="margin-top:12px">
      ${ebayField('Title', 'el-title', l.title)}
      ${ebayField('Price', 'el-price', l.price, { type: 'number' })}
      ${ebayField('Quantity', 'el-quantity', l.quantity, { type: 'number' })}
      <div style="margin-bottom:12px">
        <div style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Format</div>
        <select id="el-format" onchange="ebayToggleFormatFields()" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--bdr2);border-radius:8px;background:var(--surf2);color:var(--tx);font-size:13px;font-family:inherit">
          <option value="FixedPrice" ${l.format === 'FixedPrice' ? 'selected' : ''}>FixedPrice</option>
          <option value="Auction" ${l.format === 'Auction' ? 'selected' : ''}>Auction</option>
        </select>
      </div>
      <div id="el-offer-block">${ebayRenderOfferFields(l)}</div>
      ${ebayField('Action', 'el-action', l.action, { type: 'select', options: ['draft', 'live'] })}
      ${ebayField('Schedule (optional)', 'el-schedule', l.schedule, { type: 'datetime-local' })}
      ${ebayField('Description', 'el-description', l.description, { type: 'textarea' })}
      ${!l.isGraded ? ebayField('Card Condition', 'el-condition', l.condition, { type: 'select', options: ['Near mint or better', 'Excellent', 'Very good', 'Poor'] }) : ''}
      ${ebayField('Sport', 'el-sport', l.sport)}
      ${ebayField('Player', 'el-player', l.player)}
      ${ebayField('Team', 'el-team', l.team)}
      ${ebayField('Manufacturer', 'el-manufacturer', l.manufacturer)}
      ${ebayField('Season / Year', 'el-season', l.season)}
      ${ebayField('Parallel / Variety', 'el-parallel', l.parallel)}
      ${ebayField('Set', 'el-set', l.set)}
      ${ebayField('League', 'el-league', l.league)}
      ${ebayField('Autographed', 'el-autographed', l.autographed, { type: 'select', options: ['No', 'Yes'] })}
      ${ebayField('Card Number', 'el-cardNo', l.cardNo)}
      ${ebayField('Print Run (serial /X)', 'el-printRun', l.printRun)}
      ${l.isGraded ? ebayField('Grader', 'el-grader', l.grader) : ''}
      ${l.isGraded ? ebayField('Grade', 'el-grade', l.grade) : ''}
      ${ebayField('Country of Origin', 'el-country', l.country)}
      <input type="hidden" id="el-isGraded" value="${l.isGraded ? '1' : ''}">
      <button onclick="ebaySaveListing('${itemId.replace(/'/g, "\\'")}')"
        style="width:100%;height:44px;border:none;border-radius:10px;background:var(--acc);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:8px">
        Save to Queue
      </button>
    </div>
  `;

  document.getElementById('mcontent').innerHTML = html;
}

async function ebaySaveListing(itemId) {
  const val = id => document.getElementById(id)?.value ?? '';
  const checked = id => document.getElementById(id)?.checked ?? false;
  const isGraded = val('el-isGraded') === '1';

  const listing = {
    itemId,
    title: val('el-title'),
    price: val('el-price'),
    quantity: val('el-quantity') || 1,
    format: val('el-format'),
    allowOffers: checked('el-allowOffers'),
    offerAuto: val('el-offerAuto'),
    offerMin: val('el-offerMin'),
    action: val('el-action'),
    schedule: val('el-schedule'),
    description: val('el-description'),
    condition: isGraded ? '' : val('el-condition'),
    sport: val('el-sport'),
    player: val('el-player'),
    team: val('el-team'),
    manufacturer: val('el-manufacturer'),
    season: val('el-season'),
    parallel: val('el-parallel'),
    set: val('el-set'),
    league: val('el-league'),
    autographed: val('el-autographed'),
    cardNo: val('el-cardNo'),
    printRun: val('el-printRun'),
    grader: isGraded ? val('el-grader') : '',
    grade: isGraded ? val('el-grade') : '',
    country: val('el-country'),
    isGraded
  };

  try {
    await fetch(`${WORKER_URL}/ebay-queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Key': APP_KEY },
      body: JSON.stringify(listing)
    });
    ebayQueueCache[itemId] = listing;
    document.getElementById('mcontent').innerHTML = _modalMainHtml;
  } catch (e) {
    alert('Could not save to queue: ' + e.message);
  }
}

async function ebayRemoveFromQueue(itemId) {
  try {
    await fetch(`${WORKER_URL}/ebay-queue-remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Key': APP_KEY },
      body: JSON.stringify({ itemId })
    });
    delete ebayQueueCache[itemId];
  } catch (e) {}
}
