/**
 * ลุงชัย Onboarding: admin-side automation for the Registrations sheet.
 *
 * Paste into Extensions > Apps Script of the SAME spreadsheet, then:
 *   1. Project Settings > Script properties: add LINE_CHANNEL_ACCESS_TOKEN
 *      (Messaging API channel of @379iftpg > long-lived channel access token).
 *   2. Run setup() once from the editor and approve the permissions.
 *
 * What it does:
 *   - When an admin changes column C (status) to "approved" or "rejected",
 *     it pushes the result to the applicant on LINE and stamps decided_at / notified_at.
 *     Whatever the admin writes in admin_note (column P) is included in the message,
 *     e.g. login details on approval or the reason on rejection.
 *   - Once a day, it deletes rejected and never-decided (pending) requests older than
 *     RETENTION_DAYS, per the PDPA retention you chose. Approved rows are kept.
 *
 * Column order must match lib/sheets.ts COLUMNS.
 */

const SHEET_TAB = 'Registrations';
const RETENTION_DAYS = 365;

const COL = {
  requestNo: 1, submittedAt: 2, status: 3, lineUserId: 4, lineDisplayName: 5,
  company: 6, nameTh: 7, nameEn: 8, phone: 9, email: 10, role: 11, pkg: 12,
  consentVersion: 13, consentedAt: 14, lang: 15, adminNote: 16, decidedAt: 17, notifiedAt: 18,
};

const HEADERS = [
  'request_no', 'submitted_at', 'status', 'line_user_id', 'line_display_name',
  'company', 'name_th', 'name_en', 'phone', 'email', 'role', 'package',
  'consent_version', 'consented_at', 'lang', 'admin_note', 'decided_at', 'notified_at',
];

const MSG = {
  th: {
    approved: (r, note) => `✅ คำขอเลขที่ ${r} ได้รับการอนุมัติแล้ว\nยินดีต้อนรับสู่ ลุงชัย Fleet` + (note ? `\n\n${note}` : ''),
    rejected: (r, note) => `คำขอเลขที่ ${r} ยังไม่ได้รับการอนุมัติ` + (note ? `\nเหตุผล: ${note}` : '') + `\n\nหากมีข้อสงสัย ตอบกลับข้อความนี้ได้เลย`,
  },
  en: {
    approved: (r, note) => `✅ Request ${r} has been approved.\nWelcome to Lung Chai Fleet.` + (note ? `\n\n${note}` : ''),
    rejected: (r, note) => `Request ${r} was not approved.` + (note ? `\nReason: ${note}` : '') + `\n\nReply to this message if you have questions.`,
  },
};

/** Run once: header row, status dropdown, frozen header, triggers. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_TAB) || ss.insertSheet(SHEET_TAB);

  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);

  // Plain-text columns so phone numbers keep their leading zero if edited by hand.
  sh.getRange('A:R').setNumberFormat('@');

  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['pending', 'approved', 'rejected'], true)
    .setAllowInvalid(false)
    .build();
  sh.getRange(2, COL.status, sh.getMaxRows() - 1, 1).setDataValidation(rule);

  // Protect everything except status and admin_note from accidental edits.
  const p = sh.protect().setDescription('Registrations (system columns)');
  p.setUnprotectedRanges([
    sh.getRange(2, COL.status, sh.getMaxRows() - 1, 1),
    sh.getRange(2, COL.adminNote, sh.getMaxRows() - 1, 1),
  ]);
  p.setWarningOnly(true);

  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onStatusEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('purgeExpired').timeBased().everyDays(1).atHour(3).inTimezone('Asia/Bangkok').create();
}

/** Installable onEdit trigger (created by setup). */
function onStatusEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== SHEET_TAB) return;
  if (e.range.getColumn() > COL.status || e.range.getLastColumn() < COL.status) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    for (let row = Math.max(2, e.range.getRow()); row <= e.range.getLastRow(); row++) {
      notifyRow_(sh, row);
    }
  } finally {
    lock.releaseLock();
  }
}

/** Send the decision for one row, once. Can also be run manually for a row number. */
function notifyRow_(sh, row) {
  const v = sh.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  const status = String(v[COL.status - 1]).trim().toLowerCase();
  if (status !== 'approved' && status !== 'rejected') return;
  if (v[COL.notifiedAt - 1]) return; // already told the user

  const userId = String(v[COL.lineUserId - 1]);
  const requestNo = String(v[COL.requestNo - 1]);
  const note = String(v[COL.adminNote - 1] || '').trim();
  const lang = v[COL.lang - 1] === 'en' ? 'en' : 'th';
  const now = bangkokNow_();

  sh.getRange(row, COL.decidedAt).setValue(now);
  if (!userId) return;

  const ok = pushLine_(userId, MSG[lang][status](requestNo, note), requestNo + ':' + status);
  if (ok) sh.getRange(row, COL.notifiedAt).setValue(now);
}

function pushLine_(to, text, retryKeySeed) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw new Error('Set LINE_CHANNEL_ACCESS_TOKEN in Script properties');

  // Same decision always yields the same retry key, so LINE won't deliver it twice.
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, retryKeySeed);
  const hex = digest.map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  const retryKey = [hex.slice(0, 8), hex.slice(8, 12), '4' + hex.slice(13, 16), '8' + hex.slice(17, 20), hex.slice(20, 32)].join('-');

  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, 'X-Line-Retry-Key': retryKey },
    payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: text }] }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 200 || code === 409 /* already accepted with this retry key */) return true;
  console.error('LINE push failed', code, res.getContentText());
  return false;
}

/** Daily: delete rejected/pending rows older than RETENTION_DAYS. */
function purgeExpired() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_TAB);
  if (!sh || sh.getLastRow() < 2) return;
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, COL.status).getValues();

  // Delete bottom-up so row numbers stay valid.
  for (let i = rows.length - 1; i >= 0; i--) {
    const status = String(rows[i][COL.status - 1]).trim().toLowerCase();
    if (status === 'approved') continue;
    const t = Date.parse(String(rows[i][COL.submittedAt - 1]));
    if (!isNaN(t) && t < cutoff) sh.deleteRow(i + 2);
  }
}

function bangkokNow_() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ss") + '+07:00';
}
