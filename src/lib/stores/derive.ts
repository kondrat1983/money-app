// Pure helpers for the ledger views. No Svelte, no IO.
import type { Transaction } from '../model';

export interface Totals {
  income: number;
  /** Magnitude of expenses (>= 0). */
  expense: number;
  balance: number;
}

/** Income / expense / balance of rows. Transfers are excluded from all three. */
export function computeTotals(rows: readonly Transaction[]): Totals {
  let income = 0;
  let expense = 0;
  for (const r of rows) {
    if (r.deleted) continue;
    if (r.type === 'income') income += r.amountMinor;
    else if (r.type === 'expense') expense += -r.amountMinor;
  }
  return { income, expense, balance: income - expense };
}

export interface DayGroup {
  date: string;
  label: string;
  rows: Transaction[];
  /** Net signed sum of the day, transfers excluded. */
  subtotal: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

function utcDay(date: string): number {
  const { y, m, d } = parts(date);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/** 'Today', 'Yesterday', else 'Tue 10 Nov' (year appended when it differs from today's). */
export function dayLabel(date: string, today: string): string {
  const diff = utcDay(today) - utcDay(date);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const { y, m, d } = parts(date);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const base = `${wd} ${d} ${MONTHS[m - 1].slice(0, 3)}`;
  return y === parts(today).y ? base : `${base} ${y}`;
}

/** Newest first: date desc, then createdAt desc. */
export function sortRows(rows: readonly Transaction[]): Transaction[] {
  return [...rows].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1,
  );
}

export function groupByDay(rows: readonly Transaction[], today: string): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const r of sortRows(rows.filter((x) => !x.deleted))) {
    let g = groups[groups.length - 1];
    if (!g || g.date !== r.date) {
      g = { date: r.date, label: dayLabel(r.date, today), rows: [], subtotal: 0 };
      groups.push(g);
    }
    g.rows.push(r);
    if (r.type !== 'transfer') g.subtotal += r.amountMinor;
  }
  return groups;
}

export function monthLabel(month: string): { name: string; year: string } {
  const [y, m] = month.split('-');
  return { name: MONTHS[Number(m) - 1] ?? month, year: y };
}

export function isBigAmount(amountMinor: number, thresholdMinor = 500000): boolean {
  return Math.abs(amountMinor) >= thresholdMinor;
}
