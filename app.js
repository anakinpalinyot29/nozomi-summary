/**
 * Nozomi Summary — app.js
 * Transform Nozomi Vantage .xlsx alert export → formatted Excel summary
 * All processing is local — zero network uploads.
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

// ============================================================
// State
// ============================================================

let selectedShift  = 'Day';
let fileBuffer     = null;   // ArrayBuffer of the uploaded file
let rawHeaders     = null;   // string[] — column names from input sheet
let rawRows        = null;   // any[][] — data rows from input sheet
let outputBlob     = null;   // Blob for download
let outputFilename = '';     // e.g. Nozomi_Summary_2026-04-23_Day.xlsx

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
  setupDropZone();
  setupShiftToggle();
  setupButtons();
});

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
  [elShiftBtnDay, elShiftBtnNight].forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedShift = btn.dataset.shift;
      elShiftBtnDay.classList.toggle('active', selectedShift === 'Day');
      elShiftBtnNight.classList.toggle('active', selectedShift === 'Night');
      elShiftBtnDay.setAttribute('aria-pressed', selectedShift === 'Day');
      elShiftBtnNight.setAttribute('aria-pressed', selectedShift === 'Night');
    });
  });
}

// ============================================================
// Buttons
// ============================================================

function setupButtons() {
  elBtnRemoveFile.addEventListener('click', resetUploadState);
  elBtnTransform.addEventListener('click', startTransform);
  elBtnDownload.addEventListener('click', downloadOutput);
  elBtnAnother.addEventListener('click', resetAll);
  elBtnTryAnother.addEventListener('click', resetAll);
}

// ============================================================
// File Handling
// ============================================================

function handleFile(file) {
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
    const wb = XLSX.read(data, { type: 'array', cellDates: true, raw: false });

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
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

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
  // Detect date from 'time' column
  const timeIdx = headers.indexOf('time');
  let dateLabel = '';
  if (timeIdx >= 0 && rows.length > 0) {
    const d = extractDate(rows[0][timeIdx]);
    if (d) dateLabel = `· Date: ${formatDate(d)}`;
  }

  elPreviewStats.textContent = `${rows.length} record${rows.length !== 1 ? 's' : ''} found ${dateLabel}`;

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

  const rowCount = rawRows.length;

  // Switch to processing state
  showSection(elSecProcessing);
  elProcDetail.textContent = `Processing ${rowCount.toLocaleString()} row${rowCount !== 1 ? 's' : ''}…`;

  // Yield to browser so processing-state renders before blocking computation
  await rafDelay();
  await rafDelay();

  try {
    const result = buildOutputWorkbook(rawHeaders, rawRows, selectedShift);
    outputBlob     = new Blob([result.buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    outputFilename = result.filename;

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

function buildOutputWorkbook(headers, rows, shift) {
  // ── Detect date ──────────────────────────────────────────
  const timeIdx = headers.indexOf('time');
  let dateStr    = toISODateStr(new Date());
  let dayOfMonth = new Date().getUTCDate();

  if (timeIdx >= 0 && rows.length > 0) {
    const d = extractDate(rows[0][timeIdx]);
    if (d) {
      dateStr    = toISODateStr(d);
      dayOfMonth = d.getUTCDate();
    }
  }

  const sheetName = `Alert_${dayOfMonth}`;
  const filename  = `Nozomi_Summary_${dateStr}_${shift}.xlsx`;

  // ── Build AoA ────────────────────────────────────────────
  // Row 0 (A1): shift label in column A, rest blank
  const labelRow = KEEP_COLUMNS.map((_, i) => (i === 0 ? shift : null));

  // Row 1: column headers
  const headerRow = [...KEEP_COLUMNS];

  // Rows 2+: data
  const dataRows = rows.map((row) =>
    KEEP_COLUMNS.map((col) => {
      const idx = headers.indexOf(col);
      if (idx < 0) return null;
      return cleanValue(row[idx]);
    })
  );

  const aoa = [labelRow, headerRow, ...dataRows];

  // ── Create worksheet ─────────────────────────────────────
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });

  // Column widths
  ws['!cols'] = COLUMN_WIDTHS;

  // ── Apply cell styles ────────────────────────────────────
  const headerFill = SHIFT_HEADER_COLOR[shift];
  const stripeFill = SHIFT_STRIPE_COLOR[shift];
  const nCols      = KEEP_COLUMNS.length;
  const nRows      = aoa.length;

  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });

      // Ensure cell object exists
      if (!ws[addr]) {
        ws[addr] = { v: null, t: 'z' };
      }

      ws[addr].s = buildCellStyle(r, c, headerFill, stripeFill, headerFill);
    }
  }

  // ── Assemble workbook ────────────────────────────────────
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

  return { buffer, filename };
}

/**
 * Return a SheetJS style object for the given row/col position.
 * r=0 → label row, r=1 → header, r≥2 → data
 */
function buildCellStyle(r, c, headerFill, stripeFill, borderColor) {
  const border = {
    top:    { style: 'thin', color: { rgb: borderColor } },
    bottom: { style: 'thin', color: { rgb: borderColor } },
    left:   { style: 'thin', color: { rgb: borderColor } },
    right:  { style: 'thin', color: { rgb: borderColor } },
  };

  if (r === 0) {
    return c === 0
      ? { font: { name: 'Calibri', sz: 11, bold: false } }
      : {};
  }

  if (r === 1) {
    return {
      fill: { patternType: 'solid', fgColor: { rgb: headerFill } },
      font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border,
    };
  }

  const isStripe = (r % 2 === 0);
  const style = { font: { name: 'Calibri', sz: 11 }, border };
  if (isStripe) {
    style.fill = { patternType: 'solid', fgColor: { rgb: stripeFill } };
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
}

function clearSourceData() {
  fileBuffer  = null;
  rawHeaders  = null;
  rawRows     = null;
}

function clearOutputData() {
  outputBlob     = null;
  outputFilename = '';
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
 * Attempt to extract a Date from a Nozomi time cell value.
 * Handles: string "2026-04-23 12:29:54 +0000", JS Date, Excel serial number.
 */
function extractDate(val) {
  if (!val) return null;

  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : val;
  }

  if (typeof val === 'string') {
    // Match leading "YYYY-MM-DD"
    const m = val.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) {
      return new Date(m[1] + 'T00:00:00Z');
    }
  }

  if (typeof val === 'number' && isFinite(val)) {
    // Excel serial date (days since 1900-01-01, with Lotus-1-2-3 leap year bug)
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
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
 * Format a Date as human-readable "2026-04-23" (same as toISODateStr but kept separate for display).
 */
function formatDate(d) {
  return toISODateStr(d);
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
