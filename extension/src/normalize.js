/**
 * Normalize raw Vantage alert records -> styled .xlsx.
 * JS port of nozomi/normalize.py + nozomi/config.py, built on xlsx-js-style
 * (global XLSX), sharing the exact format of the nozomi-summary web tool.
 *
 * Exposes window.Normalize with:
 *   buildSingle(records, shift, dateStr)  -> { blob, filename }
 *   buildFullDay(dayRecords, nightRecords, dateStr) -> { blob, filename }
 */

'use strict';

// ── Spec (1:1 with nozomi/config.py) ────────────────────────────
const KEEP_COLUMNS = [
  'id', 'time', 'name', 'type_id', 'description', 'risk',
  'ip_src', 'ip_dst', 'mac_src', 'mac_dst',
  'port_dst', 'port_src', 'protocol', 'transport_protocol', 'site:name',
];

const COLUMN_WIDTHS = [41, 27, 30, 32, 104, 9, 16, 17, 18, 10, 12, 11, 11, 22, 13];

const SHIFT_HEADER_COLOR = { Day: 'E97132', Night: '17375E' };
const SHIFT_STRIPE_COLOR = { Day: 'FFF2E8', Night: 'EBF0F8' };

const FONT_NAME = 'Calibri';
const FONT_SIZE = 11;

// ── Record -> row mapping (port of normalize.py) ────────────────

function formatTime(value) {
  if (value === null || value === undefined || value === '') return null;
  let ms = null;
  if (typeof value === 'number') {
    ms = value;
  } else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    ms = parseInt(value.trim(), 10);
  } else {
    return String(value); // already "YYYY-MM-DD HH:MM:SS +0000"
  }
  const dt = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())} ` +
    `${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:${p(dt.getUTCSeconds())} +0000`
  );
}

function extract(record, column) {
  if (column === 'time') return formatTime(record.time);
  if (column.includes(':')) {
    let cur = record;
    for (const part of column.split(':')) {
      if (cur && typeof cur === 'object' && part in cur) cur = cur[part];
      else { cur = null; break; }
    }
    return cur !== null && cur !== undefined ? cur : (record[column] ?? null);
  }
  return record[column] ?? null;
}

function clean(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isNaN(v)) return null;
  return v;
}

function recordsToRows(records) {
  return records.map((rec) => KEEP_COLUMNS.map((col) => clean(extract(rec, col))));
}

// ── Worksheet building (port of app.js buildCellStyle) ──────────

function cellStyle(kind, shift, col, dataIndex) {
  const headerFill = SHIFT_HEADER_COLOR[shift];
  const border = {
    top:    { style: 'thin', color: { rgb: headerFill } },
    bottom: { style: 'thin', color: { rgb: headerFill } },
    left:   { style: 'thin', color: { rgb: headerFill } },
    right:  { style: 'thin', color: { rgb: headerFill } },
  };
  if (kind === 'spacer') return {};
  if (kind === 'label') {
    return col === 0 ? { font: { name: FONT_NAME, sz: FONT_SIZE, bold: false } } : {};
  }
  if (kind === 'header') {
    return {
      fill: { patternType: 'solid', fgColor: { rgb: headerFill } },
      font: { name: FONT_NAME, sz: FONT_SIZE, bold: true, color: { rgb: 'FFFFFF' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border,
    };
  }
  // data
  const style = { font: { name: FONT_NAME, sz: FONT_SIZE }, border };
  if (dataIndex % 2 === 0) {
    style.fill = { patternType: 'solid', fgColor: { rgb: SHIFT_STRIPE_COLOR[shift] } };
  }
  return style;
}

/**
 * @param {Array<{shift:string, rows:any[][]}>} blocks
 * Stacks each block as: label row, header row, data rows; blank spacer between.
 */
function buildWorksheet(blocks) {
  const layout = []; // { kind, shift, values, dataIndex }
  blocks.forEach((block, bi) => {
    layout.push({
      kind: 'label',
      shift: block.shift,
      values: KEEP_COLUMNS.map((_, i) => (i === 0 ? block.shift : null)),
    });
    layout.push({ kind: 'header', shift: block.shift, values: [...KEEP_COLUMNS] });
    block.rows.forEach((row, i) =>
      layout.push({ kind: 'data', shift: block.shift, dataIndex: i, values: row })
    );
    if (bi < blocks.length - 1) {
      layout.push({ kind: 'spacer', shift: block.shift, values: KEEP_COLUMNS.map(() => null) });
    }
  });

  const aoa = layout.map((l) => l.values);
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  ws['!cols'] = COLUMN_WIDTHS.map((wch) => ({ wch }));

  const nCols = KEEP_COLUMNS.length;
  for (let r = 0; r < layout.length; r++) {
    for (let c = 0; c < nCols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { v: null, t: 'z' };
      ws[addr].s = cellStyle(layout[r].kind, layout[r].shift, c, layout[r].dataIndex);
    }
  }
  return ws;
}

function toBlob(ws, sheetName) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function dayOfMonth(dateStr) {
  return parseInt(dateStr.split('-')[2], 10);
}

// ── Public API ──────────────────────────────────────────────────

function buildSingle(records, shift, dateStr) {
  const ws = buildWorksheet([{ shift, rows: recordsToRows(records) }]);
  return {
    blob: toBlob(ws, `Alert_${dayOfMonth(dateStr)}`),
    filename: `Nozomi_Summary_${dateStr}_${shift}.xlsx`,
  };
}

function buildFullDay(dayRecords, nightRecords, dateStr) {
  const ws = buildWorksheet([
    { shift: 'Day', rows: recordsToRows(dayRecords) },
    { shift: 'Night', rows: recordsToRows(nightRecords) },
  ]);
  return {
    blob: toBlob(ws, `Alert_${dayOfMonth(dateStr)}`),
    filename: `Nozomi_Summary_${dateStr}_Day-Night.xlsx`,
  };
}

window.Normalize = { KEEP_COLUMNS, buildSingle, buildFullDay, recordsToRows };
