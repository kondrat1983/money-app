// Rune stores. Contract: docs/ARCHITECTURE.md §1 (stores row). ui -> stores -> {sync, db}.
import type { Category, DeviceSettings, Transaction, TxType } from '../model';
import type { Db } from '../db';
import { addMonths, monthOf, nowIso, todayLocal } from '../dates';
import { computeTotals, groupByDay } from './derive';
import { defaultCategories } from './defaultCategories';

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'offline' | 'error' | 'unconfigured';
  pending: number;
  dead: number;
  lastSyncAt: string | null;
}

/** Minimal shape of the sync engine (src/lib/sync) that the stores need. */
export interface SyncLike {
  requestFlush(reason: string): void;
  status: { subscribe(run: (s: SyncStatus) => void): () => void };
}

export interface TxInput {
  type: TxType;
  amountMinor: number; // signed
  category: string;
  memo: string;
  date: string;
}

export type TxPatch = Partial<Pick<Transaction, 'type' | 'amountMinor' | 'category' | 'memo' | 'date'>>;

export const DEFAULT_DEVICE: DeviceSettings = {
  bridgeUrl: '',
  token: '',
  theme: 'auto',
  sound: false,
  haptics: false,
};

const KINDS: TxType[] = ['expense', 'income', 'transfer'];

export function createStores(db: Db) {
  let month = $state(monthOf(todayLocal()));
  let rows = $state<Transaction[]>([]);
  let ready = $state(false);
  let lastAddedId = $state<string | null>(null);
  let cats = $state<Category[]>([]);
  let recentIds = $state<Record<TxType, string[]>>({ expense: [], income: [], transfer: [] });
  let status = $state<SyncStatus>({ state: 'unconfigured', pending: 0, dead: 0, lastSyncAt: null });
  let device = $state<DeviceSettings>({ ...DEFAULT_DEVICE });

  let sync: SyncLike | null = null;
  let unsub: (() => void) | null = null;
  let addedTimer: ReturnType<typeof setTimeout> | undefined;

  const totals = $derived(computeTotals(rows));
  const catById = $derived(new Map(cats.map((c) => [c.id, c])));

  /** Injectable hook run after every local write. Default: ask the sync engine to flush. */
  const hooks = {
    onSaved: () => {
      sync?.requestFlush('save');
    },
  };

  async function loadRows() {
    const wanted = month;
    const r = await db.listMonth(wanted);
    if (wanted === month) rows = r;
  }
  async function loadCategories() {
    cats = await db.listCategories();
    const next = { expense: [], income: [], transfer: [] } as Record<TxType, string[]>;
    for (const k of KINDS) next[k] = await db.recentCategoryIds(k, 8);
    recentIds = next;
  }
  async function loadPending() {
    if (sync) return; // the engine owns the status
    const c = await db.outboxCounts();
    status = { ...status, pending: c.pending, dead: c.dead };
  }
  async function refresh() {
    await Promise.all([loadRows(), loadCategories(), loadPending()]);
  }

  async function init() {
    await db.seedDefaultCategories(defaultCategories);
    const dev = await db.getMeta<DeviceSettings>('device');
    device = { ...DEFAULT_DEVICE, ...(dev ?? {}) };
    const last = await db.getMeta<string>('lastSyncAt');
    status = { ...status, lastSyncAt: last ?? null };
    await refresh();
    ready = true;
  }

  async function setMonth(m: string) {
    month = m;
    await loadRows();
  }

  async function addTx(input: TxInput): Promise<Transaction> {
    const now = nowIso();
    const tx: Transaction = {
      id: crypto.randomUUID(),
      date: input.date,
      type: input.type,
      category: input.category,
      memo: input.memo.trim(),
      amountMinor: input.amountMinor,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      rev: 0,
    };
    const saved = await db.saveTx(tx);
    const m = monthOf(saved.date);
    if (m !== month) month = m;
    lastAddedId = saved.id;
    clearTimeout(addedTimer);
    addedTimer = setTimeout(() => (lastAddedId = null), 2500);
    await refresh();
    hooks.onSaved();
    return saved;
  }

  async function editTx(id: string, patch: TxPatch): Promise<Transaction | undefined> {
    const cur = rows.find((r) => r.id === id);
    if (!cur) return undefined;
    const saved = await db.saveTx({ ...cur, ...patch, memo: (patch.memo ?? cur.memo).trim() });
    await refresh();
    hooks.onSaved();
    return saved;
  }

  async function removeTx(id: string): Promise<void> {
    await db.deleteTx(id);
    await refresh();
    hooks.onSaved();
  }

  function attachSync(s: SyncLike) {
    unsub?.();
    sync = s;
    unsub = s.status.subscribe((st) => {
      status = { ...st };
    });
  }

  async function updateDevice(patch: Partial<DeviceSettings>) {
    device = { ...device, ...patch };
    await db.setMeta('device', $state.snapshot(device));
  }

  return {
    ledger: {
      get month() { return month; },
      get rows() { return rows; },
      get totals() { return totals; },
      get groups() { return groupByDay(rows, todayLocal()); },
      get ready() { return ready; },
      get lastAddedId() { return lastAddedId; },
      prev: () => setMonth(addMonths(month, -1)),
      next: () => setMonth(addMonths(month, 1)),
      setMonth,
      refresh,
    },
    categories: {
      get list() { return cats; },
      get active() { return cats.filter((c) => !c.archived); },
      get byId() { return catById; },
      get recentIds() { return recentIds; },
    },
    syncStatus: {
      get value() { return status; },
    },
    settings: {
      get device() { return device; },
      update: updateDevice,
    },
    hooks,
    init,
    attachSync,
    addTx,
    editTx,
    removeTx,
  };
}

export type Stores = ReturnType<typeof createStores>;
