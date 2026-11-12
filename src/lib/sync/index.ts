// Flush/pull engine. Contract: docs/ARCHITECTURE.md §6. Pure TS, no Svelte. The Bridge is injected.
import type { Db } from '../db';
import type { Bridge, ErrorCode, Op, OpResult, PullRes } from '../model';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'unconfigured';
export interface SyncStatus {
  state: SyncState;
  pending: number;
  dead: number;
  lastSyncAt: string | null;
  /** Last failure code while state is 'offline' | 'error'; null otherwise. */
  errorCode: ErrorCode | null;
  /** Set when a stale result replaced local rows with the Sheet version in the last run (for a toast). */
  sheetVersionKept: number;
}

export type FlushReason = 'start' | 'pageshow' | 'visible' | 'online' | 'save' | 'user' | 'timer' | string;

export interface Readable<T> {
  subscribe(fn: (v: T) => void): () => void;
  get(): T;
}

export interface SyncDeps {
  db: Db;
  getBridge: () => Bridge | null | undefined | Promise<Bridge | null | undefined>;
  now?: () => number;
  /** Schedules fn after ms and returns a cancel function. */
  setTimer?: (fn: () => void, ms: number) => () => void;
  random?: () => number;
}

export interface Sync {
  requestFlush(reason: FlushReason): void;
  fullResync(): Promise<void>;
  /** Resolves when no run is in progress or queued (useful for tests and "Sync now" spinners). */
  idle(): Promise<void>;
  status: Readable<SyncStatus>;
}

export const BATCH_SIZE = 50;
export const PULL_LIMIT = 1000;
export const BACKOFF_MS = [2000, 5000, 15000, 60000, 300000] as const;
export const JITTER = 0.2;
export const FULL_PULL_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
export const LOCK_NAME = 'youspent-sync';

const STOP_CODES: readonly string[] = ['UNAUTHORIZED', 'SCHEMA_MISMATCH'];

class RunError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function codeOf(e: unknown): ErrorCode {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? (c as ErrorCode) : 'INTERNAL';
}

function readable<T>(initial: T): Readable<T> & { set(v: T): void } {
  let value = initial;
  const subs = new Set<(v: T) => void>();
  return {
    get: () => value,
    set(v) {
      value = v;
      for (const f of [...subs]) f(v);
    },
    subscribe(fn) {
      subs.add(fn);
      fn(value);
      return () => void subs.delete(fn);
    },
  };
}

export function createSync(deps: SyncDeps): Sync {
  const { db, getBridge } = deps;
  const now = deps.now ?? (() => Date.now());
  const random = deps.random ?? Math.random;
  const setTimer =
    deps.setTimer ??
    ((fn, ms) => {
      const h = setTimeout(fn, ms);
      return () => clearTimeout(h);
    });

  const store = readable<SyncStatus>({
    state: 'idle', pending: 0, dead: 0, lastSyncAt: null, errorCode: null, sheetVersionKept: 0,
  });
  const patch = (p: Partial<SyncStatus>): void => store.set({ ...store.get(), ...p });

  let running = false;
  let rerun = false;
  let forceFull = false;
  let blocked = false;
  let fails = 0;
  let cancelTimer: (() => void) | null = null;
  let current: Promise<void> = Promise.resolve();

  async function refreshCounts(): Promise<void> {
    const c = await db.outboxCounts();
    patch({ pending: c.pending, dead: c.dead });
  }
  void (async () => {
    try {
      const last = await db.getMeta<string>('lastSyncAt');
      patch({ lastSyncAt: last ?? null });
      await refreshCounts();
    } catch {
      /* DB unavailable: status stays at defaults */
    }
  })();

  // ---- push ----
  async function push(bridge: Bridge): Promise<void> {
    for (;;) {
      const batch = await db.outboxBatch(BATCH_SIZE);
      if (batch.length === 0) return;
      const ops = batch.map((e) => ({ entity: e.entity, record: e.record }) as Op);
      let results: OpResult[];
      try {
        results = (await bridge.push(ops)).results;
      } catch (e) {
        await db.markAttempt(batch.map((b) => b.key), codeOf(e));
        throw e;
      }
      const byKey = new Map(results.map((r) => [`${r.entity}:${r.id}`, r]));
      let missing = false;
      for (const entry of batch) {
        const r = byKey.get(entry.key);
        if (!r) {
          missing = true;
          await db.markAttempt([entry.key], 'BAD_RESPONSE');
          continue;
        }
        if (r.status === 'applied' || r.status === 'duplicate') {
          await db.ackOp(entry.key, entry.updatedAt, { rev: r.rev, updatedAt: r.updatedAt });
        } else if (r.status === 'stale') {
          if (await db.adoptServerRecord(r.entity, r.record, entry.updatedAt)) {
            patch({ sheetVersionKept: store.get().sheetVersionKept + 1 });
          }
        } else if (r.status === 'invalid') {
          await db.markDead(entry.key, r.reason);
        }
      }
      await refreshCounts();
      if (missing) throw new RunError('BAD_RESPONSE', 'push result missing for an op');
    }
  }

  // ---- pull ----
  const toMs = (v: unknown): number | null => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const t = Date.parse(v);
      return Number.isNaN(t) ? null : t;
    }
    return null;
  };

  /** Pages from `since`. Returns the last page, plus the seen ids if `collect`. Returns 'restart' on head < cursor. */
  async function pullPages(
    bridge: Bridge,
    since: number,
    opts: { collect: boolean; checkHead?: number },
  ): Promise<{ last: PullRes; seenTx: Set<string>; seenCat: Set<string> } | 'restart'> {
    const seenTx = new Set<string>();
    const seenCat = new Set<string>();
    let first = true;
    for (;;) {
      const page = await bridge.pull(since, PULL_LIMIT);
      if (first && opts.checkHead !== undefined && page.head < opts.checkHead) return 'restart';
      first = false;
      await db.applyPulled({ tx: page.tx, cat: page.cat }, page.rev);
      if (opts.collect) {
        for (const t of page.tx) seenTx.add(t.id);
        for (const c of page.cat) seenCat.add(c.id);
      }
      await db.setMeta('remoteSettings', page.settings);
      await db.setMeta('invalidRows', page.invalid.length);
      if (!page.more) return { last: page, seenTx, seenCat };
      if (page.rev <= since) throw new RunError('BAD_RESPONSE', 'pull cursor did not advance');
      since = page.rev;
    }
  }

  async function fullPull(bridge: Bridge): Promise<void> {
    const r = await pullPages(bridge, 0, { collect: true });
    if (r === 'restart') throw new RunError('INTERNAL', 'unreachable');
    await db.fullPullFinish(r.seenTx, r.seenCat);
    await db.setMeta('lastFullPullAt', new Date(now()).toISOString());
  }

  async function pull(bridge: Bridge, manual: boolean): Promise<void> {
    const cursor = await db.getMeta<number>('cursor');
    const lastFull = toMs(await db.getMeta('lastFullPullAt'));
    if (manual || cursor === undefined || lastFull === null || now() - lastFull > FULL_PULL_MAX_AGE_MS) {
      return fullPull(bridge);
    }
    const r = await pullPages(bridge, cursor, { collect: false, checkHead: cursor });
    if (r === 'restart') return fullPull(bridge);
    if (r.last.counts.tx !== (await db.countAckedLive())) return fullPull(bridge);
  }

  // ---- one run ----
  async function runOnce(): Promise<'ok' | 'unconfigured' | 'busy'> {
    const bridge = await getBridge();
    if (!bridge) {
      patch({ state: 'unconfigured', errorCode: null });
      await refreshCounts();
      return 'unconfigured';
    }
    patch({ state: 'syncing', errorCode: null });
    const manual = forceFull;
    forceFull = false;
    try {
      await push(bridge);
      await pull(bridge, manual);
    } catch (e) {
      if (manual) forceFull = true; // retry the full pull next time
      throw e;
    }
    const iso = new Date(now()).toISOString();
    await db.setMeta('lastSyncAt', iso);
    await refreshCounts();
    patch({ state: 'idle', lastSyncAt: iso, errorCode: null });
    return 'ok';
  }

  async function exclusive<T>(fn: () => Promise<T>): Promise<T | 'busy'> {
    const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
    if (!locks?.request) return fn();
    return locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => (lock ? fn() : 'busy')) as Promise<T | 'busy'>;
  }

  function backoffDelay(): number {
    const base = BACKOFF_MS[Math.min(fails - 1, BACKOFF_MS.length - 1)];
    return Math.round(base * (1 + (random() * 2 - 1) * JITTER));
  }

  async function loop(): Promise<void> {
    try {
      do {
        rerun = false;
        try {
          const r = await exclusive(runOnce);
          if (r !== 'ok') break;
          fails = 0;
        } catch (e) {
          const code = codeOf(e);
          try {
            await refreshCounts();
          } catch {
            /* ignore */
          }
          patch({ state: code === 'NETWORK' ? 'offline' : 'error', errorCode: code });
          if (STOP_CODES.includes(code)) {
            blocked = true;
          } else {
            fails++;
            cancelTimer?.();
            cancelTimer = setTimer(() => {
              cancelTimer = null;
              requestFlush('timer');
            }, backoffDelay());
          }
          rerun = false;
          break;
        }
      } while (rerun);
    } finally {
      running = false;
    }
  }

  function requestFlush(reason: FlushReason): void {
    if (reason === 'user') {
      blocked = false;
    } else if (blocked) {
      return;
    }
    cancelTimer?.();
    cancelTimer = null;
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    current = loop();
  }

  /** A run may chain into another one (rerun); wait until nothing is running. */
  async function idle(): Promise<void> {
    while (running) await current;
  }

  return {
    requestFlush,
    async fullResync() {
      forceFull = true;
      requestFlush('user');
      await idle();
    },
    idle,
    status: { get: store.get, subscribe: store.subscribe },
  };
}

export interface TriggerTarget {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
  document?: { visibilityState?: string };
}

/** pageshow, visibilitychange -> visible, online -> requestFlush. Returns an uninstall function. */
export function installTriggers(sync: Pick<Sync, 'requestFlush'>, win: TriggerTarget = window as unknown as TriggerTarget): () => void {
  const onPageshow = (): void => sync.requestFlush('pageshow');
  const onVisible = (): void => {
    if (win.document?.visibilityState === 'visible') sync.requestFlush('visible');
  };
  const onOnline = (): void => sync.requestFlush('online');
  win.addEventListener('pageshow', onPageshow);
  win.addEventListener('visibilitychange', onVisible);
  win.addEventListener('online', onOnline);
  return () => {
    win.removeEventListener('pageshow', onPageshow);
    win.removeEventListener('visibilitychange', onVisible);
    win.removeEventListener('online', onOnline);
  };
}
