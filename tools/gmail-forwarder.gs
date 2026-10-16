// Gmail -> Card Tracker. Sends the analyst's emails to your app's Inbox for review.
// Setup (once):
//  1. script.google.com -> New project -> paste this whole file over the default code -> Save.
//  2. Project Settings (gear) -> Script properties -> add:  APP_KEY = your app key (the APP_KEY line in js/config.js)
//                                                          SENDER  = the analyst's email address (exactly as it appears in "From")
//  3. Pick `setup` in the function dropdown -> Run -> approve the Gmail / external request permissions.
// Then every 10 minutes it sends any new email from SENDER (last 3 days) that it hasn't sent yet, with no clicking needed.
// Emails whose subject contains a SKIP_SUBJECTS word (default "bowman brew", the daily stats emails) are skipped and labelled "Card Tracker Skipped".
// Optional script property SKIP_SUBJECTS = comma-separated words to skip (replaces the default). Emails you label by hand are never skipped.
// Older emails: put the Gmail label "Send to Card Tracker" on them (any sender); they go out on the next run.
// To send right now: pick `processPosts` -> Run.  Results land in the app under Prospects -> Inbox.

const API = 'https://card-app.maxcsolomon.workers.dev/prospect-email';
const MANUAL_LABEL = 'Send to Card Tracker';
const DONE_LABEL = 'Card Tracker Sent';
const FAILED_LABEL = 'Card Tracker Failed';
const SKIPPED_LABEL = 'Card Tracker Skipped';
const DEFAULT_SKIP = 'bowman brew';
const MAX_PER_RUN = 4;   // each extraction takes ~15-40s and one run must finish inside Apps Script's 6-minute limit
const MAX_TRIES = 3;     // a thread that keeps failing is parked under the Failed label instead of retrying forever

function setup() {
  [MANUAL_LABEL, DONE_LABEL, FAILED_LABEL, SKIPPED_LABEL].forEach(n => GmailApp.getUserLabelByName(n) || GmailApp.createLabel(n));
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'processPosts').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('processPosts').timeBased().everyMinutes(10).create();
  Logger.log('Ready. Labels created and a 10-minute trigger installed. Add the Send to Card Tracker label to an email, then run processPosts to try it.');
}

function processPosts() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('APP_KEY'), sender = (props.getProperty('SENDER') || '').trim().toLowerCase();
  if (!key || !sender) throw new Error('Add APP_KEY and SENDER under Project Settings -> Script properties first.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;   // a previous run is still going
  try {
    const query = '(from:' + sender + ' newer_than:3d OR label:"' + MANUAL_LABEL + '") -label:"' + DONE_LABEL + '" -label:"' + FAILED_LABEL + '" -label:"' + SKIPPED_LABEL + '"';
    const doneLabel = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
    const failedLabel = GmailApp.getUserLabelByName(FAILED_LABEL) || GmailApp.createLabel(FAILED_LABEL);
    const skipWords = (props.getProperty('SKIP_SUBJECTS') || DEFAULT_SKIP).toLowerCase().split(',').map(w => w.trim()).filter(Boolean);
    const skippedLabel = GmailApp.getUserLabelByName(SKIPPED_LABEL) || GmailApp.createLabel(SKIPPED_LABEL);
    let extracted = 0;
    for (const thread of GmailApp.search(query, 0, 10)) {
      const manual = thread.getLabels().some(l => l.getName() === MANUAL_LABEL);
      let allSent = true;
      if (!manual && skipWords.some(w => thread.getFirstMessageSubject().toLowerCase().indexOf(w) !== -1)) {   // e.g. the daily stats email
        thread.addLabel(skippedLabel); Logger.log('Skipped: ' + thread.getFirstMessageSubject()); continue;
      }
      for (const msg of thread.getMessages()) {
        if (!manual && msg.getFrom().toLowerCase().indexOf(sender) === -1) continue;   // someone else in the thread
        if (extracted >= MAX_PER_RUN) { allSent = false; break; }                       // rest goes on the next run
        const r = sendMessage(msg, key);
        if (r.ok) { if (!r.duplicate) extracted++; Logger.log((r.duplicate ? 'Already in app: ' : 'Sent: ') + msg.getSubject()); }
        else {
          allSent = false;
          const tk = 'tries:' + thread.getId(), n = Number(props.getProperty(tk) || 0) + 1;
          props.setProperty(tk, String(n));
          Logger.log('Failed (' + n + '/' + MAX_TRIES + '): ' + msg.getSubject() + ' -> ' + r.error);
          if (n >= MAX_TRIES) thread.addLabel(failedLabel);
          break;
        }
      }
      if (allSent) thread.addLabel(doneLabel);
    }
  } finally {
    lock.releaseLock();
  }
}

function sendMessage(msg, key) {
  const images = [];
  let total = 0;
  for (const a of msg.getAttachments({ includeInlineImages: true, includeAttachments: true })) {   // images embedded in the email itself
    const type = a.getContentType();
    if (!/^image\/(png|jpeg|gif|webp)$/.test(type)) continue;
    const bytes = a.getBytes();
    if (bytes.length < 3000 || bytes.length > 4500000 || total + bytes.length > 12000000) continue;
    total += bytes.length;
    images.push({ media_type: type, base64: Utilities.base64Encode(bytes) });
    if (images.length >= 8) break;
  }
  const payload = {
    subject: msg.getSubject(),
    date: Utilities.formatDate(msg.getDate(), 'America/New_York', 'yyyy-MM-dd'),
    html: msg.getBody(),      // the app turns this into text and downloads any table screenshots it links to
    text: msg.getPlainBody(),
    images: images
  };
  try {
    const res = UrlFetchApp.fetch(API, { method: 'post', contentType: 'application/json', headers: { 'X-App-Key': key }, payload: JSON.stringify(payload), muteHttpExceptions: true });
    let body = {};
    try { body = JSON.parse(res.getContentText()); } catch (e) { /* not JSON */ }
    const ok = res.getResponseCode() === 200 && !body.error;
    return { ok: ok, duplicate: !!body.duplicate, error: body.error || ('HTTP ' + res.getResponseCode()) };
  } catch (e) {
    return { ok: false, duplicate: false, error: String(e) };   // e.g. timeout: the app may still have saved it; the retry just finds it already there
  }
}
