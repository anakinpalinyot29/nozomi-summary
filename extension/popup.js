/**
 * Nozomi SOAR Robot — popup controller.
 *
 * Orchestrates: verify a logged-in Vantage tab → read the sniffed vantage-org
 * → inject a paged same-origin fetch into that tab → normalize to .xlsx (via
 * src/normalize.js + bundled SheetJS) → download. Whole-day mode fetches both
 * the Day and Night windows and stacks them in one sheet.
 */

'use strict';

// ── Config (1:1 with nozomi/config.py) ──────────────────────────
const CFG = {
  alertsPath: '/api/v1/alerts',
  pageSize: 100,
  maxPages: 2000,
  include: 'sensor,site,malicious_file,alert_close_options',
};

const VANTAGE_RE = /vantage\.nozominetworks\.io/;
const $ = (id) => document.getElementById(id);

let selectedShift = 'Day';

// ── Injected into the Vantage page (self-contained — no closures) ──
// Whole body is wrapped so a page-side throw can never surface as a null
// executeScript result — it always returns a structured object.
async function pageFetchAlerts(cfg, geMs, ltMs) {
  const flattenPage = (data) => {
    if (!data || typeof data !== 'object' || !Array.isArray(data.data)) {
      return { error: 'bad_shape' };
    }
    const included = {};
    for (const inc of data.included || []) {
      if (inc && typeof inc === 'object') {
        included[inc.type + ' ' + inc.id] = inc.attributes || {};
      }
    }
    const out = [];
    for (const item of data.data) {
      if (!item || typeof item !== 'object') continue;
      const flat = Object.assign({ id: item.id }, item.attributes || {});
      flat.id = item.id != null ? item.id : flat.id;
      const siteRef = ((item.relationships || {}).site || {}).data;
      if (siteRef && typeof siteRef === 'object') {
        const attrs = included[siteRef.type + ' ' + siteRef.id] || {};
        flat.site = { name: attrs.name != null ? attrs.name : null };
      }
      out.push(flat);
    }
    return { records: out };
  };

  try {
    const origin = location.origin;
    const headers = { accept: 'application/json, text/plain, */*' };
    if (cfg.org) headers['vantage-org'] = cfg.org;

    const all = [];
    const seen = new Set();
    for (let page = 1; page <= cfg.maxPages; page++) {
      const params = new URLSearchParams({
        'filter[time][ge]': String(geMs),
        'filter[time][lt]': String(ltMs),
        'sort[time]': 'desc',
        page: String(page),
        size: String(cfg.pageSize),
        skip_total_count: 'true',
        include: cfg.include,
      });
      let resp;
      try {
        resp = await fetch(origin + cfg.alertsPath + '?' + params.toString(), {
          headers,
          credentials: 'include',
        });
      } catch (e) {
        return { error: 'fetch_failed', message: String(e && e.message ? e.message : e), page };
      }
      if (resp.status === 401 || resp.status === 403) {
        return { error: 'unauthorized', status: resp.status };
      }
      if (!resp.ok) {
        return { error: 'api_error', status: resp.status, body: (await resp.text()).slice(0, 300) };
      }
      let json;
      try {
        json = await resp.json();
      } catch (e) {
        return { error: 'bad_json', message: String(e && e.message ? e.message : e), page };
      }
      const flat = flattenPage(json);
      if (flat.error) return flat;
      if (!flat.records.length) break;
      const fresh = flat.records.filter((r) => !seen.has(r.id));
      if (!fresh.length) break;
      for (const r of fresh) if (r.id != null) seen.add(r.id);
      for (const r of fresh) all.push(r);
    }
    return { ok: true, records: all };
  } catch (e) {
    return { error: 'exception', message: String(e && e.message ? e.message : e) };
  }
}

// ── Popup-side helpers ──────────────────────────────────────────

function setStatus(text, cls) {
  const el = $('status');
  el.textContent = text;
  el.className = 'status' + (cls ? ' ' + cls : '');
}

async function getState() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onVantage = !!(tab && tab.url && VANTAGE_RE.test(tab.url));
  const { vantageOrg } = await chrome.storage.session.get('vantageOrg');

  $('chip-tab').textContent = 'tab: ' + (onVantage ? '✓ Vantage' : '✗ อื่น');
  $('chip-tab').className = 'chip ' + (onVantage ? 'ok' : 'bad');
  $('chip-org').textContent = 'org: ' + (vantageOrg ? '✓' : '—');
  $('chip-org').className = 'chip ' + (vantageOrg ? 'ok' : 'bad');

  return { tab, onVantage, org: vantageOrg || null };
}

async function fetchWindow(tabId, org, geMs, ltMs) {
  let inj;
  try {
    inj = await chrome.scripting.executeScript({
      target: { tabId },
      func: pageFetchAlerts,
      args: [{ ...CFG, org }, geMs, ltMs],
    });
  } catch (e) {
    return { error: 'inject_failed', message: String(e && e.message ? e.message : e) };
  }
  if (!inj || !inj[0]) return { error: 'no_injection' };
  if (inj[0].result == null) {
    const chromeErr = inj[0].error && inj[0].error.message;
    return { error: 'null_result', message: chromeErr || 'injected function returned no value' };
  }
  return inj[0].result;
}

function explainError(res) {
  if (!res) return '❌ ไม่มีผลลัพธ์กลับมา';
  switch (res.error) {
    case 'unauthorized':
      return `❌ Vantage ปฏิเสธ (${res.status}) — session อาจหมดอายุ ลอง refresh หน้า Vantage แล้วลองใหม่`;
    case 'fetch_failed':
      return '❌ ยิง API ไม่สำเร็จ: ' + res.message;
    case 'api_error':
      return `❌ Vantage error ${res.status}: ${res.body || ''}`;
    case 'bad_json':
      return '❌ API ตอบกลับไม่ใช่ JSON: ' + (res.message || '');
    case 'bad_shape':
      return '❌ รูปแบบข้อมูลจาก API ไม่ตรงที่คาด';
    case 'exception':
      return '❌ error ในหน้า Vantage: ' + (res.message || '');
    case 'null_result':
      return '❌ inject ไม่คืนค่า: ' + (res.message || '');
    case 'inject_failed':
      return '❌ inject ไม่สำเร็จ: ' + (res.message || '');
    case 'no_injection':
      return '❌ ไม่มี frame ให้ inject (แท็บ Vantage ถูกปิด?)';
    default:
      return '❌ error: ' + (res.error || 'unknown') + (res.message ? ' — ' + res.message : '');
  }
}

async function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename, saveAs: false });
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

// ── Export flow ─────────────────────────────────────────────────

async function runExport() {
  const btn = $('btn-export');
  const dateStr = $('date-input').value;
  const shift = selectedShift;

  // Show the error and record it in the usage log.
  const fail = (msg) => {
    setStatus(msg, 'bad');
    Audit.log({ event: 'export_error', shift, data_date: dateStr, error_message: msg });
  };

  if (!ensureUserName()) {
    setStatus('👤 กรุณาใส่ชื่อก่อน export (ถามครั้งเดียว)', 'bad');
    return;
  }

  if (!window.Shifts.isValidDate(dateStr)) {
    fail('❌ กรุณาเลือกวันที่ให้ถูกต้อง');
    return;
  }

  const { tab, onVantage, org } = await getState();
  if (!onVantage) {
    fail('❌ แท็บที่โฟกัสไม่ใช่ Vantage\nเปิดแท็บ Vantage (ล็อกอินแล้ว) ให้ active แล้วลองใหม่');
    return;
  }
  if (!org) {
    fail('⚠️ ยังไม่ได้ vantage-org — refresh หน้า /alerts ของ Vantage หนึ่งครั้งแล้วลองใหม่');
    return;
  }

  btn.disabled = true;
  try {
    if (selectedShift === 'Full') {
      const [dGe, dLt] = window.Shifts.shiftWindow(dateStr, 'Day');
      const [nGe, nLt] = window.Shifts.shiftWindow(dateStr, 'Night');

      setStatus('⏳ ดึงกะ Day…', 'busy');
      const dayRes = await fetchWindow(tab.id, org, dGe, dLt);
      if (!dayRes.ok) { fail(explainError(dayRes)); return; }

      setStatus(`⏳ Day: ${dayRes.records.length} · ดึงกะ Night…`, 'busy');
      const nightRes = await fetchWindow(tab.id, org, nGe, nLt);
      if (!nightRes.ok) { fail(explainError(nightRes)); return; }

      const { blob, filename } = window.Normalize.buildFullDay(
        dayRes.records, nightRes.records, dateStr
      );
      await download(blob, filename);
      setStatus(
        `✅ เสร็จ — Day ${dayRes.records.length} + Night ${nightRes.records.length} records\n📄 ${filename}`,
        'ok'
      );
      const d = dayRes.records.length, n = nightRes.records.length;
      Audit.log({
        event: 'export', output_filename: filename, shift, data_date: dateStr,
        row_count: `${d + n} (D ${d} / N ${n})`,
      });
    } else {
      const [geMs, ltMs] = window.Shifts.shiftWindow(dateStr, selectedShift);
      setStatus(`⏳ ดึงกะ ${selectedShift}…`, 'busy');
      const res = await fetchWindow(tab.id, org, geMs, ltMs);
      if (!res.ok) { fail(explainError(res)); return; }

      const { blob, filename } = window.Normalize.buildSingle(
        res.records, selectedShift, dateStr
      );
      await download(blob, filename);
      setStatus(`✅ เสร็จ — ${res.records.length} records\n📄 ${filename}`, 'ok');
      Audit.log({
        event: 'export', output_filename: filename, shift, data_date: dateStr,
        row_count: res.records.length,
      });
    }
  } catch (e) {
    fail('❌ error: ' + (e && e.message ? e.message : String(e)));
  } finally {
    btn.disabled = false;
  }
}

// ── User name (asked once, kept in the popup's localStorage) ────

/** Save a typed name if there is one; false means we still need a name. */
function ensureUserName() {
  const typed = $('name-input').value.trim();
  if (typed) {
    Audit.setUser(typed);
    renderUserName();
  }
  if (Audit.getUser()) return true;
  $('name-field').classList.remove('hidden');
  $('name-input').focus();
  return false;
}

function renderUserName() {
  const name = Audit.getUser();
  $('chip-user-name').textContent = name;
  $('chip-user').classList.toggle('hidden', !name);
  $('name-field').classList.toggle('hidden', !!name);
  $('name-input').value = '';
}

function setupUserName() {
  renderUserName();
  $('chip-user').addEventListener('click', () => {
    $('name-input').value = Audit.getUser();
    $('name-field').classList.remove('hidden');
    $('name-input').focus();
  });
  $('name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && $('name-input').value.trim()) {
      Audit.setUser($('name-input').value);
      renderUserName();
    }
  });
}

// ── Wire up ─────────────────────────────────────────────────────

function setupShiftButtons() {
  const btns = [$('sb-day'), $('sb-night'), $('sb-full')];
  btns.forEach((b) =>
    b.addEventListener('click', () => {
      selectedShift = b.dataset.shift;
      btns.forEach((x) => x.classList.toggle('active', x === b));
    })
  );
}

document.addEventListener('DOMContentLoaded', () => {
  // Default date = today (local).
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  $('date-input').value = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;

  Audit.configure({ source: 'extension', appVersion: chrome.runtime.getManifest().version });
  setupShiftButtons();
  setupUserName();
  $('btn-export').addEventListener('click', runExport);
  getState();
});
