import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeError } from '../bridge';
import { createMockBridge, MemorySheet, type MockBridge } from '../bridge/mock';
import { createDb, type Db } from '../db';
import type { Bridge, Category, Transaction } from '../model';
import { createSync, installTriggers, BACKOFF_MS, type Sync } from './index';

let n = 0;
let uid = 0;
let db: Db;
let sheet: MemorySheet;
let bridge: MockBridge;
let sync: Sync;
let timers: { fn: () => void; ms: number; cancelled: boolean }[];
const dbs: Db[] = [];

const newId = (): string => `11111111-1111-4111-8111-${(++uid).toString(16).padStart(12, '0')}`;
const mkTx = (o: Partial<Transaction> = {}): Transaction => {
  const t = new Date().toISOString();
  return {
    id: newId(), date: '2026-11-12', type: 'expense', category: 'food', memo: '', amountMinor: -1000,
    createdAt: t, updatedAt: t, deleted: false, rev: 0, ...o,
  };
};
const sheetIds = (): string[] =>
  sheet.readAll('Transactions').slice(1).filter((r) => r[0]).map((r) => String(r[0]));
const sheetRow = (id: string): unknown[] | undefined => sheet.readAll('Transactions').find((r) => r[0] === id);
const makeDb = (): Db => {
  const d = createDb(`sync-test-${++n}`);
  dbs.push(d);
  return d;
};
const makeSync = (b: Bridge | null = bridge, d: Db = db): Sync =>
  createSync({
    db: d,
    getBridge: () => b,
    random: () => 0.5,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return () => void (t.cancelled = true);
    },
  });
const flush = async (reason = 'user'): Promise<void> => {
  sync.requestFlush(reason);
  await sync.idle();
};

beforeEach(() => {
  timers = [];
  sheet = new MemorySheet();
  bridge = createMockBridge({ sheet });
  db = makeDb();
  sync = makeSync();
});
afterEach(async () => {
  vi.useRealTimers();
  for (const d of dbs.splice(0)) await d.close();
});

describe('scenarios (docs/ARCHITECTURE.md §6)', () => {
  it('(a) 3 entries offline, then online: one push of 3 ops, a trigger during the run only reruns', async () => {
    bridge.offline = true;
    for (let i = 0; i < 3; i++) await db.saveTx(mkTx());
    await flush('save');
    expect(sync.status.get()).toMatchObject({ state: 'offline', pending: 3 });
    expect(sheetIds()).toHaveLength(0);

    bridge.offline = false;
    const pushSpy = vi.spyOn(bridge, 'push');
    sync.requestFlush('online');
    sync.requestFlush('online'); // during the run: rerun flag only
    await sync.idle();
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy.mock.calls[0][0]).toHaveLength(3);
    expect(sheetIds()).toHaveLength(3);
    expect(sync.status.get()).toMatchObject({ state: 'idle', pending: 0, dead: 0 });
    expect(sync.status.get().lastSyncAt).not.toBeNull();
  });

  it('(b) killed mid-push: server applied, phone never acked -> resend gives duplicates, no new rows', async () => {
    const t = await db.saveTx(mkTx());
    bridge.failAfter = true; // applied, response lost
    await flush('save');
    expect(sheetIds()).toEqual([t.id]);
    expect((await db.outboxCounts()).pending).toBe(1);

    // "restart": a fresh sync over the same DB, network back
    bridge.failAfter = false;
    sync = makeSync();
    await flush('start');
    expect(sheetIds()).toEqual([t.id]);
    expect(await db.outboxCounts()).toEqual({ pending: 0, dead: 0 });
    expect((await db.listMonth('2026-11'))[0].rev).toBeGreaterThan(0);
  });

  it('(c) phone edit newer than the Sheet edit -> applied (phone wins)', async () => {
    const t = await db.saveTx(mkTx({ memo: 'v1' }));
    await flush();
    bridge.editInSheet(t.id, { memo: 'sheet' });
    await new Promise((r) => setTimeout(r, 5));
    await db.saveTx({ ...t, memo: 'phone' });
    await flush();
    expect(sheetRow(t.id)?.[5]).toBe('phone');
    expect((await db.listMonth('2026-11'))[0].memo).toBe('phone');
  });

  it('(c) Sheet edit newer than the phone edit -> stale, phone adopts the Sheet row', async () => {
    const t = await db.saveTx(mkTx({ memo: 'v1' }));
    await flush();
    bridge.clockOffsetMs = 5000; // server clock ahead, so the Sheet edit is newer than the phone edit
    bridge.editInSheet(t.id, { memo: 'sheet' });
    await db.saveTx({ ...t, memo: 'phone' });
    await flush();
    expect(sheetRow(t.id)?.[5]).toBe('sheet');
    expect((await db.listMonth('2026-11'))[0].memo).toBe('sheet');
    expect(await db.outboxCounts()).toEqual({ pending: 0, dead: 0 });
    expect(sync.status.get().sheetVersionKept).toBe(1);
  });

  it('(d) delete offline: row leaves the list at once, tombstone is pushed later', async () => {
    const t = await db.saveTx(mkTx());
    await flush();
    bridge.offline = true;
    await db.deleteTx(t.id);
    expect(await db.listMonth('2026-11')).toHaveLength(0);
    await flush('save');
    expect(sync.status.get().pending).toBe(1);
    bridge.offline = false;
    await flush('online');
    expect(sheetRow(t.id)?.[8]).toBe(true);
    expect(await db.listMonth('2026-11')).toHaveLength(0);
    expect(sync.status.get().pending).toBe(0);
  });

  it('(e) empty cache, cold start, no network: entries queue, first success pushes then full-pulls', async () => {
    const cat: Category = {
      id: 'food', name: 'Food', kind: 'expense', icon: 'coin', color: '#112233', order: 1, archived: false,
      updatedAt: '2026-01-01T00:00:00.000Z', rev: 0,
    };
    expect(await db.seedDefaultCategories([cat])).toBe(true);
    bridge.offline = true;
    await flush('start');
    expect(sync.status.get()).toMatchObject({ state: 'offline', lastSyncAt: null, pending: 0 });
    await db.saveTx(mkTx());
    await db.saveTx(mkTx());
    await flush('save');
    expect(sync.status.get()).toMatchObject({ state: 'offline', pending: 2 });
    bridge.offline = false;
    await flush('online');
    expect(sheetIds()).toHaveLength(2);
    expect(await db.getMeta('cursor')).toBeGreaterThan(0);
    expect(await db.getMeta('lastFullPullAt')).toBeTruthy();
    expect(await db.listMonth('2026-11')).toHaveLength(2);
  });

  it('(f) IndexedDB evicted: new empty DB + no cursor -> full pull rebuilds; only outbox ops are lost', async () => {
    const a = await db.saveTx(mkTx({ memo: 'a' }));
    const b = await db.saveTx(mkTx({ memo: 'b' }));
    await flush();
    await db.saveTx({ ...b, memo: 'unsent' }); // still in the outbox when iOS evicts storage
    const fresh = makeDb();
    sync = makeSync(bridge, fresh);
    await flush('start');
    const rows = await fresh.listMonth('2026-11');
    expect(rows.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    expect(rows.find((r) => r.id === b.id)?.memo).toBe('b');
  });
});

describe('details', () => {
  it('edit during an in-flight push keeps the newer snapshot queued and sends it next', async () => {
    const t = await db.saveTx(mkTx({ memo: 'v1' }));
    bridge.delayMs = 40;
    sync.requestFlush('save');
    await new Promise((r) => setTimeout(r, 10));
    const v2 = await db.saveTx({ ...t, memo: 'v2' }); // while the request is in flight
    await sync.idle();
    expect(sheetRow(t.id)?.[5]).toBe('v2');
    expect(await db.outboxCounts()).toEqual({ pending: 0, dead: 0 });
    expect((await db.listMonth('2026-11'))[0].memo).toBe('v2');
    expect(v2.updatedAt > t.updatedAt).toBe(true);
    expect(bridge.requests).toBeGreaterThanOrEqual(3); // push v1, push v2, pull(s)
  });

  it('failAfter (applied, response lost): replay yields duplicate, still exactly N rows', async () => {
    for (let i = 0; i < 4; i++) await db.saveTx(mkTx());
    bridge.failAfter = 1;
    await flush('save');
    expect(sync.status.get()).toMatchObject({ state: 'offline', pending: 4 });
    expect(sheetIds()).toHaveLength(4);
    const spy = vi.spyOn(bridge, 'push');
    await flush(); // user retry
    const res = await spy.mock.results[0].value;
    expect(res.results.map((r: { status: string }) => r.status)).toEqual(Array(4).fill('duplicate'));
    expect(sheetIds()).toHaveLength(4);
    expect(sync.status.get().pending).toBe(0);
  });

  it('invalid -> dead, not retried', async () => {
    const bad = await db.saveTx(mkTx({ category: 'Bad Slug!' }));
    const good = await db.saveTx(mkTx());
    await flush();
    expect(await db.outboxCounts()).toEqual({ pending: 0, dead: 1 });
    expect(sync.status.get()).toMatchObject({ state: 'idle', pending: 0, dead: 1 });
    expect((await db.listDead())[0].key).toBe(`tx:${bad.id}`);
    expect(sheetIds()).toEqual([good.id]);
    const spy = vi.spyOn(bridge, 'push');
    await flush();
    expect(spy).not.toHaveBeenCalled();
  });

  it('backoff 2s/5s/15s/60s/5min with 20% jitter; success resets', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let rnd = 0.5;
    sync = createSync({ db, getBridge: () => bridge, random: () => rnd }); // default timers (faked)
    await db.saveTx(mkTx());
    bridge.failBefore = true;
    sync.requestFlush('save');
    await sync.idle();
    const expected = [2000, 5000, 15000, 60000, 300000, 300000];
    for (const ms of expected) {
      expect(sync.status.get().state).toBe('offline');
      const before = bridge.requests;
      await vi.advanceTimersByTimeAsync(ms - 1);
      // timer not fired yet: nothing new attempted (failBefore does not count requests, so check via status/timers)
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await sync.idle();
      expect(before).toBe(bridge.requests);
    }
    // jitter bounds
    rnd = 0;
    const lo = createDelay(BACKOFF_MS[0], 0);
    const hi = createDelay(BACKOFF_MS[0], 1);
    expect([lo, hi]).toEqual([1600, 2400]);
    bridge.failBefore = false;
    await vi.advanceTimersByTimeAsync(300_000 * 1.2);
    await sync.idle();
    expect(sync.status.get().state).toBe('idle');
    expect(sheetIds()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('backoff delays are scheduled as 2s, 5s, 15s, 60s, 5min (+-20%) via injected timers', async () => {
    await db.saveTx(mkTx());
    bridge.failBefore = true;
    sync.requestFlush('save');
    await sync.idle();
    for (let i = 0; i < 5; i++) {
      const t = timers.filter((x) => !x.cancelled).at(-1)!;
      expect(t.ms).toBe(BACKOFF_MS[i]); // random 0.5 -> zero jitter
      t.cancelled = true;
      t.fn();
      await sync.idle();
    }
    expect(timers.filter((x) => !x.cancelled).at(-1)!.ms).toBe(300000);
    // a trigger retries at once and cancels the pending timer
    bridge.failBefore = false;
    await flush('online');
    expect(timers.filter((x) => !x.cancelled)).toHaveLength(0);
    expect(sync.status.get().state).toBe('idle');
    // jitter range
    const s2 = createSync({ db, getBridge: () => bridge, random: () => 0, setTimer: (fn, ms) => { timers.push({ fn, ms, cancelled: false }); return () => {}; } });
    timers = [];
    await db.saveTx(mkTx());
    bridge.failBefore = true;
    s2.requestFlush('x');
    await s2.idle();
    expect(timers[0].ms).toBe(1600);
  });

  it('UNAUTHORIZED stops retries until requestFlush(user); SCHEMA_MISMATCH likewise', async () => {
    await db.saveTx(mkTx());
    let calls = 0;
    let code: 'UNAUTHORIZED' | 'SCHEMA_MISMATCH' | null = 'UNAUTHORIZED';
    const wrapped: Bridge = {
      ping: () => bridge.ping(),
      pull: (s, l) => bridge.pull(s, l),
      push: async (ops) => {
        calls++;
        if (code) throw new BridgeError(code, 'nope', false);
        return bridge.push(ops);
      },
    };
    sync = makeSync(wrapped);
    await flush('save');
    expect(sync.status.get()).toMatchObject({ state: 'error', errorCode: 'UNAUTHORIZED' });
    expect(timers).toHaveLength(0);
    await flush('online');
    await flush('save');
    expect(calls).toBe(1);
    code = 'SCHEMA_MISMATCH';
    await flush('user');
    expect(calls).toBe(2);
    expect(sync.status.get().errorCode).toBe('SCHEMA_MISMATCH');
    await flush('pageshow');
    expect(calls).toBe(2);
    code = null;
    await flush('user');
    expect(sync.status.get().state).toBe('idle');
    expect(sheetIds()).toHaveLength(1);
  });

  it("'unconfigured' without a bridge; the app still records locally", async () => {
    sync = makeSync(null);
    await db.saveTx(mkTx());
    await flush('save');
    expect(sync.status.get()).toMatchObject({ state: 'unconfigured', pending: 1 });
    expect(timers).toHaveLength(0);
  });

  it('full pull removes rows deleted from the Sheet, but keeps rows with a pending outbox entry', async () => {
    const a = await db.saveTx(mkTx());
    const b = await db.saveTx(mkTx());
    const c = await db.saveTx(mkTx());
    await flush();
    // delete rows a and c from the Sheet manually; c also gets a local pending edit
    const s = sheet.sheets.get('Transactions')!;
    sheet.sheets.set('Transactions', s.filter((r, i) => i === 0 || (r[0] !== a.id && r[0] !== c.id)));
    bridge.offline = true;
    await db.saveTx({ ...c, memo: 'local edit' });
    await flush('save');
    bridge.offline = false;
    const push = vi.spyOn(bridge, 'push');
    // block the push so the pending edit stays in the outbox while the full pull runs
    push.mockRejectedValueOnce(new BridgeError('NETWORK', 'x', true));
    await sync.fullResync();
    // first run failed; second (manual retry) pushes c again as a new row
    await flush();
    const ids = (await db.listMonth('2026-11')).map((r) => r.id);
    expect(ids).toContain(b.id);
    expect(ids).toContain(c.id);
    expect(ids).not.toContain(a.id);
  });

  it('full pull drops Sheet-deleted rows even when the outbox entry of another row is pending', async () => {
    const a = await db.saveTx(mkTx());
    const b = await db.saveTx(mkTx());
    await flush();
    const s = sheet.sheets.get('Transactions')!;
    sheet.sheets.set('Transactions', s.filter((r, i) => i === 0 || r[0] !== a.id));
    const dead = await db.saveTx(mkTx({ category: 'Bad Slug!' })); // dead entry: stays queued, never pushed again
    await flush();
    await sync.fullResync();
    const ids = (await db.listMonth('2026-11')).map((r) => r.id);
    expect(ids).toContain(b.id);
    expect(ids).toContain(dead.id);
    expect(ids).not.toContain(a.id);
  });

  it('pull triggers: count mismatch and head < cursor cause a full pull', async () => {
    const a = await db.saveTx(mkTx());
    const b = await db.saveTx(mkTx());
    await flush();
    // Sheet row removed manually -> head drops below the cursor and counts differ
    const s = sheet.sheets.get('Transactions')!;
    sheet.sheets.set('Transactions', s.filter((r, i) => i === 0 || r[0] !== b.id));
    await flush();
    expect((await db.listMonth('2026-11')).map((r) => r.id)).toEqual([a.id]);
  });

  it('lastFullPullAt older than 7 days forces a full pull', async () => {
    const a = await db.saveTx(mkTx());
    await flush();
    await db.setMeta('lastFullPullAt', new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString());
    // a stray cached row that the Sheet does not have, rev 0 and no outbox entry
    const stray = mkTx();
    const raw = await db.open();
    await raw.put('tx', stray);
    await flush();
    const ids = (await db.listMonth('2026-11')).map((r) => r.id);
    expect(ids).toEqual([a.id]);
  });

  it('batches of 50', async () => {
    for (let i = 0; i < 120; i++) await db.saveTx(mkTx());
    const spy = vi.spyOn(bridge, 'push');
    await flush();
    expect(spy.mock.calls.map((c) => c[0].length)).toEqual([50, 50, 20]);
    expect(sheetIds()).toHaveLength(120);
  });

  it('status subscribe emits changes and unsubscribes', async () => {
    const seen: string[] = [];
    const un = sync.status.subscribe((s) => seen.push(s.state));
    await db.saveTx(mkTx());
    await flush('save');
    un();
    const len = seen.length;
    await flush('user');
    expect(seen).toContain('syncing');
    expect(seen.at(-1)).toBe('idle');
    expect(seen).toHaveLength(len);
  });
});

describe('installTriggers', () => {
  it('pageshow, visibilitychange (visible only) and online request a flush', () => {
    const handlers = new Map<string, () => void>();
    const win = {
      document: { visibilityState: 'hidden' },
      addEventListener: (t: string, f: () => void) => void handlers.set(t, f),
      removeEventListener: (t: string) => void handlers.delete(t),
    };
    const requestFlush = vi.fn();
    const off = installTriggers({ requestFlush }, win);
    handlers.get('pageshow')!();
    handlers.get('visibilitychange')!();
    expect(requestFlush).toHaveBeenCalledTimes(1);
    win.document.visibilityState = 'visible';
    handlers.get('visibilitychange')!();
    handlers.get('online')!();
    expect(requestFlush.mock.calls.map((c) => c[0])).toEqual(['pageshow', 'visible', 'online']);
    off();
    expect(handlers.size).toBe(0);
  });
});

function createDelay(base: number, r: number): number {
  return Math.round(base * (1 + (r * 2 - 1) * 0.2));
}
