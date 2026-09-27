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

const EBAY_TCG_GAMES = ['Pokémon', 'Yu-Gi-Oh!', 'Magic: The Gathering', 'Lorcana', 'One Piece', 'Other'];

function ebayBuildDefaultListing(c) {
  const isGraded = !!(c.grade && c.grade.trim());
  const { grader, grade } = ebayGuessGraderGrade(c.grade);
  const autographed = /auto/i.test(c.variation || '') || /auto/i.test(c.version || '');
  return {
    cardType: 'sports',
    game: EBAY_TCG_GAMES[0],
    title: c.fullCard || c.playerDisplay || '',
    team: '',
    price: '',
    quantity: 1,
    format: 'FixedPrice',
    allowOffers: false,
    offerAuto: '',
    offerMin: '',
    action: 'scheduled',
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

// ── Live / Scheduled (eBay allows scheduling up to 3 weeks out) ──
const EBAY_MAX_SCHEDULE_DAYS = 21;

function ebayNormalizeAction(a) {
  return a === 'live' ? 'live' : 'scheduled'; // legacy 'draft' → scheduled (never goes live by accident)
}

function ebayLocalInputValue(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ebayRenderActionFields(l) {
  const action = ebayNormalizeAction(l.action);
  const now = new Date();
  const min = ebayLocalInputValue(new Date(now.getTime() + 5 * 60 * 1000));
  const max = ebayLocalInputValue(new Date(now.getTime() + EBAY_MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000));
  const labelStyle = 'font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px';
  const inputStyle = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--bdr2);border-radius:8px;background:var(--surf2);color:var(--tx);font-size:13px;font-family:inherit';
  return `
    <div style="margin-bottom:12px">
      <div style="${labelStyle}">Action</div>
      <select id="el-action" onchange="ebayToggleScheduleField()" style="${inputStyle}">
        <option value="live" ${action === 'live' ? 'selected' : ''}>Live (list now)</option>
        <option value="scheduled" ${action === 'scheduled' ? 'selected' : ''}>Scheduled</option>
      </select>
    </div>
    <div id="el-schedule-wrap" style="margin-bottom:12px;display:${action === 'scheduled' ? 'block' : 'none'}">
      <div style="${labelStyle}">Start Time (max 3 weeks out)</div>
      <input type="datetime-local" id="el-schedule" value="${l.schedule || ''}" min="${min}" max="${max}" style="${inputStyle}">
    </div>`;
}

function ebayToggleScheduleField() {
  const wrap = document.getElementById('el-schedule-wrap');
  if (wrap) wrap.style.display = document.getElementById('el-action').value === 'scheduled' ? 'block' : 'none';
}

// Returns an error string, or null if the listing's action/schedule is publishable right now.
function ebayScheduleProblem(l) {
  if (ebayNormalizeAction(l.action) !== 'scheduled') return null;
  if (!l.schedule) return 'Scheduled but no start time set';
  const d = new Date(l.schedule); // datetime-local string → local time
  if (isNaN(d.getTime())) return 'Invalid start time';
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return 'Start time is in the past';
  if (diff > EBAY_MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000) return 'Start time is more than 3 weeks out';
  return null;
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
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button type="button" id="el-type-sports" onclick="ebaySetCardType('sports')" style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--bdr2);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;background:${(l.cardType || 'sports') === 'sports' ? 'var(--acc-bg)' : 'var(--surf2)'};color:${(l.cardType || 'sports') === 'sports' ? 'var(--acc)' : 'var(--tx2)'}">Sports Card</button>
        <button type="button" id="el-type-tcg" onclick="ebaySetCardType('tcg')" style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--bdr2);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;background:${l.cardType === 'tcg' ? 'var(--acc-bg)' : 'var(--surf2)'};color:${l.cardType === 'tcg' ? 'var(--acc)' : 'var(--tx2)'}">TCG Card</button>
      </div>
      <input type="hidden" id="el-cardType" value="${l.cardType || 'sports'}">
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
      <div style="margin-bottom:12px">
        <div style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Promote % (optional, blank = none)</div>
        <input type="number" id="el-adRate" value="${l.adRate ?? ''}" min="2" max="100" step="0.1" placeholder="e.g. 2.1" autocomplete="off" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--bdr2);border-radius:8px;background:var(--surf2);color:var(--tx);font-size:13px;font-family:inherit">
      </div>
      ${ebayRenderActionFields(l)}
      ${ebayField('Description', 'el-description', l.description, { type: 'textarea' })}
      ${!l.isGraded ? ebayField('Card Condition', 'el-condition', l.condition, { type: 'select', options: ['Near mint or better', 'Excellent', 'Very good', 'Poor'] }) : ''}
      <div id="el-sports-fields" style="display:${(l.cardType || 'sports') === 'sports' ? 'block' : 'none'}">
        ${ebayField('Sport', 'el-sport', l.sport)}
        ${ebayField('Player', 'el-player', l.player)}
        ${ebayField('Team', 'el-team', l.team)}
        ${ebayField('League', 'el-league', l.league)}
        ${ebayField('Autographed', 'el-autographed', l.autographed, { type: 'select', options: ['No', 'Yes'] })}
      </div>
      <div id="el-tcg-fields" style="display:${l.cardType === 'tcg' ? 'block' : 'none'}">
        ${ebayField('Game', 'el-game', l.game || EBAY_TCG_GAMES[0], { type: 'select', options: EBAY_TCG_GAMES })}
      </div>
      ${ebayField('Manufacturer', 'el-manufacturer', l.manufacturer)}
      ${ebayField('Season / Year', 'el-season', l.season)}
      ${ebayField('Parallel / Variety', 'el-parallel', l.parallel)}
      ${ebayField('Set', 'el-set', l.set)}
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

function ebaySetCardType(type) {
  document.getElementById('el-cardType').value = type;
  document.getElementById('el-sports-fields').style.display = type === 'sports' ? 'block' : 'none';
  document.getElementById('el-tcg-fields').style.display = type === 'tcg' ? 'block' : 'none';
  const sportsBtn = document.getElementById('el-type-sports');
  const tcgBtn = document.getElementById('el-type-tcg');
  sportsBtn.style.background = type === 'sports' ? 'var(--acc-bg)' : 'var(--surf2)';
  sportsBtn.style.color = type === 'sports' ? 'var(--acc)' : 'var(--tx2)';
  tcgBtn.style.background = type === 'tcg' ? 'var(--acc-bg)' : 'var(--surf2)';
  tcgBtn.style.color = type === 'tcg' ? 'var(--acc)' : 'var(--tx2)';
}

async function ebaySaveListing(itemId) {
  const val = id => document.getElementById(id)?.value ?? '';
  const checked = id => document.getElementById(id)?.checked ?? false;
  const isGraded = val('el-isGraded') === '1';

  const cardType = val('el-cardType') || 'sports';

  const listing = {
    itemId,
    cardType,
    game: cardType === 'tcg' ? val('el-game') : '',
    title: val('el-title'),
    price: val('el-price'),
    quantity: val('el-quantity') || 1,
    format: val('el-format'),
    allowOffers: checked('el-allowOffers'),
    offerAuto: val('el-offerAuto'),
    offerMin: val('el-offerMin'),
    adRate: val('el-adRate').trim(),
    action: ebayNormalizeAction(val('el-action')),
    schedule: val('el-action') === 'scheduled' ? val('el-schedule') : '',
    description: val('el-description'),
    condition: isGraded ? '' : val('el-condition'),
    sport: cardType === 'sports' ? val('el-sport') : '',
    player: cardType === 'sports' ? val('el-player') : '',
    team: cardType === 'sports' ? val('el-team') : '',
    manufacturer: val('el-manufacturer'),
    season: val('el-season'),
    parallel: val('el-parallel'),
    set: val('el-set'),
    league: cardType === 'sports' ? val('el-league') : '',
    autographed: cardType === 'sports' ? val('el-autographed') : '',
    cardNo: val('el-cardNo'),
    printRun: val('el-printRun'),
    grader: isGraded ? val('el-grader') : '',
    grade: isGraded ? val('el-grade') : '',
    country: val('el-country'),
    isGraded
  };

  const schedProblem = ebayScheduleProblem(listing);
  if (schedProblem) { alert(schedProblem); return; }
  if (listing.adRate !== '') {
    const r = parseFloat(listing.adRate);
    if (isNaN(r) || r < 2 || r > 100) { alert('Promote % must be between 2 and 100 (or blank).'); return; }
  }

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
    const action = ebayNormalizeAction(l.action);
    const when = action === 'live' ? 'Live' : (l.schedule ? `Scheduled ${new Date(l.schedule).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Scheduled (no time set)');
    const safeId = itemId.replace(/[^A-Za-z0-9_-]/g, '_');
    return `
      <div class="recent-row" style="align-items:center">
        <div class="recent-info">
          <div class="rc-name">${title}</div>
          <div class="rc-date">${price} · ${l.format || 'FixedPrice'} · ${when}${l.adRate ? ` · Promoted ${l.adRate}%` : ''}</div>
          <div id="el-pub-status-${safeId}" style="font-size:12px;margin-top:2px"></div>
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
    <button id="ebay-publish-btn" onclick="ebayPublishQueue()" style="width:100%;height:44px;border:none;border-radius:10px;background:var(--acc);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:12px">Publish to eBay</button>
    <button id="ebay-export-btn" onclick="ebayExportQueue()" style="width:100%;height:40px;border:1px solid var(--bdr2);border-radius:10px;background:var(--surf2);color:var(--tx2);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:8px">Export CSV instead</button>
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

const EBAY_CSV_HEADERS = ["*Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)","CustomLabel","*Category","StoreCategory","*Title","Subtitle","Relationship","RelationshipDetails","ScheduleTime","*ConditionID","CD:Professional Grader - (ID: 27501)","CD:Grade - (ID: 27502)","CDA:Certification Number - (ID: 27503)","CD:Card Condition - (ID: 40001)","*C:Sport","C:Player/Athlete","C:Manufacturer","C:Season","C:Parallel/Variety","C:Features","C:Set","C:Team","C:League","C:Autographed","C:Card Name","C:Card Number","C:Type","C:Year Manufactured","C:Signed By","C:Autograph Authentication","C:Card Size","C:Country of Origin","C:Material","C:Event/Tournament","C:Autograph Format","C:Vintage","C:Language","C:Original/Licensed Reprint","C:Autograph Authentication Number","C:California Prop 65 Warning","C:Card Thickness","C:Customized","C:Insert Set","C:Print Run","*C:Game","C:Character","C:Card Type","C:Age Level","C:Speciality","C:Rarity","C:Finish","C:Attribute/MTG:Color","C:Creature/Monster Type","C:Stage","C:Convention/Event","C:Franchise","C:Illustrator","C:HP","C:Attack/Power","C:Defense/Toughness","C:Cost","PicURL","GalleryType","VideoID","*Description","*Format","*Duration","*StartPrice","BuyItNowPrice","BestOfferEnabled","BestOfferAutoAcceptPrice","MinimumBestOfferPrice","*Quantity","ImmediatePayRequired","*Location","ShippingType","ShippingService-1:Option","ShippingService-1:Cost","ShippingService-2:Option","ShippingService-2:Cost","*DispatchTimeMax","PromotionalShippingDiscount","ShippingDiscountProfileID","*ReturnsAcceptedOption","ReturnsWithinOption","RefundOption","ShippingCostPaidByOption","AdditionalDetails","ShippingProfileName","ReturnProfileName","PaymentProfileName","Product Safety Pictograms","Product Safety Statements","Product Safety Component","Regulatory Document Ids","Manufacturer Name","Manufacturer AddressLine1","Manufacturer AddressLine2","Manufacturer City","Manufacturer Country","Manufacturer PostalCode","Manufacturer StateOrProvince","Manufacturer Phone","Manufacturer Email","Manufacturer ContactURL","Responsible Person 1","Responsible Person 1 Type","Responsible Person 1 AddressLine1","Responsible Person 1 AddressLine2","Responsible Person 1 City","Responsible Person 1 Country","Responsible Person 1 PostalCode","Responsible Person 1 StateOrProvince","Responsible Person 1 Phone","Responsible Person 1 Email","Responsible Person 1 ContactURL"];

const EBAY_CONDITION_MAP = {
  'Near mint or better': 'Near mint or better - (ID: 400010)',
  'Excellent': 'Excellent - (ID: 400011)',
  'Very good': 'Very good - (ID: 400012)',
  'Poor': 'Poor - (ID: 400013)'
};

const EBAY_MANUAL_SHIPPING_COSTS = {
  'PWE - Not Flat Rate - (ID: 254806132017)': { cost: '1.25', service: 'US_eBayStandardEnvelope' },
  'Calculated Bubble Mailers - (ID: 239080494017)': { cost: '5.85', service: 'USPSParcel' }
};

function ebayCsvEscape(val) {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function ebayBuildCsvRowMap(itemId, l, shippingChoice) {
  const isSports = (l.cardType || 'sports') === 'sports';
  const map = {};
  const set = (header, val) => { if (val !== '' && val !== undefined && val !== null) map[header] = val; };

  set('*Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)', 'Add');
  set('CustomLabel', itemId);
  set('*Category', isSports ? '261328' : '183454');
  set('*Title', l.title);
  if (ebayNormalizeAction(l.action) === 'scheduled' && l.schedule) {
    const d = new Date(l.schedule);
    if (!isNaN(d.getTime())) set('ScheduleTime', d.toISOString());
  }
  set('*ConditionID', l.isGraded ? '2750' : '4000');
  if (l.isGraded) {
    set('CD:Professional Grader - (ID: 27501)', l.grader);
    set('CD:Grade - (ID: 27502)', l.grade);
  } else {
    set('CD:Card Condition - (ID: 40001)', EBAY_CONDITION_MAP[l.condition] || l.condition);
  }
  if (isSports) {
    set('*C:Sport', l.sport);
    set('C:Player/Athlete', l.player);
    set('C:Team', l.team);
    set('C:League', l.league);
    set('C:Autographed', l.autographed);
  } else {
    set('*C:Game', l.game);
  }
  set('C:Manufacturer', l.manufacturer);
  set('C:Season', l.season);
  set('C:Parallel/Variety', l.parallel);
  if (l.printRun) set('C:Features', 'Serial Numbered');
  set('C:Set', l.set);
  set('C:Card Number', l.cardNo);
  set('C:Year Manufactured', l.season);
  set('C:Country of Origin', l.country);
  set('C:Print Run', l.printRun);
  set('PicURL', `https://card-app.maxcsolomon.workers.dev/card-image/${itemId}-front.jpg|https://card-app.maxcsolomon.workers.dev/card-image/${itemId}-back.jpg`);
  set('*Description', l.description);
  set('*Format', l.format);
  set('*Duration', l.format === 'Auction' ? '7' : 'GTC');
  set('*StartPrice', l.price);
  if (l.format === 'FixedPrice' && l.allowOffers) {
    set('BestOfferEnabled', 'true');
    set('BestOfferAutoAcceptPrice', l.offerAuto);
    set('MinimumBestOfferPrice', l.offerMin);
  }
  set('*Quantity', l.quantity || 1);
  set('*Location', '10022');
  set('*DispatchTimeMax', '1');

  const manualShip = EBAY_MANUAL_SHIPPING_COSTS[shippingChoice];
  if (manualShip) {
    set('ShippingType', 'Flat');
    set('ShippingService-1:Option', manualShip.service);
    set('ShippingService-1:Cost', manualShip.cost);
  } else {
    set('ShippingProfileName', shippingChoice);
  }
  set('ReturnProfileName', 'Mascot - No returns accepted - (ID: 238602691017)');
  set('PaymentProfileName', 'eBay Managed Payments BIN - (ID: 239080495017)');

  return map;
}

function ebayBuildCsvLine(map) {
  return EBAY_CSV_HEADERS.map(h => ebayCsvEscape(map[h] || '')).join(',');
}

function ebayShippingPolicyId(choice) {
  const m = (choice || '').match(/\(ID:\s*(\d+)\)/);
  return m ? m[1] : '';
}

function ebaySetPubStatus(itemId, text, color) {
  const el = document.getElementById(`el-pub-status-${itemId.replace(/[^A-Za-z0-9_-]/g, '_')}`);
  if (el) { el.textContent = text; el.style.color = color; }
}

async function ebayPublishQueue() {
  const entries = Object.entries(ebayQueueCache);
  if (!entries.length) { alert('Queue is empty.'); return; }

  const shippingChoice = document.getElementById('el-export-shipping')?.value;
  const shippingPolicyId = ebayShippingPolicyId(shippingChoice);
  if (!shippingPolicyId) { alert('Pick a shipping policy first.'); return; }
  localStorage.setItem('ebayShippingPolicy', shippingChoice);

  // Catch bad schedules before anything is sent to eBay.
  const problems = entries
    .map(([id, l]) => [id, l, ebayScheduleProblem(l)])
    .filter(([, , p]) => p);
  if (problems.length) {
    problems.forEach(([id, , p]) => ebaySetPubStatus(id, `⚠ ${p} — edit before publishing`, 'var(--dn)'));
    alert(`${problems.length} card(s) need a valid start time (within 3 weeks). Nothing was published.`);
    return;
  }

  const liveCount = entries.filter(([, l]) => ebayNormalizeAction(l.action) === 'live').length;
  const schedCount = entries.length - liveCount;
  if (!confirm(`Publish ${entries.length} card(s) to eBay?\n\n${liveCount} live now · ${schedCount} scheduled`)) return;

  const btn = document.getElementById('ebay-publish-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Publishing...'; }

  let ok = 0, failed = 0;
  const failures = {}; // itemId -> error text, re-shown after the list refreshes
  const promoNotes = [];
  for (const [itemId, l] of entries) {
    ebaySetPubStatus(itemId, 'Publishing…', 'var(--tx3)');
    const mode = ebayNormalizeAction(l.action);
    try {
      const res = await fetch(`${WORKER_URL}/ebay-publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-App-Key': APP_KEY },
        body: JSON.stringify({
          itemId,
          shippingPolicyId,
          mode,
          startDate: mode === 'scheduled' ? new Date(l.schedule).toISOString() : undefined
        })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        ok++;
        let msg = mode === 'live' ? `✓ Listed (#${data.listingId})` : `✓ Scheduled (#${data.listingId})`;
        let color = 'var(--up)';
        if (data.promo && data.promo.ok) msg += ` · promoted ${data.promo.rate}%`;
        else if (data.promo && data.promo.error) {
          const why = data.promo.error.message || data.promo.error;
          msg += ` · ⚠ not promoted: ${why}`; color = 'var(--tx2)';
          promoNotes.push(`${l.title || itemId}: not promoted — ${why}`);
        }
        ebaySetPubStatus(itemId, msg, color);
        await ebayRemoveFromQueue(itemId);
      } else {
        failed++;
        const err = data.error;
        const msg = typeof err === 'string' ? err : (err && `${err.step}: ${err.message}`) || `HTTP ${res.status}`;
        failures[itemId] = `✗ ${msg}`;
        ebaySetPubStatus(itemId, failures[itemId], 'var(--dn)');
      }
    } catch (e) {
      failed++;
      failures[itemId] = `✗ ${e.message}`;
      ebaySetPubStatus(itemId, failures[itemId], 'var(--dn)');
    }
  }

  // Published cards are already out of the saved queue — redraw so only failures remain.
  _modalMainHtml = ebayRenderQueueListHtml();
  document.getElementById('mcontent').innerHTML = _modalMainHtml;
  for (const [id, text] of Object.entries(failures)) ebaySetPubStatus(id, text, 'var(--dn)');

  const summary = document.createElement('div');
  summary.style.cssText = 'font-size:13px;margin:10px 0 4px;line-height:1.5';
  summary.innerHTML = `<div style="color:var(--up);font-weight:700">✓ ${ok} published${failed ? `<span style="color:var(--dn)"> · ✗ ${failed} failed (still queued)</span>` : ''}</div>`
    + promoNotes.map(n => `<div style="color:var(--tx2)">⚠ ${n.replace(/</g, '&lt;')}</div>`).join('');
  const hdr = document.querySelector('#mcontent .section-hdr');
  if (hdr) hdr.after(summary);
}

async function ebayExportQueue() {
  const entries = Object.entries(ebayQueueCache);
  if (!entries.length) { alert('Queue is empty.'); return; }

  const shippingChoice = document.getElementById('el-export-shipping')?.value;
  if (shippingChoice) localStorage.setItem('ebayShippingPolicy', shippingChoice);

  const btn = document.getElementById('ebay-export-btn');
  if (btn) { btn.textContent = 'Building file...'; btn.disabled = true; }

  try {
    const lines = [];
    lines.push('Info,Version=1.0.0,Template=fx_category_template_EBAY_US');
    lines.push(EBAY_CSV_HEADERS.map(ebayCsvEscape).join(','));
    for (const [itemId, l] of entries) {
      const map = ebayBuildCsvRowMap(itemId, l, shippingChoice);
      lines.push(ebayBuildCsvLine(map));
    }
    const csvText = lines.join('\r\n');

    const blob = new Blob(['\uFEFF' + csvText], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ebay-listings-${new Date().toISOString().slice(0, 10)}.csv`;
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
