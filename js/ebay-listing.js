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
    printRun: c.qtyManufactured || '',
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

function ebayRenderQueueListHtml() {
  const entries = Object.entries(ebayQueueCache);
  if (!entries.length) {
    return `
      <div class="section-hdr">eBay Queue</div>
      <div class="empty-msg" style="margin-top:12px">No cards queued yet.</div>
    `;
  }
  const rows = entries.map(([itemId, l]) => {
    const c = cards.find(x => x.itemId === itemId);
    const title = l.title || (c ? c.fullCard : itemId);
    const price = l.price ? `$${parseFloat(l.price).toFixed(2)}` : '—';
    return `
      <div class="recent-row" style="align-items:center">
        <div class="recent-info">
          <div class="rc-name">${title}</div>
          <div class="rc-date">${price} · ${l.format || 'FixedPrice'}</div>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0">
          <button onclick="ebayEditFromQueue('${itemId.replace(/'/g, "\\'")}')" style="padding:6px 10px;font-size:11px;border:1px solid var(--acc-bdr);border-radius:8px;background:var(--acc-bg);color:var(--acc);font-weight:700;cursor:pointer;font-family:inherit">Edit</button>
          <button onclick="ebayRemoveFromQueueUI('${itemId.replace(/'/g, "\\'")}')" style="padding:6px 10px;font-size:11px;border:1px solid var(--bdr2);border-radius:8px;background:var(--surf2);color:var(--tx2);font-weight:700;cursor:pointer;font-family:inherit">Remove</button>
        </div>
      </div>`;
  }).join('');

  const SHIPPING_OPTIONS = [
    'PWE - Not Flat Rate - (ID: 254806132017)',
    'Calculated Bubble Mailers - (ID: 239080494017)',
    'PWE Free Shipping - (ID: 251924633017)'
  ];
  const lastShipping = localStorage.getItem('ebayShippingPolicy') || SHIPPING_OPTIONS[0];
  const shippingOptionsHtml = SHIPPING_OPTIONS.map(o => `<option value="${o}" ${o === lastShipping ? 'selected' : ''}>${o}</option>`).join('');

  return `
    <div class="section-hdr">eBay Queue (${entries.length})</div>
    <div style="margin-top:12px">${rows}</div>
    <div style="margin-top:16px">
      <div style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Shipping Policy (this export)</div>
      <select id="el-export-shipping" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--bdr2);border-radius:8px;background:var(--surf2);color:var(--tx);font-size:13px;font-family:inherit">${shippingOptionsHtml}</select>
    </div>
    <button id="ebay-export-btn" onclick="ebayExportQueue()" style="width:100%;height:44px;border:none;border-radius:10px;background:var(--acc);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:12px">Export Queue</button>
  `;
}

async function ebayOpenQueueModal() {
  await ebayLoadQueue();
  _modalMainHtml = ebayRenderQueueListHtml();
  document.getElementById('mcontent').innerHTML = _modalMainHtml;
  document.getElementById('mwrap').classList.add('on');
}

function ebayEditFromQueue(itemId) {
  _modalMainHtml = ebayRenderQueueListHtml();
  ebayOpenListingForm(itemId);
}

async function ebayRemoveFromQueueUI(itemId) {
  await ebayRemoveFromQueue(itemId);
  _modalMainHtml = ebayRenderQueueListHtml();
  document.getElementById('mcontent').innerHTML = _modalMainHtml;
}

const EBAY_GRADER_MAP = {
  PSA: 'Professional Sports Authenticator (PSA) - (ID: 275010)',
  BCCG: 'Beckett Collectors Club Grading (BCCG) - (ID: 275011)',
  BVG: 'Beckett Vintage Grading (BVG) - (ID: 275012)',
  BGS: 'Beckett Grading Services (BGS) - (ID: 275013)',
  CSG: 'Certified Sports Guaranty (CSG) - (ID: 275014)',
  CGC: 'Certified Guaranty Company (CGC) - (ID: 275015)',
  SGC: 'Sportscard Guaranty Corporation (SGC) - (ID: 275016)',
  KSA: 'K Sportscard Authentication (KSA) - (ID: 275017)',
  GMA: 'Gem Mint Authentication (GMA) - (ID: 275018)',
  HGA: 'Hybrid Grading Approach (HGA) - (ID: 275019)',
};
const EBAY_GRADE_MAP = {
  '10': '10 - (ID: 275020)', '9.5': '9.5 - (ID: 275021)', '9': '9 - (ID: 275022)',
  '8.5': '8.5 - (ID: 275023)', '8': '8 - (ID: 275024)', '7.5': '7.5 - (ID: 275025)',
  '7': '7 - (ID: 275026)', '6.5': '6.5 - (ID: 275027)', '6': '6 - (ID: 275028)',
  '5.5': '5.5 - (ID: 275029)', '5': '5 - (ID: 2750210)', '4.5': '4.5 - (ID: 2750211)',
  '4': '4 - (ID: 2750212)', '3.5': '3.5 - (ID: 2750213)', '3': '3 - (ID: 2750214)',
  '2.5': '2.5 - (ID: 2750215)', '2': '2 - (ID: 2750216)', '1.5': '1.5 - (ID: 2750217)',
  '1': '1 - (ID: 2750218)', 'Authentic': 'Authentic - (ID: 2750219)'
};
const EBAY_CONDITION_MAP = {
  'Near mint or better': 'Near mint or better - (ID: 400010)',
  'Excellent': 'Excellent - (ID: 400011)',
  'Very good': 'Very good - (ID: 400012)',
  'Poor': 'Poor - (ID: 400013)'
};

function ebayColIdx(col) {
  let idx = 0;
  for (let i = 0; i < col.length; i++) idx = idx * 26 + (col.charCodeAt(i) - 64);
  return idx;
}

function ebayEscapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function ebayBuildRowValues(itemId, l, shippingPolicy) {
  const values = {};
  const set = (col, kind, val) => { if (val !== '' && val !== undefined && val !== null) values[col] = [kind, val]; };

  set('A', 'str', l.action === 'live' ? 'Add' : 'Draft');
  set('B', 'str', itemId);
  set('C', 'num', 261328);
  set('E', 'str', '/Sports Mem, Cards & Fan Shop/Sports Trading Cards/Trading Card Singles');
  set('F', 'str', l.title);
  set('K', 'num', l.price);
  set('L', 'num', l.quantity || 1);
  set('M', 'str', `https://card-app.maxcsolomon.workers.dev/card-image/${itemId}-front.jpg|https://card-app.maxcsolomon.workers.dev/card-image/${itemId}-back.jpg`);
  set('O', 'num', l.isGraded ? 2750 : 4000);
  if (l.isGraded) {
    set('P', 'str', EBAY_GRADER_MAP[(l.grader || '').toUpperCase()] || l.grader);
    set('Q', 'str', EBAY_GRADE_MAP[l.grade] || l.grade);
  } else {
    set('S', 'str', EBAY_CONDITION_MAP[l.condition] || l.condition);
  }
  set('T', 'str', l.description);
  set('U', 'str', l.format);
  set('V', 'str', l.format === 'Auction' ? '7' : 'GTC');
  if (l.action === 'live' && l.schedule) set('H', 'str', l.schedule);
  if (l.format === 'FixedPrice' && l.allowOffers) {
    set('X', 'str', 'true');
    set('Y', 'num', l.offerAuto);
    set('Z', 'num', l.offerMin);
  }
  set('AB', 'str', '10022');
  set('AI', 'num', 1);
  set('AN', 'str', shippingPolicy);
  set('AO', 'str', 'Mascot - No returns accepted - (ID: 238602691017)');
  set('AP', 'str', 'eBay Managed Payments BIN - (ID: 239080495017)');
  set('AQ', 'str', l.sport);
  set('AR', 'str', l.player);
  set('AS', 'str', l.manufacturer);
  set('AT', 'str', l.season);
  set('AU', 'str', l.parallel);
  if (l.printRun) set('AV', 'str', 'Serial Numbered');
  set('AW', 'str', l.set);
  set('AX', 'str', l.team);
  set('AY', 'str', l.league);
  set('AZ', 'str', l.autographed);
  set('BB', 'str', l.cardNo);
  set('BD', 'str', l.season);
  set('BT', 'str', l.printRun);

  return values;
}

async function ebayExportQueue() {
  const entries = Object.entries(ebayQueueCache);
  if (!entries.length) { alert('Queue is empty.'); return; }

  const shippingPolicy = document.getElementById('el-export-shipping')?.value;
  if (shippingPolicy) localStorage.setItem('ebayShippingPolicy', shippingPolicy);

  const btn = document.getElementById('ebay-export-btn');
  if (btn) { btn.textContent = 'Building file...'; btn.disabled = true; }

  try {
    const templateRes = await fetch('assets/ebay-template.xlsm');
    const templateBuf = await templateRes.arrayBuffer();
    const zip = await JSZip.loadAsync(templateBuf);

    const sheetPath = 'xl/worksheets/sheet20.xml';
    let sheetXml = await zip.file(sheetPath).async('string');

    let rowNum = 5;
    let newRowsXml = '';
    for (const [itemId, l] of entries) {
      const values = ebayBuildRowValues(itemId, l, shippingPolicy);
      const sortedCols = Object.keys(values).sort((a, b) => ebayColIdx(a) - ebayColIdx(b));
      const cellsXml = sortedCols.map(col => {
        const [kind, val] = values[col];
        if (kind === 'num') return `<c r="${col}${rowNum}"><v>${val}</v></c>`;
        return `<c r="${col}${rowNum}" t="inlineStr"><is><t xml:space="preserve">${ebayEscapeXml(val)}</t></is></c>`;
      }).join('');
      newRowsXml += `<row r="${rowNum}">${cellsXml}</row>`;
      rowNum++;
    }

    const finalRow = rowNum - 1;
    sheetXml = sheetXml.replace(/<dimension ref="A1:CS4"\s*\/>/, `<dimension ref="A1:CS${finalRow}"/>`);
    sheetXml = sheetXml.replace('</sheetData>', newRowsXml + '</sheetData>');

    zip.file(sheetPath, sheetXml);

    const outBlob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12' });

    const url = URL.createObjectURL(outBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ebay-listings-${new Date().toISOString().slice(0, 10)}.xlsm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Export failed: ' + e.message);
  } finally {
    if (btn) { btn.textContent = 'Export Queue'; btn.disabled = false; }
  }
}
