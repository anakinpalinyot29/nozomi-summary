/**
 * Shift -> time-window logic. JS port of nozomi/shifts.py.
 *
 * Day   of date D = 08:00 D -> 20:00 D      (Thailand, UTC+7)
 * Night of date D = 20:00 D -> 08:00 D+1    (Thailand, UTC+7)
 * A shift is labelled by its START date. Windows are epoch-ms (UTC):
 * start inclusive (>=), end exclusive (<) — matching the Vantage API.
 */

'use strict';

const TZ_OFFSET_HOURS = 7;
const TZ_OFFSET_MS = TZ_OFFSET_HOURS * 3600 * 1000;
const HALF_DAY_MS = 12 * 3600 * 1000;

/**
 * @param {string} dateStr  ISO 'YYYY-MM-DD'
 * @param {'Day'|'Night'} shift
 * @returns {[number, number]} [startMs, endMs]
 */
function shiftWindow(dateStr, shift) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const startHour = shift === 'Day' ? 8 : 20;
  // Date.UTC treats args as UTC; subtract the +7 offset to get the real UTC
  // instant for that Thailand wall-clock time.
  const startMs = Date.UTC(y, m - 1, d, startHour, 0, 0) - TZ_OFFSET_MS;
  return [startMs, startMs + HALF_DAY_MS];
}

function isValidDate(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !Number.isNaN(Date.parse(dateStr));
}

window.Shifts = { shiftWindow, isValidDate, VALID_SHIFTS: ['Day', 'Night'] };
