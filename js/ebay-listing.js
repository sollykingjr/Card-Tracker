// ── ebay-listing.js — per-card eBay listing: form → review (with checks) → publish ──
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
    allowOffers: true,
    offerAuto: '',
    offerMin: '',
    action: 'scheduled',
    schedule: ebayLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)), // default: 1 hour from now
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

// ── Shipping policies (business policy IDs) ──
const EBAY_SHIPPING_OPTIONS = [
  { id: '254806132017', label: 'PWE - Not Flat Rate' },
  { id: '239080494017', label: 'Calculated Bubble Mailers' },
  { id: '251924633017', label: 'PWE Free Shipping' }
];

function ebayShippingLabel(id) {
  const o = EBAY_SHIPPING_OPTIONS.find(x => x.id === id);
  return o ? o.label : id;
}

function ebayDefaultShippingId() {
  let saved = '';
  try { saved = localStorage.getItem('ebayShippingPolicyId') || ''; } catch (e) {}
  return EBAY_SHIPPING_OPTIONS.some(o => o.id === saved) ? saved : EBAY_SHIPPING_OPTIONS[0].id;
}

// Grader/grade names eBay recognizes (mirrors worker/ebay-publish.js).
const EBAY_GRADERS = ['PSA', 'BCCG', 'BVG', 'BGS', 'CSG', 'CGC', 'SGC', 'KSA', 'GMA', 'HGA', 'ISA', 'PCA', 'GSG', 'PGS', 'MNT', 'TAG', 'RCG', 'PCG', 'ACE', 'CGA', 'TCG', 'ARK', 'OTHER'];
const EBAY_GRADES = ['10', '9.5', '9', '8.5', '8', '7.5', '7', '6.5', '6', '5.5', '5', '4.5', '4', '3.5', '3', '2.5', '2', '1.5', '1', 'AUTHENTIC'];

function ebayEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ebayMoney(v) {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}

// In-memory draft so "Back to Edit" keeps everything typed. Nothing is saved server-side.
let ebayDraft = null; // { itemId, listing }
let ebayScanState = { front: 'loading', back: 'loading' };
let ebayLiveState = { state: 'loading' }; // live eBay check: active | scheduled | none | unknown

// Swap the modal to a new screen and start it at the top. Without the reset the Review
// page opens scrolled to where the (longer) form was, and iOS Safari can lock the
// scroll area when its content is replaced while scrolled past the new bottom.
function ebayShowScreen(html) {
  const content = document.getElementById('mcontent');
  const scroller = content.closest('.modal') || content.parentElement;
  content.innerHTML = html;
  if (scroller) {
    scroller.scrollTop = 0;
    // Nudge iOS to re-measure the scroll area on the next frame.
    requestAnimationFrame(() => { scroller.style.overflowY = 'hidden'; void scroller.offsetHeight; scroller.style.overflowY = ''; scroller.scrollTop = 0; });
  }
}

// ── 1) Form ──
async function ebayOpenListingForm(itemId, keepDraft) {
  const c = cards.find(x => x.itemId === itemId);
  if (!c) return;
  const l = (keepDraft && ebayDraft && ebayDraft.itemId === itemId) ? ebayDraft.listing : ebayBuildDefaultListing(c);
  if (!l.shippingPolicyId) l.shippingPolicyId = ebayDefaultShippingId();

  const shipOptions = EBAY_SHIPPING_OPTIONS
    .map(o => `<option value="${o.id}" ${o.id === l.shippingPolicyId ? 'selected' : ''}>${o.label}</option>`).join('');

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
      <div style="margin-bottom:12px">
        <div style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Shipping Policy</div>
        <select id="el-shipping" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--bdr2);border-radius:8px;background:var(--surf2);color:var(--tx);font-size:13px;font-family:inherit">${shipOptions}</select>
      </div>
      <input type="hidden" id="el-isGraded" value="${l.isGraded ? '1' : ''}">
      <button onclick="ebayReviewListing('${itemId.replace(/'/g, "\\'")}')"
        style="width:100%;height:44px;border:none;border-radius:10px;background:var(--acc);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:8px">
        Review
      </button>
    </div>
  `;

  ebayShowScreen(html);
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

function ebayCollectForm(itemId) {
  const val = id => document.getElementById(id)?.value ?? '';
  const checked = id => document.getElementById(id)?.checked ?? false;
  const isGraded = val('el-isGraded') === '1';
  const cardType = val('el-cardType') || 'sports';
  return {
    itemId,
    cardType,
    game: cardType === 'tcg' ? val('el-game') : '',
    title: val('el-title').trim(),
    price: val('el-price'),
    quantity: val('el-quantity') || 1,
    format: val('el-format'),
    allowOffers: val('el-format') === 'FixedPrice' && checked('el-allowOffers'),
    offerAuto: val('el-offerAuto'),
    offerMin: val('el-offerMin'),
    adRate: val('el-adRate').trim(),
    action: ebayNormalizeAction(val('el-action')),
    schedule: val('el-action') === 'scheduled' ? val('el-schedule') : '',
    shippingPolicyId: val('el-shipping'),
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
}

// ── 2) Checks ── blocks stop publishing; warnings can be published past.
function ebayRunChecks(itemId, l) {
  const blocks = [], warns = [];
  const c = cards.find(x => x.itemId === itemId) || {};

  const tags = typeof ctGetTags === 'function' ? ctGetTags(c) : [];
  if (tags.includes('Sold')) blocks.push('This card is tagged Sold');

  // Live eBay check is the source of truth for listed/scheduled (tags can lag 15 min).
  const live = ebayLiveState;
  const fmtStart = t => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  if (live.state === 'scheduled') blocks.push(`Already scheduled on eBay${live.startTime ? ` — starts ${fmtStart(live.startTime)}` : ''}${live.listingId ? ` (#${live.listingId})` : ''}`);
  else if (live.state === 'active') blocks.push(`Already live on eBay${live.listingId ? ` (#${live.listingId})` : ''}`);
  else if (live.state === 'unknown') blocks.push(`Couldn't check eBay for an existing listing${live.error ? ` (${live.error})` : ''} — go back and review again`);
  else if (live.state === 'none' && tags.includes('Listed') && !tags.includes('Sold')) warns.push('Tagged Listed, but not live or scheduled on eBay — OK to repost (tag clears on next sync)');

  const price = ebayMoney(l.price);
  if (price === null || price <= 0) blocks.push('Price is missing');
  if (!l.title) blocks.push('Title is missing');
  else if (l.title.length > 80) warns.push(`Title is ${l.title.length} characters — eBay will cut it to 80`);

  if (!l.shippingPolicyId) blocks.push('Shipping policy is missing');

  const sched = ebayScheduleProblem(l);
  if (sched) blocks.push(sched);

  if (l.adRate !== '' && l.adRate !== undefined) {
    const r = parseFloat(l.adRate);
    if (isNaN(r) || r < 2 || r > 100) blocks.push('Promote % must be between 2 and 100 (or blank)');
  }

  if (l.isGraded) {
    if (!EBAY_GRADERS.includes((l.grader || '').trim().toUpperCase())) blocks.push(`Grader "${l.grader || ''}" isn't one eBay recognizes (e.g. PSA, BGS, SGC, CGC)`);
    if (!EBAY_GRADES.includes((l.grade || '').trim().toUpperCase())) blocks.push(`Grade "${l.grade || ''}" isn't one eBay recognizes (e.g. 10, 9.5, 9)`);
  }

  if (ebayScanState.front === 'missing') blocks.push('Front scan is missing');
  if (ebayScanState.back === 'missing') warns.push('Back scan is missing — will list with the front only');

  const cost = ebayMoney(c.purchasePrice);
  if (price !== null && cost !== null && cost > 0 && price < cost) warns.push(`Price $${price.toFixed(2)} is below what you paid ($${cost.toFixed(2)})`);

  if (l.allowOffers && price !== null) {
    const auto = ebayMoney(l.offerAuto), min = ebayMoney(l.offerMin);
    if (auto !== null && auto >= price) warns.push(`Auto-accept ($${auto.toFixed(2)}) is at or above the price`);
    if (min !== null && min >= price) warns.push(`Minimum offer ($${min.toFixed(2)}) is at or above the price`);
    if (auto !== null && min !== null && min > auto) warns.push(`Minimum offer ($${min.toFixed(2)}) is above auto-accept ($${auto.toFixed(2)})`);
  }

  const scansPending = ebayScanState.front === 'loading' || ebayScanState.back === 'loading' || ebayLiveState.state === 'loading';
  return { blocks, warns, scansPending };
}

function ebayRenderChecks() {
  if (!ebayDraft) return;
  const { blocks, warns, scansPending } = ebayRunChecks(ebayDraft.itemId, ebayDraft.listing);
  const box = document.getElementById('el-checks');
  const btn = document.getElementById('el-publish-btn');
  if (!box || !btn) return;

  const row = (icon, text, color) => `<div style="display:flex;gap:8px;align-items:flex-start;font-size:14px;line-height:1.4;color:${color};margin-bottom:6px"><span>${icon}</span><span>${ebayEsc(text)}</span></div>`;
  let html = blocks.map(b => row('🛑', b, 'var(--dn)')).join('') + warns.map(w => row('⚠', w, 'var(--tx2)')).join('');
  if (ebayScanState.front === 'loading' || ebayScanState.back === 'loading') html += row('…', 'Checking scans', 'var(--tx3)');
  if (ebayLiveState.state === 'loading') html += row('…', 'Checking eBay for an existing listing', 'var(--tx3)');
  if (!blocks.length && !warns.length && !scansPending) html = row('✓', 'All checks passed', 'var(--up)');
  box.innerHTML = html;

  const canPublish = !blocks.length && !scansPending;
  btn.disabled = !canPublish;
  btn.style.opacity = canPublish ? '1' : '.45';
  btn.style.cursor = canPublish ? 'pointer' : 'not-allowed';
  btn.textContent = blocks.length ? 'Fix the issues above to publish'
    : scansPending ? 'Checking…'
    : warns.length ? `Publish anyway (${warns.length} warning${warns.length > 1 ? 's' : ''})`
    : 'Publish';
}

function ebayScanLoaded(side, ok) {
  ebayScanState[side] = ok ? 'ok' : 'missing';
  const img = document.getElementById(`el-scan-${side}`);
  if (img && !ok) img.parentElement.innerHTML = `<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--dn)">No ${side} scan</div>`;
  ebayRenderChecks();
}

async function ebayCheckLiveStatus(itemId) {
  let st;
  try {
    const res = await fetch(`${WORKER_URL}/ebay-listing-status?itemId=${encodeURIComponent(itemId)}`, { headers: { 'X-App-Key': APP_KEY } });
    st = await res.json();
    if (!res.ok && !st.state) st = { state: 'unknown', error: st.error || `HTTP ${res.status}` };
  } catch (e) {
    st = { state: 'unknown', error: e.message };
  }
  if (!ebayDraft || ebayDraft.itemId !== itemId) return; // user moved on
  ebayLiveState = st;
  ebayRenderChecks();
}

// ── 3) Review page ──
function ebayReviewListing(itemId, useDraft) {
  const l = (useDraft && ebayDraft && ebayDraft.itemId === itemId) ? ebayDraft.listing : ebayCollectForm(itemId);
  ebayDraft = { itemId, listing: l };
  ebayScanState = { front: 'loading', back: 'loading' };
  ebayLiveState = { state: 'loading' };
  try { localStorage.setItem('ebayShippingPolicyId', l.shippingPolicyId); } catch (e) {}
  ebayCheckLiveStatus(itemId);

  const price = ebayMoney(l.price);
  const when = ebayNormalizeAction(l.action) === 'live'
    ? 'Live now'
    : (l.schedule ? new Date(l.schedule).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No start time');
  const offers = !l.allowOffers ? 'Off'
    : [l.offerAuto ? `auto-accept $${ebayMoney(l.offerAuto)?.toFixed(2)}` : null, l.offerMin ? `min $${ebayMoney(l.offerMin)?.toFixed(2)}` : null].filter(Boolean).join(' · ') || 'On';
  const cond = l.isGraded ? `${l.grader} ${l.grade}` : (l.condition || '—');
  const img = side => `https://card-app.maxcsolomon.workers.dev/card-image/${encodeURIComponent(itemId)}-${side}.jpg`;
  const scanBox = side => `
    <div style="flex:1;aspect-ratio:5/7;border:1px solid var(--bdr2);border-radius:8px;overflow:hidden;background:var(--surf2)">
      <img id="el-scan-${side}" src="${img(side)}" alt="${side}" style="width:100%;height:100%;object-fit:contain;display:block"
        onload="ebayScanLoaded('${side}', true)" onerror="ebayScanLoaded('${side}', false)">
    </div>`;
  const line = (label, value) => `
    <div style="display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--bdr)">
      <div style="font-size:13px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.04em;flex-shrink:0">${label}</div>
      <div style="font-size:16px;color:var(--tx);font-weight:600;text-align:right">${value}</div>
    </div>`;

  const html = `
    <div style="position:sticky;top:0;background:var(--bg);padding:10px 0 8px;z-index:10;margin-bottom:6px">
      <button onclick="ebayOpenListingForm('${itemId.replace(/'/g, "\\'")}', true)"
        style="display:flex;align-items:center;gap:6px;background:none;border:none;color:var(--acc);font-size:14px;font-weight:500;cursor:pointer;font-family:inherit;padding:0">
        ← Back to Edit
      </button>
    </div>
    <div class="section-hdr">Review Listing</div>
    <div style="margin-top:12px">
      <div style="display:flex;gap:10px;margin-bottom:14px">${scanBox('front')}${scanBox('back')}</div>
      <div style="font-size:20px;font-weight:700;line-height:1.3;color:var(--tx)">${ebayEsc(l.title) || '<span style="color:var(--dn)">No title</span>'}</div>
      <div style="font-size:12px;color:${l.title.length > 80 ? 'var(--dn)' : 'var(--tx3)'};margin:4px 0 10px">${l.title.length}/80 characters</div>
      ${line('Price', price !== null ? `$${price.toFixed(2)}` : '<span style="color:var(--dn)">Missing</span>')}
      ${line('Format', l.format === 'Auction' ? 'Auction (7 days)' : 'Fixed price')}
      ${l.format === 'FixedPrice' ? line('Offers', ebayEsc(offers)) : ''}
      ${line('Posting', ebayEsc(when))}
      ${line('Shipping', ebayEsc(ebayShippingLabel(l.shippingPolicyId)))}
      ${line('Promoted', l.adRate ? `${ebayEsc(l.adRate)}%` : 'No')}
      ${line('Condition', ebayEsc(cond))}
      <div style="margin-top:16px">
        <div style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Checks</div>
        <div id="el-checks"></div>
      </div>
      <button id="el-publish-btn" onclick="ebayPublishListing()"
        style="width:100%;height:48px;border:none;border-radius:10px;background:var(--acc);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:12px">
        Publish
      </button>
    </div>
  `;
  ebayShowScreen(html);
  ebayRenderChecks();
}

// ── 4) Publish + result ──
async function ebayPublishListing() {
  if (!ebayDraft) return;
  const { itemId, listing: l } = ebayDraft;
  const { blocks, scansPending } = ebayRunChecks(itemId, l);
  if (blocks.length || scansPending) { ebayRenderChecks(); return; }

  const btn = document.getElementById('el-publish-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Publishing…'; }

  const mode = ebayNormalizeAction(l.action);
  const imageSides = ebayScanState.back === 'ok' ? ['front', 'back'] : ['front'];
  let data = null, httpStatus = 0, networkError = null;
  try {
    const res = await fetch(`${WORKER_URL}/ebay-publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Key': APP_KEY },
      body: JSON.stringify({
        itemId,
        listing: l,
        shippingPolicyId: l.shippingPolicyId,
        mode,
        startDate: mode === 'scheduled' ? new Date(l.schedule).toISOString() : undefined,
        imageSides
      })
    });
    httpStatus = res.status;
    data = await res.json();
  } catch (e) {
    networkError = e.message;
  }

  const ok = data && data.ok;
  if (ok && typeof ctTagCache === 'object') {
    // Mark locally right away so it can't be listed twice; the 15-min sync makes it permanent.
    const cur = ctTagCache[itemId] || [];
    if (!cur.includes('Listed')) ctTagCache[itemId] = [...cur, 'Listed'];
  }
  ebayRenderResult(ok, data, httpStatus, networkError);
}

function ebayRenderResult(ok, data, httpStatus, networkError) {
  const { itemId, listing: l } = ebayDraft;
  const back = itemId.replace(/'/g, "\\'");
  let body;
  if (ok) {
    const mode = ebayNormalizeAction(l.action);
    const when = mode === 'live' ? 'Listed now' : `Scheduled for ${new Date(l.schedule).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
    let promo = '';
    if (data.promo && data.promo.ok) promo = `<div style="font-size:14px;color:var(--tx2);margin-top:6px">Promoted at ${ebayEsc(data.promo.rate)}%</div>`;
    else if (data.promo && data.promo.error) promo = `<div style="font-size:14px;color:var(--dn);margin-top:6px">⚠ Not promoted: ${ebayEsc(data.promo.error.message || data.promo.error)}</div>`;
    body = `
      <div style="font-size:40px;line-height:1;color:var(--up)">✓</div>
      <div style="font-size:20px;font-weight:700;margin-top:10px;color:var(--tx)">${ebayEsc(when)}</div>
      <div style="font-size:15px;color:var(--tx2);margin-top:6px">${ebayEsc(l.title)}</div>
      ${promo}
      <a href="https://www.ebay.com/itm/${encodeURIComponent(data.listingId)}" target="_blank" rel="noopener"
        style="display:flex;align-items:center;justify-content:center;height:44px;border-radius:10px;background:var(--acc);color:#fff;font-size:14px;font-weight:700;text-decoration:none;margin-top:18px">
        View on eBay (#${ebayEsc(data.listingId)})
      </a>
      <button onclick="ebayDraft=null;document.getElementById('mcontent').innerHTML=_modalMainHtml;if(typeof ctOpenCardIdx!=='undefined'&&ctOpenCardIdx!==null&&typeof ctRenderTags==='function')ctRenderTags(ctOpenCardIdx)"
        style="width:100%;height:40px;border:1px solid var(--bdr2);border-radius:10px;background:var(--surf2);color:var(--tx2);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:8px">
        Done
      </button>`;
  } else {
    const err = data && data.error;
    const msg = networkError || (typeof err === 'string' ? err : (err && `${err.step}: ${err.message}`)) || `HTTP ${httpStatus}`;
    body = `
      <div style="font-size:40px;line-height:1;color:var(--dn)">✗</div>
      <div style="font-size:20px;font-weight:700;margin-top:10px;color:var(--tx)">Not published</div>
      <div style="font-size:14px;color:var(--dn);margin-top:8px;line-height:1.4">${ebayEsc(msg)}</div>
      <button onclick="ebayOpenListingForm('${back}', true)"
        style="width:100%;height:44px;border:none;border-radius:10px;background:var(--acc);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:18px">
        ← Back to Edit
      </button>
      <button onclick="ebayReviewListing('${back}', true)"
        style="width:100%;height:40px;border:1px solid var(--bdr2);border-radius:10px;background:var(--surf2);color:var(--tx2);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:8px">
        Try again
      </button>`;
  }
  ebayShowScreen(`
    <div class="section-hdr">List on eBay</div>
    <div style="margin-top:20px;text-align:center">${body}</div>`);
}
