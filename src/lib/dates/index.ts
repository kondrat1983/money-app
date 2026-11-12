// Local-calendar date helpers. Contract: docs/ARCHITECTURE.md §1 (dates row).
// Calendar dates ('YYYY-MM-DD', 'YYYY-MM') are device-local and never derived via toISOString().
// Timestamps are full ISO 8601 UTC strings with milliseconds.

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YM_RE = /^(\d{4})-(\d{2})$/;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(0);
  dt.setUTCFullYear(y, m - 1, d);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function parseYm(month: string): { y: number; m: number } {
  const match = YM_RE.exec(month);
  const m = match ? Number(match[2]) : NaN;
  if (!match || m < 1 || m > 12) throw new RangeError(`invalid month: ${month}`);
  return { y: Number(match[1]), m };
}

/** Today's date in the device timezone, as 'YYYY-MM-DD'. */
export function todayLocal(): string {
  const d = new Date();
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Month of a calendar date, as 'YYYY-MM'.
 * A string must be a valid 'YYYY-MM-DD'. A Date is read in the device timezone.
 * @throws RangeError on an invalid string or Date.
 */
export function monthOf(date: string | Date): string {
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) throw new RangeError('invalid Date');
    return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}`;
  }
  const match = YMD_RE.exec(date);
  if (!match || !isValidYmd(Number(match[1]), Number(match[2]), Number(match[3]))) {
    throw new RangeError(`invalid date: ${date}`);
  }
  return date.slice(0, 7);
}

/**
 * String bounds for a month, for range queries on 'YYYY-MM-DD' values.
 * `monthRange('2026-11')` -> `['2026-11-01', '2026-11-31']`. Day 31 is a safe upper bound in every month,
 * because no real date sorts after it within the same month prefix.
 * @throws RangeError if `month` is not 'YYYY-MM' with a month 01..12.
 */
export function monthRange(month: string): [string, string] {
  parseYm(month);
  return [`${month}-01`, `${month}-31`];
}

/**
 * Shifts a 'YYYY-MM' month by `n` months (negative allowed), rolling over year boundaries.
 * `addMonths('2026-12', 1)` -> `'2027-01'`; `addMonths('2026-01', -1)` -> `'2025-12'`.
 * @throws RangeError if `month` is invalid, `n` is not an integer, or the result leaves years 0000..9999.
 */
export function addMonths(month: string, n: number): string {
  const { y, m } = parseYm(month);
  if (!Number.isInteger(n)) throw new RangeError(`months must be an integer, got ${n}`);
  const index = y * 12 + (m - 1) + n;
  const ny = Math.floor(index / 12);
  const nm = index - ny * 12 + 1;
  if (ny < 0 || ny > 9999) throw new RangeError('month out of range');
  return `${pad(ny, 4)}-${pad(nm)}`;
}

/** Current instant as an ISO 8601 UTC string with milliseconds, e.g. '2026-11-12T10:15:30.123Z'. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * A timestamp strictly after `prev`, never earlier than the clock:
 * `max(Date.now(), Date.parse(prev) + 1 ms)`, as ISO UTC. Keeps a record's `updatedAt` strictly increasing
 * even when the device clock is behind. If `prev` is not parseable, the clock value is used.
 */
export function nextIso(prev: string): string {
  const now = Date.now();
  const p = Date.parse(prev);
  const t = Number.isNaN(p) ? now : Math.max(now, p + 1);
  return new Date(t).toISOString();
}

/**
 * Normalizes a date from the export file, 'YYYY-M-D' (e.g. '2026-1-9'), to 'YYYY-MM-DD'.
 * Surrounding whitespace is ignored.
 * @throws Error on a bad shape or a non-existent calendar date (e.g. '2026-2-30', '2026-2-29').
 */
export function parseExportDate(s: string): string {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim());
  if (!match) throw new Error(`invalid export date: ${s}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!isValidYmd(y, m, d)) throw new Error(`invalid calendar date: ${s}`);
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}
