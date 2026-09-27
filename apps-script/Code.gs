/**
 * Nozomi Summary — usage audit log receiver (Google Apps Script Web App).
 *
 * Receives metadata-only events from the web app and the browser extension
 * and appends them to the "Log" sheet. No alert content is ever sent here.
 *
 * Deploy: Execute as "Me", Who has access "Anyone". See SETUP.md.
 */

// Shared token — must match AUDIT_TOKEN in app.js and extension/src/audit.js.
// Not a secret (it ships in public JS); it only filters random bot traffic.
// Rotate by changing it here + in both clients, then redeploying.
const TOKEN = '649af99946cd346595c75a4f2be9cc07';

const LOG_SHEET     = 'Log';
const SUMMARY_SHEET = 'Summary';
const TIMEZONE      = 'Asia/Bangkok';
const MAX_LEN       = 500;

const COLUMNS = [
  'server_time', 'client_time', 'user', 'source', 'event',
  'output_filename', 'shift', 'data_date', 'row_count', 'input_filename',
  'error_message', 'app_version', 'device_id', 'user_agent',
];

const ALLOWED = {
  event:  ['export', 'export_error'],
  source: ['web', 'extension'],
  shift:  ['', 'Day', 'Night', 'Full'],
};

// ── HTTP entry points ───────────────────────────────────────────

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: 'bad_json' });
  }

  if (!body || body.token !== TOKEN) return reply({ ok: false, error: 'bad_token' });
  if (!ALLOWED.event.includes(body.event))   return reply({ ok: false, error: 'bad_event' });
  if (!ALLOWED.source.includes(body.source)) return reply({ ok: false, error: 'bad_source' });
  if (!ALLOWED.shift.includes(body.shift || '')) return reply({ ok: false, error: 'bad_shift' });

  const row = COLUMNS.map((col) => (col === 'server_time' ? new Date() : clean(body[col])));

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    getLogSheet().appendRow(row);
  } finally {
    lock.releaseLock();
  }
  return reply({ ok: true });
}

function doGet() {
  return reply({ ok: true, service: 'nozomi-summary-audit' });
}

// ── One-time setup (run manually from the editor) ───────────────

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TIMEZONE);

  const log = getLogSheet();
  log.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');

  let sum = ss.getSheetByName(SUMMARY_SHEET);
  if (!sum) sum = ss.insertSheet(SUMMARY_SHEET);
  sum.clear();

  sum.getRange('A1').setValue('Exports per user').setFontWeight('bold');
  sum.getRange('A2').setFormula(
    "=IFERROR(QUERY(Log!A:N, \"select C, count(A), max(A) where E = 'export' " +
    "group by C order by max(A) desc label C 'user', count(A) 'exports', " +
    "max(A) 'last_export'\", 1), \"(no data yet)\")"
  );

  sum.getRange('E1').setValue('Errors per user').setFontWeight('bold');
  sum.getRange('E2').setFormula(
    "=IFERROR(QUERY(Log!A:N, \"select C, count(A), max(A) where E = 'export_error' " +
    "group by C order by max(A) desc label C 'user', count(A) 'errors', " +
    "max(A) 'last_error'\", 1), \"(no errors)\")"
  );

  sum.getRange('I1').setValue('Exports per source').setFontWeight('bold');
  sum.getRange('I2').setFormula(
    "=IFERROR(QUERY(Log!A:N, \"select D, count(A) where E = 'export' " +
    "group by D label D 'source', count(A) 'exports'\", 1), \"(no data yet)\")"
  );

  sum.getRange('C:C').setNumberFormat('yyyy-mm-dd hh:mm');
  sum.getRange('G:G').setNumberFormat('yyyy-mm-dd hh:mm');
  sum.setFrozenRows(1);
}

// ── Helpers ─────────────────────────────────────────────────────

function getLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET, 0);
    sh.appendRow(COLUMNS);
    sh.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * Coerce to a bounded string. Values starting with a formula trigger
 * (= + - @) are prefixed with ' so a crafted name can't run a formula.
 */
function clean(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && isFinite(v)) return v;
  let s = String(v).slice(0, MAX_LEN);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
