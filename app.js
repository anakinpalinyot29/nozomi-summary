/**
 * Nozomi Summary — app.js
 * Transform Nozomi Vantage .xlsx alert export → formatted Excel summary
 * All processing is local — the file never leaves the browser.
 * Only usage metadata (name, time, filename, row count) is logged via audit.js.
 */

'use strict';

// ============================================================
// Constants (ported from nozomi_transformer.py)
// ============================================================

const KEEP_COLUMNS = [
  'id', 'time', 'name', 'type_id', 'description', 'risk',
  'ip_src', 'ip_dst', 'mac_src', 'mac_dst',
  'port_dst', 'port_src', 'protocol', 'transport_protocol', 'site:name',
];

const COLUMN_WIDTHS = [
  { wch: 41 }, { wch: 27 }, { wch: 30 }, { wch: 32 }, { wch: 104 },
  { wch: 9  }, { wch: 16 }, { wch: 17 }, { wch: 18 }, { wch: 10  },
  { wch: 12 }, { wch: 11 }, { wch: 11 }, { wch: 22 }, { wch: 13  },
];

// Preview: show the first N columns (truncated for readability)
const PREVIEW_COLS   = ['id', 'time', 'name', 'ip_src', 'ip_dst', 'risk', 'site:name'];
const PREVIEW_ROWS   = 5;

// Shift → Excel header background colour (RRGGBB, no #)
const SHIFT_HEADER_COLOR = { Day: 'E97132', Night: '17375E' };
// Alternating stripe colour per shift
const SHIFT_STRIPE_COLOR = { Day: 'FFF2E8', Night: 'EBF0F8' };

const APP_VERSION = '1.1.0';

// Shift windows in Thailand time (UTC+7), same rule as extension/src/shifts.js:
// Day of D = 08:00 D → 20:00 D, Night of D = 20:00 D → 08:00 D+1,
// Full of D = 08:00 D → 08:00 D+1. A shift is labelled by its START date.
const TZ_OFFSET_MS = 7 * 3600 * 1000;
const HOUR_MS      = 3600 * 1000;
const SHIFT_WINDOW = { Day: [8, 12], Night: [20, 12], Full: [8, 24] }; // [startHour, lengthHours]

// ============================================================
// State
// ============================================================

let selectedShift  = 'Day';
let fileBuffer     = null;   // ArrayBuffer of the uploaded file
let inputFilename  = '';     // name of the uploaded file (for audit log)
let rawHeaders     = null;   // string[] — column names from input sheet
let rawRows        = null;   // any[][] — data rows from input sheet
let rowTimes       = null;   // (number|null)[] — epoch ms of each row's 'time'
let outputBlob     = null;   // Blob for download
let outputFilename = '';     // e.g. Nozomi_Summary_2026-04-23_Day.xlsx
let outputMeta     = null;   // { shift, dataDate, rowCount } for audit log
let exportLogged   = false;  // log only the first download of each output

// ============================================================
// DOM References
// ============================================================

const elDropZone       = document.getElementById('drop-zone');
const elFileInput      = document.getElementById('file-input');
const elDzIdle         = document.getElementById('dz-idle');
const elDzSelected     = document.getElementById('dz-selected');
const elSelName        = document.getElementById('sel-name');
const elSelSize        = document.getElementById('sel-size');
const elFileActionRow  = document.getElementById('file-action-row');
const elBtnRemoveFile  = document.getElementById('btn-remove-file');

const elShiftBtnDay    = document.getElementById('btn-shift-day');
const elShiftBtnNight  = document.getElementById('btn-shift-night');
const elShiftBtnFull   = document.getElementById('btn-shift-full');
const elShiftBtns      = [elShiftBtnDay, elShiftBtnNight, elShiftBtnFull];

const elDataDate       = document.getElementById('data-date');
const elDateHint       = document.getElementById('date-hint');
const elPreviewWarn    = document.getElementById('preview-warn');

const elUserChip       = document.getElementById('user-chip');
const elUserChipName   = document.getElementById('user-chip-name');
const elNameDialog     = document.getElementById('name-dialog');
const elNameForm       = document.getElementById('name-form');
const elNameInput      = document.getElementById('name-input');
const elNameCancel     = document.getElementById('name-cancel');

const elWhatsNew       = document.getElementById('whatsnew-dialog');
const elWhatsNewLater  = document.getElementById('whatsnew-later');
const elWhatsNewRead   = document.getElementById('whatsnew-read');

const elPreviewPanel   = document.getElementById('preview-panel');
const elPreviewStats   = document.getElementById('preview-stats');
const elPrevThead      = document.getElementById('prev-thead');
const elPrevTbody      = document.getElementById('prev-tbody');
const elPreviewMore    = document.getElementById('preview-more');

const elBtnTransform   = document.getElementById('btn-transform');

const elSecUpload      = document.getElementById('sec-upload');
const elSecProcessing  = document.getElementById('sec-processing');
const elSecDone        = document.getElementById('sec-done');
const elSecError       = document.getElementById('sec-error');

const elProcDetail     = document.getElementById('proc-detail');
const elDoneFname      = document.getElementById('done-fname');
const elBtnDownload    = document.getElementById('btn-download');
const elBtnAnother     = document.getElementById('btn-another');

const elErrMsg         = document.getElementById('err-msg');
const elBtnTryAnother  = document.getElementById('btn-try-another');

// ============================================================
// Entry Point
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  Audit.configure({ source: 'web', appVersion: APP_VERSION });
  setupDropZone();
  setupShiftToggle();
  setupDateInput();
  setupButtons();
  setupUserName();
  setupWhatsNew();
});

// ============================================================
// What's New (per version; only "read" hides it — other closes
// just dismiss it until the next visit)
// ============================================================

const KEY_WHATSNEW_SEEN = 'nz_whatsnew_seen';

function setupWhatsNew() {
  let seen = null;
  try { seen = localStorage.getItem(KEY_WHATSNEW_SEEN); } catch (e) { /* storage blocked */ }
  if (seen === APP_VERSION) return;

  elWhatsNewLater.addEventListener('click', () => elWhatsNew.close());
  elWhatsNewRead.addEventListener('click', () => {
    try { localStorage.setItem(KEY_WHATSNEW_SEEN, APP_VERSION); } catch (e) { /* ignore */ }
    elWhatsNew.close();
  });
  // Backdrop clicks target the dialog itself; so do clicks on its padding,
  // so only close when the click lands outside the dialog box.
  elWhatsNew.addEventListener('click', (e) => {
    if (e.target !== elWhatsNew) return;
    const r = elWhatsNew.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right &&
                   e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) elWhatsNew.close();
  });

  elWhatsNew.showModal();
  elWhatsNewRead.focus();
}

// ============================================================
// Drop Zone Setup
// ============================================================

function setupDropZone() {
  // Click → open file picker
  elDropZone.addEventListener('click', (e) => {
    if (rawHeaders) return; // already has file — ignore click on selected state
    elFileInput.click();
  });

  // Keyboard accessible
  elDropZone.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !rawHeaders) {
      e.preventDefault();
      elFileInput.click();
    }
  });

  // Browse link inside drop zone
  elDzIdle.querySelector('.dz-browse-link').addEventListener('click', (e) => {
    e.stopPropagation();
    elFileInput.click();
  });

  // File input change
  elFileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
    // Reset so same file can be re-selected after remove
    elFileInput.value = '';
  });

  // Drag events on the whole document to prevent browser from navigating
  document.addEventListener('dragover',  (e) => e.preventDefault());
  document.addEventListener('drop',      (e) => e.preventDefault());

  // Drop zone specific drag events
  elDropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (rawHeaders) return;
    elDropZone.classList.add('drag-over');
  });

  elDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (rawHeaders) return;
    elDropZone.classList.add('drag-over');
    e.dataTransfer.dropEffect = 'copy';
  });

  elDropZone.addEventListener('dragleave', (e) => {
    // Only remove if leaving the drop zone (not entering a child)
    if (!elDropZone.contains(e.relatedTarget)) {
      elDropZone.classList.remove('drag-over');
    }
  });

  elDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    elDropZone.classList.remove('drag-over');
    if (rawHeaders) return;
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
}

// ============================================================
// Shift Toggle
// ============================================================

function setupShiftToggle() {
  elShiftBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedShift = btn.dataset.shift;
      elShiftBtns.forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-pressed', b === btn);
      });
      // Shift changes which date the alerts belong to — re-detect it.
      if (rawRows) {
        detectShiftDate();
        updateRangeWarning();
      }
    });
  });
}

// ============================================================
// Shift Date (auto-detected, user-editable)
// ============================================================

function setupDateInput() {
  elDataDate.addEventListener('change', () => {
    elDateHint.textContent = 'Edited manually';
    updateRangeWarning();
  });
}

/**
 * Fill the date input with the shift date most rows belong to (ties → earlier
 * date), so a few stray alerts from a neighbouring shift don't shift it.
 */
function detectShiftDate() {
  const counts = new Map();
  rowTimes.forEach((t) => {
    if (t === null) return;
    const d = shiftDateOf(t, selectedShift);
    counts.set(d, (counts.get(d) || 0) + 1);
  });
  if (counts.size === 0) {
    elDataDate.value = toISODateStr(new Date(Date.now() + TZ_OFFSET_MS));
    elDateHint.textContent = 'Could not read alert times — please check';
    return;
  }
  const [best] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  elDataDate.value = best[0];
  elDateHint.textContent = 'Auto-detected from alert times · edit if wrong';
}

/** Warn about rows whose time falls outside the selected shift window. */
function updateRangeWarning() {
  const dateStr = elDataDate.value;
  if (!rawRows || !isValidDateStr(dateStr)) {
    elPreviewWarn.classList.add('hidden');
    return;
  }
  const [startMs, endMs] = shiftWindow(dateStr, selectedShift);
  const outside = rowTimes.filter((t) => t === null || t < startMs || t >= endMs).length;
  if (outside === 0) {
    elPreviewWarn.classList.add('hidden');
    return;
  }
  const label = selectedShift === 'Full' ? 'the full day' : `the ${selectedShift} shift`;
  const range = `${formatIctTime(startMs)} – ${formatIctTime(endMs)} (ICT)`;
  const rows  = outside === 1 ? '1 row falls' : `${outside} rows fall`;
  elPreviewWarn.textContent = selectedShift === 'Full'
    ? `⚠️ ${rows} outside ${label} ${range} and will be dropped.`
    : `⚠️ ${rows} outside ${label} ${range}. Still included — check the shift and date.`;
  elPreviewWarn.classList.remove('hidden');
}

// ============================================================
// Buttons
// ============================================================

function setupButtons() {
  elBtnRemoveFile.addEventListener('click', resetUploadState);
  elBtnTransform.addEventListener('click', () => withUserName(startTransform));
  elBtnDownload.addEventListener('click', downloadOutput);
  elBtnAnother.addEventListener('click', resetAll);
  elBtnTryAnother.addEventListener('click', resetAll);
}

// ============================================================
// User Name (asked once before the first export, kept in localStorage)
// ============================================================

let pendingAfterName = null;

function setupUserName() {
  renderUserChip();

  elUserChip.addEventListener('click', () => openNameDialog(null));

  elNameForm.addEventListener('submit', (e) => {
    const name = elNameInput.value.trim();
    if (!name) {
      e.preventDefault();
      return;
    }
    Audit.setUser(name);
    renderUserChip();
    const next = pendingAfterName;
    pendingAfterName = null;
    if (next) setTimeout(next, 0); // after the dialog has closed
  });

  elNameCancel.addEventListener('click', () => {
    pendingAfterName = null;
    elNameDialog.close();
  });

  elNameDialog.addEventListener('cancel', () => { pendingAfterName = null; });
}

function renderUserChip() {
  const name = Audit.getUser();
  elUserChipName.textContent = name;
  elUserChip.classList.toggle('hidden', !name);
}

function openNameDialog(next) {
  pendingAfterName = next;
  elNameInput.value = Audit.getUser();
  elNameDialog.showModal();
  elNameInput.focus();
}

/** Run fn now if we know the user's name, otherwise ask first. */
function withUserName(fn) {
  if (Audit.getUser()) fn();
  else openNameDialog(fn);
}

// ============================================================
// File Handling
// ============================================================

function handleFile(file) {
  inputFilename    = file.name;
  elDataDate.value = ''; // don't report the previous file's date in errors

  // Validate extension
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    showError('Please upload an .xlsx file. This tool only accepts Excel .xlsx format.');
    return;
  }

  const reader = new FileReader();

  reader.onload = (e) => {
    fileBuffer = e.target.result;
    parseAndPreview(file.name, file.size);
  };

  reader.onerror = () => {
    showError('Could not read the file. Please try again.');
    resetUploadState();
  };

  reader.readAsArrayBuffer(file);

  // Show loading state in drop zone while reading
  elSelName.textContent = file.name;
  elSelSize.textContent = formatBytes(file.size);
}

function parseAndPreview(fileName, fileSize) {
  try {
    const data = new Uint8Array(fileBuffer);
    // Parse with the patched reader (see index.html), not the style bundle.
    const wb = XLSX_READ.read(data, { type: 'array', cellDates: true, raw: false });

    // Validate sheet exists
    if (!wb.SheetNames.includes('Vantage export')) {
      showError(
        "Sheet 'Vantage export' not found.\n\nIs this a Nozomi Vantage export file? " +
        "Please export directly from Nozomi Networks Vantage and try again."
      );
      clearSourceData();
      return;
    }

    const ws = wb.Sheets['Vantage export'];
    const aoa = XLSX_READ.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

    if (aoa.length < 2) {
      showError('No alert records found in the file. The sheet appears to be empty.');
      clearSourceData();
      return;
    }

    // First row = headers
    const headers = (aoa[0] || []).map((h) => (h == null ? '' : String(h).trim()));
    const rows    = aoa.slice(1).filter((r) => r.some((v) => v != null && v !== ''));

    // Validate required columns
    const missing = KEEP_COLUMNS.filter((c) => !headers.includes(c));
    if (missing.length > 0) {
      showError(`Missing required columns: ${missing.join(', ')}\n\nAre you sure this is a Nozomi Vantage alert export?`);
      clearSourceData();
      return;
    }

    if (rows.length === 0) {
      showError('No alert records found in the file.');
      clearSourceData();
      return;
    }

    rawHeaders = headers;
    rawRows    = rows;
    const timeIdx = headers.indexOf('time');
    rowTimes   = rows.map((r) => parseTimeMs(r[timeIdx]));

    // Show file-selected state
    elSelName.textContent = fileName;
    elSelSize.textContent = formatBytes(fileSize);
    setDropZoneSelected(true);

    // Build preview
    buildPreview(headers, rows);

    // Show transform button
    elBtnTransform.classList.remove('hidden');

  } catch (err) {
    showError(
      'Failed to parse the file.\n\n' +
      'Please make sure it is a valid Nozomi Vantage .xlsx export and not password-protected.'
    );
    clearSourceData();
  }
}

// ============================================================
// Preview
// ============================================================

function buildPreview(headers, rows) {
  elPreviewStats.textContent = `${rows.length} record${rows.length !== 1 ? 's' : ''} found`;
  detectShiftDate();
  updateRangeWarning();

  // Build header row (preview columns only)
  const previewCols = PREVIEW_COLS.filter((c) => headers.includes(c));
  elPrevThead.innerHTML = '';
  previewCols.forEach((col) => {
    const th = document.createElement('th');
    th.textContent = col;
    elPrevThead.appendChild(th);
  });

  // Build data rows (first PREVIEW_ROWS)
  elPrevTbody.innerHTML = '';
  const displayRows = rows.slice(0, PREVIEW_ROWS);
  displayRows.forEach((row) => {
    const tr = document.createElement('tr');
    previewCols.forEach((col) => {
      const idx = headers.indexOf(col);
      const td = document.createElement('td');
      const val = idx >= 0 ? row[idx] : null;
      td.textContent = formatCellValue(val);
      td.title = td.textContent;
      tr.appendChild(td);
    });
    elPrevTbody.appendChild(tr);
  });

  if (rows.length > PREVIEW_ROWS) {
    elPreviewMore.textContent = `…and ${rows.length - PREVIEW_ROWS} more row${rows.length - PREVIEW_ROWS !== 1 ? 's' : ''}`;
  } else {
    elPreviewMore.textContent = '';
  }

  elPreviewPanel.classList.remove('hidden');
}

// ============================================================
// Transform
// ============================================================

async function startTransform() {
  if (!rawHeaders || !rawRows || rawRows.length === 0) return;

  const dateStr = elDataDate.value;
  if (!isValidDateStr(dateStr)) {
    elDataDate.focus();
    elDateHint.textContent = 'Please pick a valid date';
    return;
  }

  const rowCount = rawRows.length;

  // Switch to processing state
  showSection(elSecProcessing);
  elProcDetail.textContent = `Processing ${rowCount.toLocaleString()} row${rowCount !== 1 ? 's' : ''}…`;

  // Yield to browser so processing-state renders before blocking computation
  await rafDelay();
  await rafDelay();

  try {
    const result = buildOutputWorkbook(rawHeaders, rawRows, rowTimes, selectedShift, dateStr);
    outputBlob     = new Blob([result.buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    outputFilename = result.filename;
    outputMeta     = { shift: selectedShift, dataDate: dateStr, rowCount: result.rowCount };
    exportLogged   = false;

    // Clear source data from memory
    clearSourceData();

    // Show done state
    elDoneFname.textContent = outputFilename;
    showSection(elSecDone);

  } catch (err) {
    clearSourceData();
    showError(err.message || 'Transform failed. Please try again.');
  }
}

// ============================================================
// Build Output Workbook (SheetJS)
// ============================================================

/**
 * Day/Night: one block with every row (original behaviour).
 * Full: a Day block then a Night block, split by alert time; rows outside
 * the 24h window are dropped. Same layout as the extension's buildFullDay.
 */
function buildOutputWorkbook(headers, rows, times, shift, dateStr) {
  const toOutputRow = (row) =>
    KEEP_COLUMNS.map((col) => {
      const idx = headers.indexOf(col);
      if (idx < 0) return null;
      return cleanValue(row[idx]);
    });

  let blocks;
  let rowCount;
  if (shift === 'Full') {
    const pick = (s) => {
      const [startMs, endMs] = shiftWindow(dateStr, s);
      return rows.filter((_, i) => times[i] !== null && times[i] >= startMs && times[i] < endMs);
    };
    const dayRows   = pick('Day');
    const nightRows = pick('Night');
    blocks   = [
      { shift: 'Day',   rows: dayRows.map(toOutputRow) },
      { shift: 'Night', rows: nightRows.map(toOutputRow) },
    ];
    rowCount = `${dayRows.length + nightRows.length} (D ${dayRows.length} / N ${nightRows.length})`;
  } else {
    blocks   = [{ shift, rows: rows.map(toOutputRow) }];
    rowCount = rows.length;
  }

  const dayOfMonth = parseInt(dateStr.slice(8, 10), 10);
  const sheetName  = `Alert_${dayOfMonth}`;
  const filename   = `Nozomi_Summary_${dateStr}_${shift === 'Full' ? 'Day-Night' : shift}.xlsx`;

  // ── Build AoA ────────────────────────────────────────────
  // Per block: shift label in column A, column headers, data rows;
  // a blank spacer row between blocks.
  const layout = []; // { kind, shift, values, dataIndex }
  blocks.forEach((block, bi) => {
    layout.push({ kind: 'label', shift: block.shift,
      values: KEEP_COLUMNS.map((_, i) => (i === 0 ? block.shift : null)) });
    layout.push({ kind: 'header', shift: block.shift, values: [...KEEP_COLUMNS] });
    block.rows.forEach((values, i) =>
      layout.push({ kind: 'data', shift: block.shift, dataIndex: i, values }));
    if (bi < blocks.length - 1) {
      layout.push({ kind: 'spacer', shift: block.shift, values: KEEP_COLUMNS.map(() => null) });
    }
  });

  // ── Create worksheet ─────────────────────────────────────
  const ws = XLSX.utils.aoa_to_sheet(layout.map((l) => l.values), { cellDates: true });

  // Column widths
  ws['!cols'] = COLUMN_WIDTHS;

  // ── Apply cell styles ────────────────────────────────────
  const nCols = KEEP_COLUMNS.length;

  for (let r = 0; r < layout.length; r++) {
    for (let c = 0; c < nCols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });

      // Ensure cell object exists
      if (!ws[addr]) {
        ws[addr] = { v: null, t: 'z' };
      }

      ws[addr].s = buildCellStyle(layout[r], c);
    }
  }

  // ── Assemble workbook ────────────────────────────────────
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

  return { buffer, filename, rowCount };
}

/**
 * Return a SheetJS style object for one cell of a layout row
 * (label → header → data rows, striped from the first data row).
 */
function buildCellStyle(row, c) {
  const headerFill = SHIFT_HEADER_COLOR[row.shift];
  const border = {
    top:    { style: 'thin', color: { rgb: headerFill } },
    bottom: { style: 'thin', color: { rgb: headerFill } },
    left:   { style: 'thin', color: { rgb: headerFill } },
    right:  { style: 'thin', color: { rgb: headerFill } },
  };

  if (row.kind === 'spacer') return {};

  if (row.kind === 'label') {
    return c === 0
      ? { font: { name: 'Calibri', sz: 11, bold: false } }
      : {};
  }

  if (row.kind === 'header') {
    return {
      fill: { patternType: 'solid', fgColor: { rgb: headerFill } },
      font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border,
    };
  }

  const isStripe = (row.dataIndex % 2 === 0);
  const style = { font: { name: 'Calibri', sz: 11 }, border };
  if (isStripe) {
    style.fill = { patternType: 'solid', fgColor: { rgb: SHIFT_STRIPE_COLOR[row.shift] } };
  }
  return style;
}

// ============================================================
// Download + Memory Cleanup
// ============================================================

function downloadOutput() {
  if (!outputBlob) return;

  const url = URL.createObjectURL(outputBlob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = outputFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Revoke after download has a chance to start
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 2000);

  if (!exportLogged && outputMeta) {
    exportLogged = true;
    Audit.log({
      event:           'export',
      output_filename: outputFilename,
      shift:           outputMeta.shift,
      data_date:       outputMeta.dataDate,
      row_count:       outputMeta.rowCount,
      input_filename:  inputFilename,
    });
  }
}

function clearSourceData() {
  fileBuffer  = null;
  rawHeaders  = null;
  rawRows     = null;
  rowTimes    = null;
}

function clearOutputData() {
  outputBlob     = null;
  outputFilename = '';
  outputMeta     = null;
}

// ============================================================
// UI State Management
// ============================================================

function showSection(section) {
  [elSecUpload, elSecProcessing, elSecDone, elSecError].forEach((s) => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });
  section.classList.remove('hidden');
  section.classList.add('active');
}

function showError(message) {
  elErrMsg.textContent = message;
  showSection(elSecError);

  Audit.log({
    event:          'export_error',
    shift:          selectedShift,
    data_date:      isValidDateStr(elDataDate.value) ? elDataDate.value : '',
    input_filename: inputFilename,
    error_message:  message,
  });
}

function setDropZoneSelected(isSelected) {
  if (isSelected) {
    elDropZone.classList.add('file-selected');
    elDzIdle.classList.add('hidden');
    elDzSelected.classList.remove('hidden');
    elFileActionRow.classList.remove('hidden');
  } else {
    elDropZone.classList.remove('file-selected');
    elDzIdle.classList.remove('hidden');
    elDzSelected.classList.add('hidden');
    elFileActionRow.classList.add('hidden');
  }
}

function resetUploadState() {
  // Reset file-specific state but keep shift selection
  clearSourceData();
  clearOutputData();

  setDropZoneSelected(false);
  elPreviewPanel.classList.add('hidden');
  elBtnTransform.classList.add('hidden');

  // Clear preview tables
  elPrevThead.innerHTML = '';
  elPrevTbody.innerHTML = '';
  elPreviewStats.textContent = '';
  elPreviewMore.textContent  = '';
  elPreviewWarn.classList.add('hidden');
  elDataDate.value = '';
  elDateHint.textContent = '';
}

function resetAll() {
  clearSourceData();
  clearOutputData();

  resetUploadState();
  showSection(elSecUpload);
}

// ============================================================
// Utility Helpers
// ============================================================

/**
 * Parse a Nozomi time cell value to epoch ms (UTC).
 * Handles: string "2026-04-23 12:29:54 +0000", JS Date, Excel serial number.
 */
function parseTimeMs(val) {
  if (val === null || val === undefined || val === '') return null;

  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : val.getTime();
  }

  if (typeof val === 'string') {
    const m = val.trim().match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/
    );
    if (!m) return null;
    const [, y, mo, d, h, mi, sec, tz] = m;
    let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec);
    if (tz && tz !== 'Z') {
      const sign = tz[0] === '-' ? -1 : 1;
      const digits = tz.replace(':', '');
      ms -= sign * (parseInt(digits.slice(1, 3), 10) * 60 + parseInt(digits.slice(3, 5), 10)) * 60000;
    }
    return ms;
  }

  if (typeof val === 'number' && isFinite(val)) {
    // Excel serial date (days since 1900-01-01, with Lotus-1-2-3 leap year bug)
    return Math.round((val - 25569) * 86400 * 1000);
  }

  return null;
}

/**
 * [startMs, endMs) of a shift on Thailand date dateStr ('YYYY-MM-DD').
 */
function shiftWindow(dateStr, shift) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [startHour, hours] = SHIFT_WINDOW[shift];
  const startMs = Date.UTC(y, m - 1, d, startHour) - TZ_OFFSET_MS;
  return [startMs, startMs + hours * HOUR_MS];
}

/**
 * The shift date an alert at epoch ms belongs to. Night and Full shifts
 * run past midnight, so 00:00–07:59 ICT belongs to the previous day's shift.
 */
function shiftDateOf(ms, shift) {
  const ict = new Date(ms + TZ_OFFSET_MS); // read with UTC getters = ICT wall clock
  if (shift !== 'Day' && ict.getUTCHours() < 8) {
    ict.setUTCDate(ict.getUTCDate() - 1);
  }
  return toISODateStr(ict);
}

function isValidDateStr(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

/**
 * Format a Date as "YYYY-MM-DD" using UTC components.
 */
function toISODateStr(d) {
  const yyyy = d.getUTCFullYear();
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Format epoch ms as "YYYY-MM-DD HH:MM" in Thailand time.
 */
function formatIctTime(ms) {
  const d = new Date(ms + TZ_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${toISODateStr(d)} ${hh}:${mi}`;
}

/**
 * Convert null, undefined, NaN to null (so cells render as blank, not "NaN").
 */
function cleanValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && isNaN(v)) return null;
  return v;
}

/**
 * Format a cell value for display in the preview table.
 */
function formatCellValue(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().replace('T', ' ').slice(0, 19);
  return String(v);
}

/**
 * Human-readable file size.
 */
function formatBytes(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Defer one animation frame — allows the browser to repaint before heavy sync work.
 */
function rafDelay() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
