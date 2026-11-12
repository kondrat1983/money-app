// IndexedDB layer. Contract: docs/ARCHITECTURE.md §5, §6. Never touches the network.
//
// Usage: `const db = createDb('youspent')` (lazy open; pass another name in tests to isolate).
//
// updatedAt ownership: the DB stamps it. saveTx/saveCategory/deleteTx assign
// `nextIso(previous.updatedAt)` (previous = cached row, else the queued outbox snapshot; for a brand-new
// record `nextIso(record.updatedAt)`), ignore the caller's updatedAt and return the stored record.
// For a tx that already exists, createdAt is also kept from the stored row and rev from the cache.

import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import { monthRange, nextIso, nowIso } from '../dates';
import type { Category, Entity, Transaction, TxType } from '../model';

export interface OutboxEntry {
  key: string; // `${entity}:${id}`
  entity: Entity;
  id: string;
  record: Transaction | Category; // full-row snapshot; tx tombstones have deleted: true
  updatedAt: string; // === record.updatedAt, denormalised for ackOp
  queuedAt: string; // ISO; kept from the first entry of this key
  attempts: number;
  state: 'pending' | 'dead';
  lastError?: string;
}

interface MetaRow {
  key: string;
  value: unknown;
}

interface Schema extends DBSchema {
  tx: { key: string; value: Transaction; indexes: { byDateCreated: [string, string] } };
  cat: { key: string; value: Category };
  outbox: { key: string; value: OutboxEntry; indexes: { byQueuedAt: string } };
  meta: { key: string; value: MetaRow };
}

export type YsDb = IDBPDatabase<Schema>;
export type PulledPage = { tx: Transaction[]; cat: Category[] };

export const DEFAULT_DB_NAME = 'youspent';

export function openDb(name = DEFAULT_DB_NAME): Promise<YsDb> {
  return openDB<Schema>(name, 1, {
    upgrade(db) {
      const tx = db.createObjectStore('tx', { keyPath: 'id' });
      tx.createIndex('byDateCreated', ['date', 'createdAt']);
      db.createObjectStore('cat', { keyPath: 'id' });
      const outbox = db.createObjectStore('outbox', { keyPath: 'key' });
      outbox.createIndex('byQueuedAt', 'queuedAt');
      db.createObjectStore('meta', { keyPath: 'key' });
    },
  });
}

export const outboxKey = (entity: Entity, id: string): string => `${entity}:${id}`;

type Names = StoreNames<Schema>;
type Tx<S extends Names[]> = IDBPTransaction<Schema, S, 'readwrite'>;

/** Runs `fn` in one readwrite transaction; any throw aborts everything and rethrows. */
async function atomic<S extends Names[], R>(
  db: YsDb,
  stores: [...S],
  fn: (tx: Tx<S>) => Promise<R>,
): Promise<R> {
  const tx = db.transaction(stores, 'readwrite') as Tx<S>;
  let result: R;
  try {
    result = await fn(tx);
  } catch (e) {
    try {
      tx.abort();
    } catch {
      /* already finished */
    }
    await tx.done.catch(() => undefined);
    throw e;
  }
  await tx.done;
  return result;
}

/** Puts a snapshot into the outbox: keeps queuedAt of an existing entry, resets attempts/state/error. */
async function queue(
  outbox: { get(key: string): Promise<OutboxEntry | undefined>; put(v: OutboxEntry): Promise<unknown> },
  entity: Entity,
  record: Transaction | Category,
): Promise<void> {
  const key = outboxKey(entity, record.id);
  const prev = await outbox.get(key);
  const entry: OutboxEntry = {
    key,
    entity,
    id: record.id,
    record,
    updatedAt: record.updatedAt,
    queuedAt: prev?.queuedAt ?? nowIso(),
    attempts: 0,
    state: 'pending',
  };
  await outbox.put(entry);
}

const byEntityThenQueued = (a: OutboxEntry, b: OutboxEntry): number => {
  if (a.entity !== b.entity) return a.entity === 'cat' ? -1 : 1;
  if (a.queuedAt !== b.queuedAt) return a.queuedAt < b.queuedAt ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
};

export function createDb(name = DEFAULT_DB_NAME) {
  let opened: Promise<YsDb> | null = null;
  const get = (): Promise<YsDb> => (opened ??= openDb(name));

  /** Latest known version of a record: the cached row, or the queued snapshot (e.g. a pending tombstone). */
  async function previousOf<T extends Transaction | Category>(
    cache: { get(id: string): Promise<T | undefined> },
    outbox: { get(key: string): Promise<OutboxEntry | undefined> },
    entity: Entity,
    id: string,
  ): Promise<T | undefined> {
    return (await cache.get(id)) ?? ((await outbox.get(outboxKey(entity, id)))?.record as T | undefined);
  }

  return {
    name,
    open: get,
    async close(): Promise<void> {
      if (!opened) return;
      (await opened).close();
      opened = null;
    },

    /** Create or edit. Writes cache + outbox in one IDB transaction. Returns the stored record. */
    async saveTx(input: Transaction): Promise<Transaction> {
      const db = await get();
      return atomic(db, ['tx', 'outbox'], async (t) => {
        const cache = t.objectStore('tx');
        const outbox = t.objectStore('outbox');
        const cached = await cache.get(input.id);
        const prev = cached ?? ((await outbox.get(outboxKey('tx', input.id)))?.record as Transaction | undefined);
        const record: Transaction = {
          ...input,
          deleted: false,
          createdAt: prev?.createdAt ?? input.createdAt,
          rev: cached?.rev ?? prev?.rev ?? input.rev,
          updatedAt: nextIso(prev?.updatedAt ?? input.updatedAt),
        };
        await cache.put(record);
        await queue(outbox, 'tx', record);
        return record;
      });
    },

    /** Removes the row from the cache and queues a tombstone snapshot. Returns it (undefined if unknown id). */
    async deleteTx(id: string): Promise<Transaction | undefined> {
      const db = await get();
      return atomic(db, ['tx', 'outbox'], async (t) => {
        const cache = t.objectStore('tx');
        const outbox = t.objectStore('outbox');
        const prev = await previousOf(cache, outbox, 'tx', id);
        if (!prev) return undefined;
        const record: Transaction = { ...prev, deleted: true, updatedAt: nextIso(prev.updatedAt) };
        await cache.delete(id);
        await queue(outbox, 'tx', record);
        return record;
      });
    },

    async saveCategory(input: Category): Promise<Category> {
      const db = await get();
      return atomic(db, ['cat', 'outbox'], async (t) => {
        const cache = t.objectStore('cat');
        const outbox = t.objectStore('outbox');
        const cached = await cache.get(input.id);
        const prev = cached ?? ((await outbox.get(outboxKey('cat', input.id)))?.record as Category | undefined);
        const record: Category = {
          ...input,
          rev: cached?.rev ?? prev?.rev ?? input.rev,
          updatedAt: nextIso(prev?.updatedAt ?? input.updatedAt),
        };
        await cache.put(record);
        await queue(outbox, 'cat', record);
        return record;
      });
    },

    /** Live transactions of 'YYYY-MM', newest first (date, then createdAt, descending). */
    async listMonth(month: string): Promise<Transaction[]> {
      const [first, last] = monthRange(month);
      const db = await get();
      const rows = await db.getAllFromIndex('tx', 'byDateCreated', IDBKeyRange.bound([first, ''], [last, '￿']));
      return rows.reverse();
    },

    async listCategories(): Promise<Category[]> {
      const db = await get();
      const rows = await db.getAll('cat');
      return rows.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
    },

    /** Distinct category ids of the latest transactions of `kind`, most recent first, at most n. */
    async recentCategoryIds(kind: TxType, n: number): Promise<string[]> {
      const db = await get();
      const out: string[] = [];
      let cur = await db.transaction('tx').store.index('byDateCreated').openCursor(null, 'prev');
      while (cur && out.length < n) {
        const row = cur.value;
        if (row.type === kind && !out.includes(row.category)) out.push(row.category);
        cur = await cur.continue();
      }
      return out;
    },

    /** Pending entries only; categories before transactions, then queuedAt. */
    async outboxBatch(n: number): Promise<OutboxEntry[]> {
      const db = await get();
      const all = await db.getAll('outbox');
      return all.filter((e) => e.state === 'pending').sort(byEntityThenQueued).slice(0, n);
    },

    async outboxCounts(): Promise<{ pending: number; dead: number }> {
      const db = await get();
      let pending = 0;
      let dead = 0;
      for (const e of await db.getAll('outbox')) e.state === 'dead' ? dead++ : pending++;
      return { pending, dead };
    },

    /** Dead entries (for the UI: Edit / Discard). */
    async listDead(): Promise<OutboxEntry[]> {
      const db = await get();
      return (await db.getAll('outbox')).filter((e) => e.state === 'dead').sort(byEntityThenQueued);
    },

    /** attempts++ on each existing pending key; stores `error` as lastError when given. */
    async markAttempt(keys: string[], error?: string): Promise<void> {
      const db = await get();
      await atomic(db, ['outbox'], async (t) => {
        for (const key of keys) {
          const e = await t.store.get(key);
          if (!e || e.state !== 'pending') continue;
          e.attempts += 1;
          if (error !== undefined) e.lastError = error;
          await t.store.put(e);
        }
      });
    },

    async markDead(key: string, reason: string): Promise<void> {
      const db = await get();
      await atomic(db, ['outbox'], async (t) => {
        const e = await t.store.get(key);
        if (!e) return;
        e.state = 'dead';
        e.lastError = reason;
        await t.store.put(e);
      });
    },

    /** Removes a dead entry (the cached row, if any, stays). Returns false if it was missing or not dead. */
    async discardDead(key: string): Promise<boolean> {
      const db = await get();
      return atomic(db, ['outbox'], async (t) => {
        const e = await t.store.get(key);
        if (!e || e.state !== 'dead') return false;
        await t.store.delete(key);
        return true;
      });
    },

    /**
     * Acknowledge a pushed op. Deletes the entry only if entry.updatedAt === sentUpdatedAt (else the user edited
     * during the request and the newer snapshot stays queued). With `ack`, rev (and updatedAt, only while the
     * local row still has the sent updatedAt) are written to the cached record. Returns true if the entry was removed.
     */
    async ackOp(key: string, sentUpdatedAt: string, ack?: { rev: number; updatedAt: string }): Promise<boolean> {
      const db = await get();
      return atomic(db, ['tx', 'cat', 'outbox'], async (t) => {
        const entry = await t.objectStore('outbox').get(key);
        if (!entry) return false;
        const matches = entry.updatedAt === sentUpdatedAt;
        if (ack) {
          const store = t.objectStore(entry.entity) as unknown as {
            get(id: string): Promise<Transaction | Category | undefined>;
            put(v: Transaction | Category): Promise<unknown>;
          };
          const local = await store.get(entry.id);
          if (local) {
            const next = local.updatedAt === sentUpdatedAt ? { ...local, rev: ack.rev, updatedAt: ack.updatedAt } : { ...local, rev: ack.rev };
            await store.put(next);
          }
        }
        if (matches) await t.objectStore('outbox').delete(key);
        return matches;
      });
    },

    /**
     * Pull merge (§6 step 3) + cursor in one transaction. Per row: an outbox entry with
     * entry.updatedAt >= row.updatedAt keeps the local state; otherwise the server row wins
     * (tombstone removes the local row) and the entry is dropped.
     */
    async applyPulled(page: PulledPage, cursor: number): Promise<void> {
      const db = await get();
      await atomic(db, ['tx', 'cat', 'outbox', 'meta'], async (t) => {
        const outbox = t.objectStore('outbox');
        for (const row of page.cat) {
          const e = await outbox.get(outboxKey('cat', row.id));
          if (e && e.updatedAt >= row.updatedAt) continue;
          await t.objectStore('cat').put(row);
          if (e) await outbox.delete(e.key);
        }
        for (const row of page.tx) {
          const e = await outbox.get(outboxKey('tx', row.id));
          if (e && e.updatedAt >= row.updatedAt) continue;
          if (row.deleted) await t.objectStore('tx').delete(row.id);
          else await t.objectStore('tx').put(row);
          if (e) await outbox.delete(e.key);
        }
        await t.objectStore('meta').put({ key: 'cursor', value: cursor });
      });
    },

    /** End of a full pull: drop cached rows not seen on the server that have no outbox entry. Returns counts. */
    async fullPullFinish(
      seenTxIds: Iterable<string>,
      seenCatIds: Iterable<string>,
    ): Promise<{ tx: number; cat: number }> {
      const seenTx = new Set(seenTxIds);
      const seenCat = new Set(seenCatIds);
      const db = await get();
      return atomic(db, ['tx', 'cat', 'outbox'], async (t) => {
        const removed = { tx: 0, cat: 0 };
        for (const entity of ['tx', 'cat'] as const) {
          const seen = entity === 'tx' ? seenTx : seenCat;
          const store = t.objectStore(entity) as unknown as {
            getAllKeys(): Promise<string[]>;
            delete(id: string): Promise<void>;
          };
          for (const id of await store.getAllKeys()) {
            if (seen.has(id) || (await t.objectStore('outbox').get(outboxKey(entity, id)))) continue;
            await store.delete(id);
            removed[entity]++;
          }
        }
        return removed;
      });
    },

    /**
     * Server wins ('stale' result): overwrite the local record (remove from tx if deleted) and drop the outbox
     * entry. If `sentUpdatedAt` is given and the entry has a different updatedAt (edited during the request),
     * nothing is changed and false is returned: the newer snapshot stays queued.
     */
    async adoptServerRecord(
      entity: Entity,
      record: Transaction | Category,
      sentUpdatedAt?: string,
    ): Promise<boolean> {
      const db = await get();
      return atomic(db, ['tx', 'cat', 'outbox'], async (t) => {
        const key = outboxKey(entity, record.id);
        const e = await t.objectStore('outbox').get(key);
        if (sentUpdatedAt !== undefined && e && e.updatedAt !== sentUpdatedAt) return false;
        if (entity === 'tx') {
          const r = record as Transaction;
          if (r.deleted) await t.objectStore('tx').delete(r.id);
          else await t.objectStore('tx').put(r);
        } else {
          await t.objectStore('cat').put(record as Category);
        }
        if (e) await t.objectStore('outbox').delete(key);
        return true;
      });
    },

    async getMeta<T = unknown>(key: string): Promise<T | undefined> {
      const db = await get();
      return (await db.get('meta', key))?.value as T | undefined;
    },

    async setMeta(key: string, value: unknown): Promise<void> {
      const db = await get();
      await db.put('meta', { key, value });
    },

    /** Pretty JSON string `{ exportedAt, tx, cat, outbox }` for the Settings "Export JSON" action. */
    async exportJson(): Promise<string> {
      const db = await get();
      const t = db.transaction(['tx', 'cat', 'outbox'], 'readonly');
      const [tx, cat, outbox] = await Promise.all([
        t.objectStore('tx').getAll(),
        t.objectStore('cat').getAll(),
        t.objectStore('outbox').getAll(),
      ]);
      return JSON.stringify({ exportedAt: nowIso(), tx, cat, outbox }, null, 2);
    },

    /** Cached live tx with rev > 0 (acknowledged by the server); compare with PullRes.counts.tx. */
    async countAckedLive(): Promise<number> {
      const db = await get();
      let n = 0;
      let cur = await db.transaction('tx').store.openCursor();
      while (cur) {
        if (cur.value.rev > 0 && !cur.value.deleted) n++;
        cur = await cur.continue();
      }
      return n;
    },

    /** Inserts defaults only if the cat store is empty (not queued). Returns whether it seeded. */
    async seedDefaultCategories(defaults: Category[]): Promise<boolean> {
      const db = await get();
      return atomic(db, ['cat'], async (t) => {
        if ((await t.store.count()) > 0) return false;
        for (const c of defaults) await t.store.put(c);
        return true;
      });
    },
  };
}

export type Db = ReturnType<typeof createDb>;
