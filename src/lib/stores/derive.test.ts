import { describe, expect, it } from 'vitest';
import type { Transaction } from '../model';
import { computeTotals, dayLabel, groupByDay, isBigAmount, monthLabel } from './derive';

let n = 0;
function tx(p: Partial<Transaction>): Transaction {
  n++;
  return {
    id: `id-${n}`,
    date: '2026-11-10',
    type: 'expense',
    category: 'food',
    memo: '',
    amountMinor: -100,
    createdAt: `2026-11-10T10:00:00.${String(n).padStart(3, '0')}Z`,
    updatedAt: '2026-11-10T10:00:00.000Z',
    deleted: false,
    rev: 0,
    ...p,
  };
}

describe('computeTotals', () => {
  it('excludes transfers and tombstones', () => {
    const t = computeTotals([
      tx({ type: 'income', amountMinor: 5000000 }),
      tx({ amountMinor: -64000 }),
      tx({ amountMinor: -1000 }),
      tx({ type: 'transfer', amountMinor: -999999 }),
      tx({ type: 'transfer', amountMinor: 12345 }),
      tx({ amountMinor: -777, deleted: true }),
    ]);
    expect(t).toEqual({ income: 5000000, expense: 65000, balance: 4935000 });
  });
  it('goes negative', () => {
    expect(computeTotals([tx({ amountMinor: -500 })]).balance).toBe(-500);
  });
  it('is zero for no rows', () => {
    expect(computeTotals([])).toEqual({ income: 0, expense: 0, balance: 0 });
  });
});

describe('dayLabel', () => {
  it('names relative days and weekdays', () => {
    expect(dayLabel('2026-11-12', '2026-11-12')).toBe('Today');
    expect(dayLabel('2026-11-11', '2026-11-12')).toBe('Yesterday');
    expect(dayLabel('2026-11-10', '2026-11-12')).toBe('Tue 10 Nov');
    expect(dayLabel('2026-10-31', '2026-11-01')).toBe('Yesterday');
    expect(dayLabel('2025-12-31', '2026-11-12')).toBe('Wed 31 Dec 2025');
  });
});

describe('groupByDay', () => {
  it('groups newest first with subtotals excluding transfers', () => {
    const rows = [
      tx({ date: '2026-11-10', amountMinor: -100 }),
      tx({ date: '2026-11-12', amountMinor: -300 }),
      tx({ date: '2026-11-10', type: 'income', amountMinor: 1000 }),
      tx({ date: '2026-11-10', type: 'transfer', amountMinor: -5000 }),
      tx({ date: '2026-11-12', amountMinor: -50, createdAt: '2026-11-12T23:00:00.000Z' }),
    ];
    const g = groupByDay(rows, '2026-11-12');
    expect(g.map((x) => [x.label, x.rows.length, x.subtotal])).toEqual([
      ['Today', 2, -350],
      ['Tue 10 Nov', 3, 900],
    ]);
    expect(g[0].rows[0].amountMinor).toBe(-50);
  });
  it('is empty for no rows', () => {
    expect(groupByDay([], '2026-11-12')).toEqual([]);
  });
});

describe('misc', () => {
  it('monthLabel', () => expect(monthLabel('2026-03')).toEqual({ name: 'March', year: '2026' }));
  it('isBigAmount uses magnitude', () => {
    expect(isBigAmount(-500000)).toBe(true);
    expect(isBigAmount(-499999)).toBe(false);
    expect(isBigAmount(600000)).toBe(true);
  });
});
