import { describe, expect, it } from 'vitest';
import type { Category, Transaction } from '../src/lib/model/index.ts';
import { MemorySheet } from '../src/lib/bridge/mock.ts';
import type { Deps } from './core.ts';
import { CAT_SHEET, LockBusyError, TX_SHEET, handleRequest, onEditCore, setupCore } from './core.ts';

const TOKEN = 'test-token-not-real';
const T0 = Date.parse('2026-11-12T10:00:00.000Z');

function setup(now = { t: T0 }, busy = false) {
  const sheet = new MemorySheet();
  const deps: Deps = {
    sheet, getToken: () => TOKEN, now: () => now.t, uuid: () => '11111111-1111-4111-8111-111111111111',
    lock: { run: (fn) => { if (busy) throw new LockBusyError(); return fn(); } },
  };
  setupCore({ setup: sheet, sheet, getToken: () => TOKEN, setToken: () => {}, randomBytes32: () => new Uint8Array(32) });
  const call = (action: string, params: Record<string, unknown> = {}, token: string | null = TOKEN) =>
    handleRequest(JSON.stringify({ v: 1, ...(token === null ? {} : { token }), action, ...params }), deps) as any;
  return { sheet, deps, call, now };
}

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tx = (n: number, o: Partial<Transaction> = {}): Transaction => ({
  id: uid(n), date: '2026-11-12', type: 'expense', category: 'food', memo: 'lunch', amountMinor: -12345,
  createdAt: '2026-11-12T09:00:00.000Z', updatedAt: '2026-11-12T09:00:00.000Z', deleted: false, rev: 0, ...o,
});
const cat = (id: string, o: Partial<Category> = {}): Category => ({
  id, name: 'Food', kind: 'expense', icon: 'coin', color: '#112233', order: 1, archived: false,
  updatedAt: '2026-11-12T09:00:00.000Z', rev: 0, ...o,
});
const pushTx = (call: ReturnType<typeof setup>['call'], ...recs: Transaction[]) =>
  call('push', { ops: recs.map((record) => ({ entity: 'tx', record })) });

describe('setupCore', () => {
  it('creates headers, settings and a token once', () => {
    const sheet = new MemorySheet();
    let tok: string | null = null;
    const d = { setup: sheet, sheet, getToken: () => tok, setToken: (t: string) => { tok = t; }, randomBytes32: () => new Uint8Array(32).fill(255) };
    const r = setupCore(d);
    expect(r.token).toBe('_'.repeat(42) + '8');
    expect(setupCore(d).token).toBeNull();
    expect(sheet.readAll('Transactions')[0]).toHaveLength(10);
    expect(sheet.readAll('Subscriptions')[0]).toHaveLength(11);
    expect(sheet.readAll('Settings')).toEqual([['key', 'value'], ['schemaVersion', 1], ['currency', 'UAH'], ['bigAmountMinor', 500000]]);
  });
});

describe('envelope and auth', () => {
  it('ping works', () => {
    const { call } = setup();
    expect(call('ping')).toMatchObject({ ok: true, v: 1, schemaVersion: 1, head: 0, serverTime: '2026-11-12T10:00:00.000Z' });
  });
  it('missing and wrong token give identical UNAUTHORIZED', () => {
    const { call } = setup();
    const a = call('ping', {}, null);
    const b = call('ping', {}, 'wrong');
    expect(a).toEqual(b);
    expect(a).toEqual({ ok: false, v: 1, error: { code: 'UNAUTHORIZED', message: 'unauthorized', retryable: false } });
    expect(JSON.stringify(b)).not.toContain('wrong');
  });
  it('bad json, unknown action, wrong v', () => {
    const { call, deps } = setup();
    expect((handleRequest('nope', deps) as any).error.code).toBe('BAD_REQUEST');
    expect(call('frob').error.code).toBe('BAD_REQUEST');
    expect((handleRequest(JSON.stringify({ v: 2, token: TOKEN, action: 'ping' }), deps) as any).error.code).toBe('SCHEMA_MISMATCH');
  });
  it('settings schemaVersion mismatch', () => {
    const { call, sheet } = setup();
    sheet.writeRow('Settings', 2, ['schemaVersion', 2]);
    expect(call('ping').error).toMatchObject({ code: 'SCHEMA_MISMATCH', retryable: false });
  });
  it('TOO_LARGE for >200 ops and >1MB body', () => {
    const { call, deps } = setup();
    const r = call('push', { ops: Array.from({ length: 201 }, () => ({ entity: 'tx', record: tx(1) })) });
    expect(r.error).toMatchObject({ code: 'TOO_LARGE', retryable: false });
    const big = JSON.stringify({ v: 1, token: TOKEN, action: 'push', ops: [], pad: 'x'.repeat(1024 * 1024) });
    expect((handleRequest(big, deps) as any).error.code).toBe('TOO_LARGE');
  });
  it('BUSY is retryable', () => {
    const { call } = setup(undefined, true);
    expect(call('pull', { since: 0 }).error).toMatchObject({ code: 'BUSY', retryable: true });
  });
});

describe('push', () => {
  it('appends: amount stored in hryvnias, rev = head+1', () => {
    const { call, sheet } = setup();
    const r = pushTx(call, tx(1), tx(2, { amountMinor: -1 }));
    expect(r.results.map((x: any) => [x.status, x.rev])).toEqual([['applied', 1], ['applied', 2]]);
    expect(r.head).toBe(2);
    const rows = sheet.readAll(TX_SHEET);
    expect(rows).toHaveLength(3);
    expect(rows[1][4]).toBe(-123.45);
    expect(rows[2][4]).toBe(-0.01);
    const pulled = call('pull', { since: 0 });
    expect(pulled.tx.map((t: Transaction) => t.amountMinor)).toEqual([-12345, -1]);
  });
  it('duplicate on exact replay; no new rows', () => {
    const { call, sheet } = setup();
    pushTx(call, tx(1));
    const r = pushTx(call, tx(1));
    expect(r.results[0]).toMatchObject({ status: 'duplicate', rev: 1, updatedAt: '2026-11-12T09:00:00.000Z' });
    expect(sheet.readAll(TX_SHEET)).toHaveLength(2);
  });
  it('newer updatedAt overwrites but keeps createdAt; older is stale', () => {
    const { call, sheet } = setup();
    pushTx(call, tx(1));
    const r = pushTx(call, tx(1, { memo: 'new', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-11-12T09:30:00.000Z' }));
    expect(r.results[0]).toMatchObject({ status: 'applied', rev: 2 });
    expect(sheet.readAll(TX_SHEET)[1][6]).toBe('2026-11-12T09:00:00.000Z');
    const s = pushTx(call, tx(1, { memo: 'old', updatedAt: '2026-11-12T09:10:00.000Z' }));
    expect(s.results[0].status).toBe('stale');
    expect(s.results[0].record).toMatchObject({ memo: 'new', rev: 2, amountMinor: -12345 });
  });
  it('tombstone upsert for unknown id appends a deleted row', () => {
    const { call, sheet } = setup();
    expect(pushTx(call, tx(1, { deleted: true })).results[0].status).toBe('applied');
    expect(sheet.readAll(TX_SHEET)[1][8]).toBe(true);
  });
  it('invalid ops: bad sign, bad dates, bad slug, others; results keep order', () => {
    const { call, sheet } = setup();
    const r = pushTx(
      call,
      tx(1, { amountMinor: 500 }), // expense positive
      tx(2, { date: '2026-02-30' }),
      tx(3, { category: 'Bad Slug' }),
      tx(4, { type: 'income', amountMinor: -5 }),
      tx(5, { amountMinor: 1.5 }),
      tx(6, { memo: 'x'.repeat(501) }),
      tx(7, { updatedAt: '2026-11-12' }),
      tx(8, { id: 'NOT-A-UUID' }),
      tx(9),
    );
    expect(r.results.map((x: any) => x.reason ?? x.status)).toEqual([
      'amount sign', 'bad date', 'bad category', 'amount sign', 'bad amount', 'bad memo', 'bad updatedAt', 'bad id', 'applied',
    ]);
    expect(sheet.readAll(TX_SHEET)).toHaveLength(2);
    const c = call('push', { ops: [{ entity: 'cat', record: cat('Bad_Slug') }, { entity: 'zzz', record: {} }, { entity: 'cat', record: cat('food') }] });
    expect(c.results.map((x: any) => x.reason ?? x.status)).toEqual(['bad id', 'bad entity', 'applied']);
  });
  it('drops unknown fields and memo =1+1 round-trips as text', () => {
    const { call, sheet } = setup();
    const rec = { ...tx(1, { memo: '=1+1' }), evil: 'x' };
    pushTx(call, rec);
    expect(sheet.readAll(TX_SHEET)[1]).toHaveLength(10);
    expect(call('pull', { since: 0 }).tx[0]).toMatchObject({ memo: '=1+1' });
  });
  it('clock guard clamps a far-future updatedAt to server time', () => {
    const { call } = setup();
    const r = pushTx(call, tx(1, { updatedAt: '2027-01-01T00:00:00.000Z' }), tx(2, { updatedAt: '2026-11-12T10:04:00.000Z' }));
    expect(r.results[0]).toMatchObject({ status: 'applied', updatedAt: '2026-11-12T10:00:00.000Z' });
    expect(r.results[1].updatedAt).toBe('2026-11-12T10:04:00.000Z');
  });
  it('same id twice in one batch: second is duplicate/applied against the first', () => {
    const { call, sheet } = setup();
    const r = pushTx(call, tx(1), tx(1), tx(1, { memo: 'b', updatedAt: '2026-11-12T09:01:00.000Z' }));
    expect(r.results.map((x: any) => x.status)).toEqual(['applied', 'duplicate', 'applied']);
    expect(sheet.readAll(TX_SHEET)).toHaveLength(2);
    expect(sheet.readAll(TX_SHEET)[1][5]).toBe('b');
  });
});

describe('pull', () => {
  it('pages by rev ascending across tx and cat, includes deleted, unique revs', () => {
    const { call } = setup();
    call('push', { ops: [{ entity: 'cat', record: cat('food') }, { entity: 'cat', record: cat('rent') }] });
    for (let i = 1; i <= 5; i++) pushTx(call, tx(i, { deleted: i === 3 }));
    const seen: number[] = [];
    let since = 0, pages = 0, more = true, last: any;
    while (more) {
      last = call('pull', { since, limit: 3 });
      pages++;
      for (const r of [...last.tx, ...last.cat]) seen.push(r.rev);
      expect(last.rev).toBeGreaterThanOrEqual(since);
      since = last.rev;
      more = last.more;
    }
    expect(pages).toBe(3);
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(seen).size).toBe(7);
    expect(last.head).toBe(7);
    expect(last.counts).toEqual({ tx: 4, cat: 2 });
    expect(last.settings).toEqual({ schemaVersion: 1, currency: 'UAH', bigAmountMinor: 500000 });
    const all = call('pull', { since: 0 });
    expect(all.tx.find((t: Transaction) => t.id === uid(3)).deleted).toBe(true);
    const empty = call('pull', { since: 7 });
    expect(empty).toMatchObject({ rev: 7, more: false, tx: [], cat: [] });
  });
  it('reports invalid hand-edited rows and reads dates/amounts tolerantly', () => {
    const { call, sheet } = setup();
    pushTx(call, tx(1));
    sheet.append(TX_SHEET, [
      [uid(2), '2026-02-30', 'expense', 'food', -5, '', '2026-11-12T09:00:00.000Z', '2026-11-12T09:00:00.000Z', false, 7],
      [uid(3), new Date(Date.UTC(2026, 10, 3)), 'expense', 'food', '-1,10', 'ok', '2026-11-12T09:00:00.000Z', '2026-11-12T09:00:00.000Z', 'TRUE', 8],
    ]);
    const r = call('pull', { since: 0 });
    expect(r.invalid).toEqual([{ sheet: 'Transactions', row: 3, reason: 'bad date' }]);
    expect(r.tx.map((t: Transaction) => t.id)).toEqual([uid(1), uid(3)]);
    expect(r.tx[1]).toMatchObject({ date: '2026-11-03', amountMinor: -110, deleted: true });
    expect(r.counts.tx).toBe(1);
    expect(call('ping').head).toBe(8);
  });
  it('rejects bad since/limit', () => {
    const { call } = setup();
    expect(call('pull', { since: -1 }).error.code).toBe('BAD_REQUEST');
    expect(call('pull', { since: 0, limit: 0 }).error.code).toBe('BAD_REQUEST');
  });
});

describe('onEditCore', () => {
  it('stamps id, createdAt, updatedAt, rev, deleted on a hand-typed row', () => {
    const { call, sheet, deps } = setup();
    pushTx(call, tx(1));
    sheet.append(TX_SHEET, [['', '2026-11-05', 'income', 'salary', 1000, 'pay', '', '', '', '']]);
    expect(onEditCore(deps, { sheet: TX_SHEET, row: 3, numRows: 1, col: 5, numCols: 1 })).toBe(1);
    expect(sheet.readAll(TX_SHEET)[2]).toEqual([
      '11111111-1111-4111-8111-111111111111', '2026-11-05', 'income', 'salary', 1000, 'pay',
      '2026-11-12T10:00:00.000Z', '2026-11-12T10:00:00.000Z', false, 2,
    ]);
    const p = call('pull', { since: 1 });
    expect(p.tx[0]).toMatchObject({ amountMinor: 100000, rev: 2 });
  });
  it('ignores edits touching only updatedAt/rev, header row, and other sheets', () => {
    const { sheet, deps } = setup();
    sheet.append(TX_SHEET, [[uid(1), '2026-11-05', 'income', 'x', 1, '', 'c', 'u', false, 1]]);
    expect(onEditCore(deps, { sheet: TX_SHEET, row: 2, numRows: 1, col: 8, numCols: 1 })).toBe(0);
    expect(onEditCore(deps, { sheet: TX_SHEET, row: 1, numRows: 1, col: 1, numCols: 1 })).toBe(0);
    expect(onEditCore(deps, { sheet: 'Settings', row: 2, numRows: 1, col: 1, numCols: 1 })).toBe(0);
  });
  it('caps at 500 rows and skips blank rows; category without id is skipped', () => {
    const { sheet, deps } = setup();
    sheet.append(TX_SHEET, Array.from({ length: 600 }, (_, i) => [uid(i + 1), '2026-11-05', 'income', 'x', 1, '', 'c', 'u', false, 0]));
    expect(onEditCore(deps, { sheet: TX_SHEET, row: 2, numRows: 600, col: 1, numCols: 10 })).toBe(500);
    sheet.append(CAT_SHEET, [['', 'Name', 'expense', 'coin', '#000000', 1, false, '', '']]);
    expect(onEditCore(deps, { sheet: CAT_SHEET, row: 2, numRows: 1, col: 2, numCols: 1 })).toBe(0);
  });
});
