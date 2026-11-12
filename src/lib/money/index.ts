// Minor-unit (kopiyky) math, parsing and formatting. Contract: docs/ARCHITECTURE.md §1 (money row).
// No dependencies, so the type of a transaction is written structurally here, not imported from model.

export type MoneyTxType = 'expense' | 'income' | 'transfer';

// Accepts an optional sign, then digits with at most one decimal separator (',' or '.').
// Any whitespace (incl. NBSP U+00A0 and narrow NBSP U+202F) is removed before matching.
const AMOUNT_RE = /^([+\-−])?(\d*)(?:[.,](\d*))?$/;

/**
 * Parses a hand-typed or exported amount into a magnitude in minor units (kopiyky).
 *
 * - The sign is discarded: the result is always >= 0. Direction comes from the transaction type (`signFor`).
 * - Decimal separator: ',' or '.' (`'420,50'`, `'420.5'`). Thousands separators are not a decimal separator:
 *   `'1,000.50'` is rejected.
 * - Spaces of any kind are ignored: `'-20 002'`, `'-20 002'`, `'20 002,00'` all parse.
 * - More than two decimals are rounded half-up to the kopiyka: `'0.499'` -> 50, `'0.004'` -> 0.
 * - Returns `null` for anything else (garbage, empty, exponent notation, values beyond safe integers).
 */
export function parseAmountInput(s: string): number | null {
  if (typeof s !== 'string') return null;
  const cleaned = s.replace(/\s/g, '');
  const m = AMOUNT_RE.exec(cleaned);
  if (!m) return null;
  const intDigits = m[2] ?? '';
  const fracDigits = m[3] ?? '';
  if (intDigits.length === 0 && fracDigits.length === 0) return null;

  const whole = intDigits.length ? Number(intDigits) : 0;
  const cents = Number(fracDigits.slice(0, 2).padEnd(2, '0'));
  const roundUp = fracDigits.length > 2 && fracDigits.charCodeAt(2) >= 53; // third digit >= '5'
  const minor = whole * 100 + cents + (roundUp ? 1 : 0);
  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * Signed minor amount for a transaction type.
 * expense -> negative, income -> positive, transfer -> negative when `transferOut` (money leaves the wallet),
 * positive otherwise.
 * @throws RangeError if `magnitudeMinor` is not a positive integer, or the type is unknown.
 */
export function signFor(type: MoneyTxType, magnitudeMinor: number, transferOut = true): number {
  if (!Number.isInteger(magnitudeMinor) || magnitudeMinor <= 0) {
    throw new RangeError(`magnitude must be a positive integer, got ${magnitudeMinor}`);
  }
  switch (type) {
    case 'expense':
      return -magnitudeMinor;
    case 'income':
      return magnitudeMinor;
    case 'transfer':
      return transferOut ? -magnitudeMinor : magnitudeMinor;
    default:
      throw new RangeError(`unknown transaction type: ${String(type)}`);
  }
}

/**
 * Formats integer minor units as UAH for display.
 *
 * - Decimal separator is a COMMA (Ukrainian convention): `42050 -> "420,50"`.
 * - Thousands are grouped with NBSP (U+00A0): `2000200 -> "20 002"`, `12345678 -> "123 456,78"`.
 * - Kopiyky are shown only when non-zero, always as two digits: `42000 -> "420"`, `42005 -> "420,05"`.
 * - Negative values always get an ASCII "-" prefix (never U+2212).
 * - `{ sign: true }` adds "+" to positive values. Zero never gets a sign.
 * @throws RangeError if `minor` is not a safe integer.
 */
export function formatMinor(minor: number, o?: { sign?: boolean }): string {
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`minor must be a safe integer, got ${minor}`);
  }
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 100);
  const kop = abs % 100;
  const grouped = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const body = kop === 0 ? grouped : `${grouped},${String(kop).padStart(2, '0')}`;
  if (minor < 0) return `-${body}`;
  if (minor > 0 && o?.sign) return `+${body}`;
  return body;
}

/**
 * Exact sum of integer minor amounts.
 * @throws RangeError if any element is not an integer, or the sum leaves the safe-integer range.
 */
export function sumMinor(xs: number[]): number {
  let total = 0;
  for (const x of xs) {
    if (!Number.isInteger(x)) throw new RangeError(`sumMinor: non-integer value ${x}`);
    total += x;
  }
  if (!Number.isSafeInteger(total)) throw new RangeError('sumMinor: result out of safe-integer range');
  return total;
}
