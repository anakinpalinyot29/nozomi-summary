/**
 * Nozomi Summary — Audit page (#audit).
 *
 * Reads the public usage log from the Apps Script receiver
 * (GET ?action=logs — see apps-script/Code.gs) and renders KPIs,
 * a per-user table and a filterable log. The endpoint never returns
 * device_id or user_agent. All data is rendered with textContent.
 */

'use strict';

(function () {
  // Same Web App as AUDIT_URL in audit.js — keep in sync.
  const LOGS_URL = 'https://script.google.com/macros/s/AKfycbxTBY9r-cFlrhkM7dK64PxBq1tI6R6h9VITSDhTrtqM3VfBmt_7wYYTAER-JQG1KbPt/exec?action=logs';

  const TZ_OFFSET_MS = 7 * 3600 * 1000; // server_time is Asia/Bangkok
  const DAY_MS       = 24 * 3600 * 1000;

  const $ = (id) => document.getElementById(id);
  const elStatus  = $('audit-status');
  const elRefresh = $('audit-refresh');
  const elUsers   = $('audit-users');
  const elLog     = $('audit-log');
  const elCount   = $('audit-count');
  const elSearch  = $('f-search');
  const elRange   = $('f-range');
  const elEvent   = $('f-event');
  const elSource  = $('f-source');

  let rows    = null;  // newest first
  let loading = false;

  // ── Time helpers (server_time = 'YYYY-MM-DD HH:mm:ss' in ICT) ──

  /** 'YYYY-MM-DD' in ICT, `daysAgo` days before today. */
  function ictDate(daysAgo) {
    return new Date(Date.now() + TZ_OFFSET_MS - daysAgo * DAY_MS).toISOString().slice(0, 10);
  }

  /** Rows on or after the start of the day `days - 1` days ago (1 = today). */
  function since(list, days) {
    const cutoff = ictDate(days - 1);
    return list.filter((r) => String(r.server_time).slice(0, 10) >= cutoff);
  }

  // ── Loading ────────────────────────────────────────────────────

  async function load() {
    if (loading) return;
    loading = true;
    elRefresh.disabled = true;
    elRefresh.classList.add('is-loading');
    elStatus.textContent = 'กำลังโหลดข้อมูลจาก Sheet…';
    try {
      const res  = await fetch(LOGS_URL, { cache: 'no-store' });
      const data = await res.json();
      if (!data || !data.ok || !Array.isArray(data.rows)) throw new Error('bad response');
      rows = data.rows;
      elStatus.textContent =
        `ข้อมูลย้อนหลัง 90 วัน · ${rows.length.toLocaleString()} รายการ · อัปเดต ${data.generated_at || ''}`;
      render();
    } catch (e) {
      elStatus.textContent = rows
        ? 'โหลดข้อมูลใหม่ไม่สำเร็จ — แสดงข้อมูลเดิม'
        : 'โหลดข้อมูลไม่สำเร็จ — ตรวจสอบว่า Apps Script deploy เวอร์ชันล่าสุดแล้ว แล้วกด Refresh';
    } finally {
      loading = false;
      elRefresh.disabled = false;
      elRefresh.classList.remove('is-loading');
    }
  }

  // ── Rendering ──────────────────────────────────────────────────

  function render() {
    if (!rows) return;
    renderKpis();
    renderUsers();
    renderLog();
  }

  function renderKpis() {
    const exports = rows.filter((r) => r.event === 'export');
    const week    = since(exports, 7);
    const web     = week.filter((r) => r.source === 'web').length;
    $('kpi-today').textContent  = since(exports, 1).length.toLocaleString();
    $('kpi-week').textContent   = week.length.toLocaleString();
    $('kpi-users').textContent  = new Set(week.map((r) => r.user)).size.toLocaleString();
    $('kpi-errors').textContent = since(rows, 7).filter((r) => r.event === 'export_error').length.toLocaleString();
    $('kpi-source').textContent = `${web} / ${week.length - web}`;
  }

  function renderUsers() {
    const byUser = new Map();
    since(rows, Number(elRange.value)).forEach((r) => {
      const u = byUser.get(r.user) || { user: r.user, exports: 0, errors: 0, last: '' };
      if (r.event === 'export') u.exports++;
      else u.errors++;
      if (r.server_time > u.last) u.last = r.server_time;
      byUser.set(r.user, u);
    });
    const list = [...byUser.values()].sort((a, b) => b.exports - a.exports || b.last.localeCompare(a.last));

    elUsers.replaceChildren(...list.map((u) => tr([
      cell(u.user),
      cell(u.exports, 'num'),
      cell(u.errors || '', u.errors ? 'num text-error' : 'num'),
      cell(shortTime(u.last), 'muted'),
    ])));
    if (list.length === 0) elUsers.replaceChildren(emptyRow(4));
  }

  function renderLog() {
    const q      = elSearch.value.trim().toLowerCase();
    const event  = elEvent.value;
    const source = elSource.value;
    const list = since(rows, Number(elRange.value)).filter((r) =>
      (!event || r.event === event) &&
      (!source || r.source === source) &&
      (!q || [r.user, r.output_filename, r.input_filename, r.error_message]
        .some((v) => String(v || '').toLowerCase().includes(q))));

    elLog.replaceChildren(...list.map((r) => {
      const isErr = r.event === 'export_error';
      return tr([
        cell(shortTime(r.server_time), 'muted nowrap'),
        cell(r.user),
        pill(isErr ? 'error' : 'export', isErr ? 'pill-error' : 'pill-ok'),
        cell(r.source, 'muted'),
        shiftCell(r.shift),
        cell(r.data_date, 'nowrap'),
        cell(r.row_count, 'num'),
        cell(isErr ? r.error_message : r.output_filename, isErr ? 'text-error clip' : 'clip'),
      ]);
    }));
    if (list.length === 0) elLog.replaceChildren(emptyRow(8));
    elCount.textContent = `${list.length.toLocaleString()} รายการ`;
  }

  // ── DOM helpers (textContent only — values are user-supplied) ──

  function tr(cells) {
    const el = document.createElement('tr');
    el.append(...cells);
    return el;
  }

  function cell(value, cls) {
    const td = document.createElement('td');
    td.textContent = value === null || value === undefined ? '' : String(value);
    if (cls) td.className = cls;
    if (cls && cls.includes('clip')) td.title = td.textContent;
    return td;
  }

  function pill(text, cls) {
    const td = document.createElement('td');
    const span = document.createElement('span');
    span.className = `pill ${cls}`;
    span.textContent = text;
    td.appendChild(span);
    return td;
  }

  function shiftCell(shift) {
    const td = cell(shift === 'Full' ? 'Full Day' : shift);
    if (shift) {
      const dot = document.createElement('span');
      dot.className = `dot dot-${String(shift).toLowerCase()}`;
      td.prepend(dot);
    }
    return td;
  }

  function emptyRow(span) {
    const td = cell('ไม่มีข้อมูลในช่วงนี้', 'empty-cell');
    td.colSpan = span;
    return tr([td]);
  }

  /** 'YYYY-MM-DD HH:mm:ss' → 'MM-DD HH:mm' */
  function shortTime(t) {
    const s = String(t || '');
    return s.length >= 16 ? s.slice(5, 16) : s;
  }

  // ── Wiring ─────────────────────────────────────────────────────

  elRefresh.addEventListener('click', load);
  elSearch.addEventListener('input', render);
  elEvent.addEventListener('change', render);
  elSource.addEventListener('change', render);
  elRange.addEventListener('change', render);

  // Load the first time the Audit view is opened (app.js fires nz:view).
  document.addEventListener('nz:view', (e) => {
    if (e.detail === 'audit' && !rows) load();
  });
})();
