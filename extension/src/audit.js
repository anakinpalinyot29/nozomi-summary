/**
 * Nozomi Summary — usage audit client (shared by web app + extension).
 *
 * Sends metadata-only events (who, when, which file, how many rows) to the
 * Google Apps Script receiver in apps-script/Code.gs. Never sends alert content.
 *
 * Fire-and-forget: logging must never block or break an export. Events that
 * fail to send are queued in localStorage (max QUEUE_MAX) and retried on the
 * next page/popup load.
 *
 * KEEP IN SYNC: this file is copied verbatim to extension/src/audit.js.
 */

'use strict';

(function () {
  // Apps Script Web App URL — empty disables sending (events are dropped).
  const AUDIT_URL   = 'https://script.google.com/macros/s/AKfycbxTBY9r-cFlrhkM7dK64PxBq1tI6R6h9VITSDhTrtqM3VfBmt_7wYYTAER-JQG1KbPt/exec';
  // Must match TOKEN in apps-script/Code.gs. Not a secret; filters bot noise.
  const AUDIT_TOKEN = '649af99946cd346595c75a4f2be9cc07';

  const KEY_USER   = 'nz_audit_user';
  const KEY_DEVICE = 'nz_audit_device';
  const KEY_QUEUE  = 'nz_audit_queue';
  const QUEUE_MAX  = 50;

  let source     = 'web';
  let appVersion = '';

  // ── localStorage (may throw in private mode / blocked storage) ──

  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  // ── Identity ───────────────────────────────────────────────────

  function getUser() {
    const u = load(KEY_USER, '');
    return typeof u === 'string' ? u : '';
  }

  function setUser(name) {
    save(KEY_USER, String(name || '').trim().slice(0, 100));
  }

  function getDeviceId() {
    let id = load(KEY_DEVICE, '');
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) ||
        Math.random().toString(16).slice(2) + Date.now().toString(16);
      save(KEY_DEVICE, id);
    }
    return id;
  }

  // ── Transport ──────────────────────────────────────────────────

  function localTimestamp(d) {
    const p = (n) => String(n).padStart(2, '0');
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
      `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ` +
      `${sign}${p(Math.floor(Math.abs(off) / 60))}${p(Math.abs(off) % 60)}`;
  }

  // text/plain + no-cors avoids a CORS preflight, which Apps Script can't answer.
  // The response is opaque, so "resolved" means "sent", not "stored".
  function send(payload) {
    return fetch(AUDIT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  }

  function enqueue(payload) {
    const q = load(KEY_QUEUE, []);
    const list = Array.isArray(q) ? q : [];
    list.push(payload);
    save(KEY_QUEUE, list.slice(-QUEUE_MAX));
  }

  async function flush() {
    if (!AUDIT_URL) return;
    const q = load(KEY_QUEUE, []);
    if (!Array.isArray(q) || q.length === 0) return;
    save(KEY_QUEUE, []);
    for (let i = 0; i < q.length; i++) {
      try {
        await send(q[i]);
      } catch (e) {
        // Still offline — put back what's left and stop.
        q.slice(i).forEach(enqueue);
        return;
      }
    }
  }

  // ── Public API ─────────────────────────────────────────────────

  /**
   * @param {object} fields  event, output_filename, shift, data_date,
   *                         row_count, input_filename, error_message
   */
  function log(fields) {
    try {
      if (!AUDIT_URL) return;
      const payload = Object.assign({
        token:       AUDIT_TOKEN,
        client_time: localTimestamp(new Date()),
        user:        getUser() || '(unnamed)',
        source,
        app_version: appVersion,
        device_id:   getDeviceId(),
        user_agent:  navigator.userAgent,
      }, fields);
      send(payload).catch(() => enqueue(payload));
    } catch (e) {
      // Never let auditing break the app.
    }
  }

  function configure(opts) {
    source     = opts.source || source;
    appVersion = opts.appVersion || appVersion;
    flush().catch(() => {});
  }

  window.Audit = { configure, log, getUser, setUser };
})();
