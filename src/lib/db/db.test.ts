import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category, Transaction } from '../model';
import { createDb, outboxKey, type Db } from './index';

let n = 0;
let db: Db;

const T0 = '2026-01-01T00:00:00.000Z';
const mkTx = (id: string, o: Partial<Transaction> = {}): Transaction => ({
  id,
  date: '2026-11-12',
  type: 'expense',
  category: 'food',
  memo: '',
  amountMinor: -1000,
  createdAt: T0,
  updatedAt: T0,
  deleted: false,
  rev: 0,
  ...o,
});
const mkCat = (id: string, o: Partial<Category> = {}): Category => ({
  id, name: id, kind: 'expense', icon: 'coin', color: '#112233', order: 1, archived: false, updatedAt: T0, rev: 0, ...o,
});

beforeEach(() => {
  db = createDb(`test-${++n}`);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
});

describe('writes', () => {
  it('saveTx writes cache + outbox and stamps updatedAt', async () => {
    const r = await db.saveTx(mkTx('a'));
    expect(r.updatedAt > T0).toBe(true);
    const [e] = await db.outboxBatch(10);
    expect(e.key).toBe('tx:a');
    expect(e.updatedAt).toBe(r.updatedAt);
    expect(await db.listMonth('2026-11')).toEqual([r]);
  });

  it('is atomic: a failing outbox write rolls back the cache write', async () => {
    const orig = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: [unknown, IDBValidKey?]) {
      if (this.name === 'outbox') throw new Error('boom');
      return orig.apply(this, args as never);
    });
    await expect(db.saveTx(mkTx('a'))).rejects.toThrow('boom');
    vi.restoreAllMocks();
    expect(await db.listMonth('2026-11')).toEqual([]);
    expect(await db.outboxCounts()).toEqual({ pending: 0, dead: 0 });
  });

  it('compacts 3 edits into one entry keeping the first queuedAt, resetting attempts', async () => {
    await db.saveTx(mkTx('a'));
    const first = (await db.outboxBatch(10))[0];
    await db.markAttempt(['tx:a'], 'net');
    await new Promise((r) => setTimeout(r, 5));
    await db.saveTx(mkTx('a', { memo: 'x' }));
    const last = await db.saveTx(mkTx('a', { memo: 'y' }));
    const batch = await db.outboxBatch(10);
    expect(batch).toHaveLength(1);
    expect(batch[0].queuedAt).toBe(first.queuedAt);
    expect(batch[0].attempts).toBe(0);
    expect((batch[0].record as Transaction).memo).toBe('y');
    expect(batch[0].updatedAt).toBe(last.updatedAt);
    expect(last.updatedAt > first.updatedAt).toBe(true);
  });

  it('delete removes from cache and queues a tombstone snapshot', async () => {
    const saved = await db.saveTx(mkTx('a'));
    const t = await db.deleteTx('a');
    expect(t?.deleted).toBe(true);
    expect(t!.updatedAt > saved.updatedAt).toBe(true);
    expect(await db.listMonth('2026-11')).toEqual([]);
    const batch = await db.outboxBatch(10);
    expect(batch).toHaveLength(1);
    expect((batch[0].record as Transaction).deleted).toBe(true);
    expect(await db.deleteTx('missing')).toBeUndefined();
  });
});

describe('ackOp', () => {
  it('removes the entry and stores rev/updatedAt', async () => {
    const r = await db.saveTx(mkTx('a'));
    expect(await db.ackOp('tx:a', r.updatedAt, { rev: 7, updatedAt: r.updatedAt })).toBe(true);
    expect((await db.outboxCounts()).pending).toBe(0);
    expect((await db.listMonth('2026-11'))[0].rev).toBe(7);
    expect(await db.countAckedLive()).toBe(1);
  });

  it('keeps the newer snapshot when edited during the request', async () => {
    const sent = await db.saveTx(mkTx('a'));
    const newer = await db.saveTx(mkTx('a', { memo: 'later' }));
    expect(await db.ackOp('tx:a', sent.updatedAt, { rev: 3, updatedAt: sent.updatedAt })).toBe(false);
    const [e] = await db.outboxBatch(10);
    expect(e.updatedAt).toBe(newer.updatedAt);
    const [row] = await db.listMonth('2026-11');
    expect(row.rev).toBe(3);
    expect(row.updatedAt).toBe(newer.updatedAt);
    expect(row.memo).toBe('later');
  });
});

describe('applyPulled', () => {
  it('keeps pending newer local, accepts newer server, stores cursor', async () => {
    const a = await db.saveTx(mkTx('a', { memo: 'local' }));
    const b = await db.saveTx(mkTx('b', { memo: 'local' }));
    const older = mkTx('a', { memo: 'srv', updatedAt: T0, rev: 1 });
    const newer = mkTx('b', { memo: 'srv', updatedAt: '2999-01-01T00:00:00.000Z', rev: 2 });
    await db.applyPulled({ tx: [older, newer], cat: [] }, 42);
    const rows = Object.fromEntries((await db.listMonth('2026-11')).map((r) => [r.id, r]));
    expect(rows.a.memo).toBe('local');
    expect(rows.b.memo).toBe('srv');
    expect((await db.outboxBatch(10)).map((e) => e.key)).toEqual(['tx:a']);
    expect(await db.getMeta('cursor')).toBe(42);
    expect(a.updatedAt > T0 && b.updatedAt > T0).toBe(true);
  });

  it('server tombstone removes the local row and the older pending entry', async () => {
    await db.applyPulled({ tx: [mkTx('a', { rev: 1 })], cat: [] }, 1);
    expect(await db.listMonth('2026-11')).toHaveLength(1);
    await db.applyPulled({ tx: [mkTx('a', { rev: 2, deleted: true, updatedAt: '2999-01-01T00:00:00.000Z' })], cat: [] }, 2);
    expect(await db.listMonth('2026-11')).toEqual([]);
    await db.saveTx(mkTx('b'));
    await db.applyPulled({ tx: [mkTx('b', { deleted: true, rev: 3, updatedAt: '2999-01-01T00:00:00.000Z' })], cat: [] }, 3);
    expect(await db.outboxCounts()).toEqual({ pending: 0, dead: 0 });
  });

  it('merges categories and sorts by order', async () => {
    await db.applyPulled({ tx: [], cat: [mkCat('z', { order: 1 }), mkCat('y', { order: 0 })] }, 1);
    expect((await db.listCategories()).map((c) => c.id)).toEqual(['y', 'z']);
  });
});

describe('listing', () => {
  it('month boundaries and newest first', async () => {
    await db.applyPulled(
      {
        tx: [
          mkTx('jan31', { date: '2026-01-31' }),
          mkTx('feb1', { date: '2026-02-01' }),
          mkTx('feb1b', { date: '2026-02-01', createdAt: '2026-01-02T00:00:00.000Z' }),
          mkTx('feb28', { date: '2026-02-28' }),
        ],
        cat: [],
      },
      1,
    );
    expect((await db.listMonth('2026-01')).map((t) => t.id)).toEqual(['jan31']);
    expect((await db.listMonth('2026-02')).map((t) => t.id)).toEqual(['feb28', 'feb1b', 'feb1']);
  });

  it('recentCategoryIds is distinct, latest first, by kind', async () => {
    await db.applyPulled(
      {
        tx: [
          mkTx('1', { date: '2026-11-01', category: 'a' }),
          mkTx('2', { date: '2026-11-02', category: 'b' }),
          mkTx('3', { date: '2026-11-03', category: 'a' }),
          mkTx('4', { date: '2026-11-04', category: 'pay', type: 'income', amountMinor: 5 }),
        ],
        cat: [],
      },
      1,
    );
    expect(await db.recentCategoryIds('expense', 5)).toEqual(['a', 'b']);
    expect(await db.recentCategoryIds('expense', 1)).toEqual(['a']);
    expect(await db.recentCategoryIds('income', 5)).toEqual(['pay']);
  });
});

describe('outbox', () => {
  it('batch orders cat before tx then queuedAt, pending only; dead flow', async () => {
    await db.saveTx(mkTx('t1'));
    await new Promise((r) => setTimeout(r, 3));
    await db.saveTx(mkTx('t2'));
    await db.saveCategory(mkCat('c1'));
    expect((await db.outboxBatch(10)).map((e) => e.key)).toEqual(['cat:c1', 'tx:t1', 'tx:t2']);
    expect(await db.outboxBatch(2)).toHaveLength(2);
    await db.markDead('tx:t1', 'bad');
    expect(await db.outboxCounts()).toEqual({ pending: 2, dead: 1 });
    expect((await db.outboxBatch(10)).map((e) => e.key)).toEqual(['cat:c1', 'tx:t2']);
    expect(await db.discardDead('tx:t2')).toBe(false);
    expect(await db.discardDead('tx:t1')).toBe(true);
    await db.markAttempt(['tx:t2', 'nope'], 'e');
    const e = (await db.outboxBatch(10)).find((x) => x.key === 'tx:t2')!;
    expect(e.attempts).toBe(1);
    expect(e.lastError).toBe('e');
    expect(outboxKey('tx', 'x')).toBe('tx:x');
  });

  it('adoptServerRecord overwrites local and drops entry; guarded by sentUpdatedAt', async () => {
    const sent = await db.saveTx(mkTx('a', { memo: 'mine' }));
    expect(await db.adoptServerRecord('tx', mkTx('a', { memo: 'sheet', rev: 5, updatedAt: '2999-01-01T00:00:00.000Z' }), sent.updatedAt)).toBe(true);
    expect((await db.listMonth('2026-11'))[0].memo).toBe('sheet');
    expect((await db.outboxCounts()).pending).toBe(0);

    const s2 = await db.saveTx(mkTx('a', { memo: 'v2' }));
    await db.saveTx(mkTx('a', { memo: 'v3' }));
    expect(await db.adoptServerRecord('tx', mkTx('a', { rev: 6 }), s2.updatedAt)).toBe(false);
    expect((await db.listMonth('2026-11'))[0].memo).toBe('v3');

    expect(await db.adoptServerRecord('tx', mkTx('a', { deleted: true }))).toBe(true);
    expect(await db.listMonth('2026-11')).toEqual([]);
  });
});

describe('full pull / meta / export / seed', () => {
  it('fullPullFinish drops unseen rows without outbox entries', async () => {
    await db.applyPulled({ tx: [mkTx('seen'), mkTx('gone')], cat: [mkCat('c-seen'), mkCat('c-gone')] }, 1);
    await db.saveTx(mkTx('local-new'));
    const removed = await db.fullPullFinish(['seen'], ['c-seen']);
    expect(removed).toEqual({ tx: 1, cat: 1 });
    expect((await db.listMonth('2026-11')).map((t) => t.id).sort()).toEqual(['local-new', 'seen']);
    expect((await db.listCategories()).map((c) => c.id)).toEqual(['c-seen']);
  });

  it('seeds defaults only into an empty cat store, without queueing', async () => {
    expect(await db.seedDefaultCategories([mkCat('a'), mkCat('b', { order: 2 })])).toBe(true);
    expect(await db.seedDefaultCategories([mkCat('c')])).toBe(false);
    expect((await db.listCategories()).map((c) => c.id)).toEqual(['a', 'b']);
    expect((await db.outboxCounts()).pending).toBe(0);
  });

  it('meta and exportJson', async () => {
    expect(await db.getMeta('x')).toBeUndefined();
    await db.setMeta('x', { a: 1 });
    expect(await db.getMeta('x')).toEqual({ a: 1 });
    await db.saveTx(mkTx('a'));
    const j = JSON.parse(await db.exportJson());
    expect(j.tx).toHaveLength(1);
    expect(j.outbox).toHaveLength(1);
    expect(j.cat).toEqual([]);
  });
});
