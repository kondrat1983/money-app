// Pure Apps Script bridge logic. No Google globals: everything external is injected.
// Contract: docs/ARCHITECTURE.md §3, §4, §8.
import type { Category, ErrorCode, OpResult, RemoteSettings, Transaction, TxType } from '../src/lib/model/index.ts';
import {
  API_VERSION,
  ID_RE,
  MAX_ABS_AMOUNT_MINOR,
  MAX_MEMO,
  MAX_OPS_PER_PUSH,
  SCHEMA_VERSION,
  SLUG_RE,
  TX_TYPES,
} from '../src/lib/model/index.ts';

// ---------- ports ----------

/** rowIndex is the 1-based sheet row number (row 1 = header). readAll returns the header row too. */
export interface SheetPort {
  readAll(sheet: string): unknown[][];
  append(sheet: string, rows: unknown[][]): void;
  writeRow(sheet: string, rowIndex: number, row: unknown[]): void;
}

export interface SheetLayout {
  name: string;
  header: readonly string[];
  textColumns: readonly string[];
  checkboxColumns: readonly string[];
}

export interface SetupPort {
  /** Create the sheet if missing, write the header, freeze row 1, apply text formats and checkboxes. */
  ensureSheet(layout: SheetLayout): void;
}

export class LockBusyError extends Error {
  constructor() {
    super('lock timeout');
    this.name = 'LockBusyError';
  }
}

export interface LockPort {
  /** Runs fn under the script lock; throws LockBusyError on timeout; always releases. */
  run<T>(fn: () => T): T;
}

export interface Deps {
  sheet: SheetPort;
  getToken(): string | null;
  now(): number; // epoch ms
  uuid(): string;
  lock: LockPort;
  /** Formats a Date cell in the spreadsheet time zone to yyyy-MM-dd. Default: UTC. */
  formatDate?(d: Date): string;
}

// ---------- schema ----------

export const TX_SHEET = 'Transactions';
export const CAT_SHEET = 'Categories';
export const SETTINGS_SHEET = 'Settings';
export const SUBS_SHEET = 'Subscriptions';

export const TX_HEADER = ['id', 'date', 'type', 'category', 'amount', 'memo', 'createdAt', 'updatedAt', 'deleted', 'rev'] as const;
export const CAT_HEADER = ['id', 'name', 'kind', 'icon', 'color', 'order', 'archived', 'updatedAt', 'rev'] as const;

export const LAYOUTS: readonly SheetLayout[] = [
  {
    name: TX_SHEET,
    header: TX_HEADER,
    textColumns: ['id', 'date', 'type', 'category', 'memo', 'createdAt', 'updatedAt'],
    checkboxColumns: ['deleted'],
  },
  {
    name: CAT_SHEET,
    header: CAT_HEADER,
    textColumns: ['id', 'name', 'kind', 'icon', 'color', 'updatedAt'],
    checkboxColumns: ['archived'],
  },
  { name: SETTINGS_SHEET, header: ['key', 'value'], textColumns: ['key'], checkboxColumns: [] },
  {
    name: SUBS_SHEET,
    header: ['id', 'name', 'category', 'amount', 'period', 'nextDate', 'active', 'memo', 'updatedAt', 'deleted', 'rev'],
    textColumns: ['id', 'name', 'category', 'period', 'nextDate', 'memo', 'updatedAt'],
    checkboxColumns: ['active', 'deleted'],
  },
];

const DEFAULT_SETTINGS: RemoteSettings = { schemaVersion: 1, currency: 'UAH', bigAmountMinor: 500000 };

const MAX_BODY = 1024 * 1024;
const CLOCK_GUARD_MS = 5 * 60 * 1000;
const MAX_PULL = 1000;
const MAX_EDIT_ROWS = 500;

// ---------- envelope ----------

export type ResponseEnvelope =
  | ({ ok: true; v: 1; serverTime: string } & Record<string, unknown>)
  | { ok: false; v: 1; error: { code: ErrorCode; message: string; retryable: boolean } };

const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['BUSY', 'INTERNAL']);

function fail(code: ErrorCode, message: string): ResponseEnvelope {
  return { ok: false, v: 1, error: { code, message, retryable: RETRYABLE.has(code) } };
}

class ApiError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

// ---------- small helpers ----------

const isoOf = (ms: number): string => new Date(ms).toISOString();

function cell(row: unknown[], i: number): unknown {
  return i < row.length ? row[i] : '';
}

function str(c: unknown): string {
  if (c === null || c === undefined) return '';
  return typeof c === 'string' ? c : String(c);
}

function isBlank(c: unknown): boolean {
  return c === null || c === undefined || c === '' || c === false;
}

function bool(c: unknown): boolean {
  return c === true || (typeof c === 'string' && c.trim().toUpperCase() === 'TRUE');
}

function isIso(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)) return false;
  const t = Date.parse(s);
  return !Number.isNaN(t) && new Date(t).toISOString() === s;
}

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 1000) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Constant-time string compare (length is not secret enough to matter, but is folded in). */
export function safeEqual(a: string, b: string): boolean {
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function base64url(bytes: Uint8Array): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += abc[b0 >> 2] + abc[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += abc[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += abc[b2 & 63];
  }
  return out;
}

// ---------- validation ----------

type Rec = Record<string, unknown>;

/** Returns a clean Transaction (rev 0, unknown fields dropped) or a reason string. */
export function validateTx(o: Rec): Transaction | string {
  if (typeof o.id !== 'string' || !ID_RE.test(o.id)) return 'bad id';
  if (typeof o.date !== 'string' || !isRealDate(o.date)) return 'bad date';
  if (typeof o.type !== 'string' || !(TX_TYPES as readonly string[]).includes(o.type)) return 'bad type';
  if (typeof o.category !== 'string' || !SLUG_RE.test(o.category)) return 'bad category';
  if (typeof o.memo !== 'string' || o.memo.trim().length > MAX_MEMO) return 'bad memo';
  const a = o.amountMinor;
  if (typeof a !== 'number' || !Number.isInteger(a) || Math.abs(a) > MAX_ABS_AMOUNT_MINOR) return 'bad amount';
  const type = o.type as TxType;
  if ((type === 'expense' && a >= 0) || (type === 'income' && a <= 0) || (type === 'transfer' && a === 0)) return 'amount sign';
  if (!isIso(o.createdAt)) return 'bad createdAt';
  if (!isIso(o.updatedAt)) return 'bad updatedAt';
  if (typeof o.deleted !== 'boolean') return 'bad deleted';
  return {
    id: o.id, date: o.date, type, category: o.category, memo: o.memo.trim(), amountMinor: a,
    createdAt: o.createdAt, updatedAt: o.updatedAt, deleted: o.deleted, rev: 0,
  };
}

export function validateCat(o: Rec): Category | string {
  if (typeof o.id !== 'string' || !SLUG_RE.test(o.id)) return 'bad id';
  if (typeof o.name !== 'string' || o.name.trim().length === 0 || o.name.length > 40) return 'bad name';
  if (typeof o.kind !== 'string' || !(TX_TYPES as readonly string[]).includes(o.kind)) return 'bad kind';
  if (typeof o.icon !== 'string' || o.icon.length === 0 || o.icon.length > 40) return 'bad icon';
  if (typeof o.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(o.color)) return 'bad color';
  if (typeof o.order !== 'number' || !Number.isInteger(o.order) || Math.abs(o.order) > 1e6) return 'bad order';
  if (typeof o.archived !== 'boolean') return 'bad archived';
  if (!isIso(o.updatedAt)) return 'bad updatedAt';
  return {
    id: o.id, name: o.name, kind: o.kind as TxType, icon: o.icon, color: o.color, order: o.order,
    archived: o.archived, updatedAt: o.updatedAt, rev: 0,
  };
}

// ---------- row <-> record ----------

const fmtOf = (deps: Deps) => deps.formatDate ?? utcDate;

function dateCell(c: unknown, fmt: (d: Date) => string): string {
  return c instanceof Date ? fmt(c) : str(c).trim();
}

function isoCell(c: unknown): string {
  return c instanceof Date ? c.toISOString() : str(c).trim();
}

function revCell(c: unknown): number | null {
  const n = typeof c === 'number' ? c : typeof c === 'string' && c.trim() !== '' ? Number(c) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function txToRow(t: Transaction): unknown[] {
  return [t.id, t.date, t.type, t.category, t.amountMinor / 100, t.memo, t.createdAt, t.updatedAt, t.deleted, t.rev];
}

function catToRow(c: Category): unknown[] {
  return [c.id, c.name, c.kind, c.icon, c.color, c.order, c.archived, c.updatedAt, c.rev];
}

function parseTxRow(row: unknown[], fmt: (d: Date) => string): Transaction | string {
  const raw = cell(row, 4);
  const num = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.replace(',', '.')) : NaN;
  if (!Number.isFinite(num)) return 'bad amount';
  const r = validateTx({
    id: str(cell(row, 0)).trim(), date: dateCell(cell(row, 1), fmt), type: str(cell(row, 2)).trim(),
    category: str(cell(row, 3)).trim(), amountMinor: Math.round(num * 100), memo: str(cell(row, 5)),
    createdAt: isoCell(cell(row, 6)), updatedAt: isoCell(cell(row, 7)), deleted: bool(cell(row, 8)),
  });
  if (typeof r === 'string') return r;
  const rev = revCell(cell(row, 9));
  if (rev === null) return 'bad rev';
  r.rev = rev;
  return r;
}

function parseCatRow(row: unknown[]): Category | string {
  const order = cell(row, 5);
  const r = validateCat({
    id: str(cell(row, 0)).trim(), name: str(cell(row, 1)), kind: str(cell(row, 2)).trim(), icon: str(cell(row, 3)).trim(),
    color: str(cell(row, 4)).trim(), order: typeof order === 'string' && order.trim() !== '' ? Number(order) : order,
    archived: bool(cell(row, 6)), updatedAt: isoCell(cell(row, 7)),
  });
  if (typeof r === 'string') return r;
  const rev = revCell(cell(row, 8));
  if (rev === null) return 'bad rev';
  r.rev = rev;
  return r;
}

// ---------- table scan ----------

interface Entry<T> {
  row: number | null; // 1-based sheet row; null while buffered for append
  buf: number;
  rec: T | null; // null = unparseable existing row
}

interface Table<T extends { id: string; rev: number; updatedAt: string }> {
  name: string;
  byId: Map<string, Entry<T>>;
  list: T[];
  invalid: { sheet: string; row: number; reason: string }[];
  head: number;
  pending: unknown[][];
  parse(row: unknown[]): T | string;
  toRow(rec: T): unknown[];
}

function scan<T extends { id: string; rev: number; updatedAt: string }>(
  deps: Deps, name: string, revIndex: number, parse: (row: unknown[]) => T | string, toRow: (r: T) => unknown[],
): Table<T> {
  const all = deps.sheet.readAll(name);
  const t: Table<T> = { name, byId: new Map(), list: [], invalid: [], head: 0, pending: [], parse, toRow };
  for (let i = 1; i < all.length; i++) {
    const row = all[i];
    if (row.every(isBlank)) continue;
    const rn = i + 1;
    const rv = revCell(cell(row, revIndex));
    if (rv !== null && rv > t.head) t.head = rv;
    const id = str(cell(row, 0)).trim();
    const rec = parse(row);
    if (!id) {
      t.invalid.push({ sheet: name, row: rn, reason: 'missing id' });
      continue;
    }
    if (t.byId.has(id)) {
      t.invalid.push({ sheet: name, row: rn, reason: 'duplicate id' });
      continue;
    }
    if (typeof rec === 'string') {
      t.invalid.push({ sheet: name, row: rn, reason: rec });
      t.byId.set(id, { row: rn, buf: -1, rec: null });
    } else {
      t.byId.set(id, { row: rn, buf: -1, rec });
      t.list.push(rec);
    }
  }
  return t;
}

const scanTx = (deps: Deps) => scan<Transaction>(deps, TX_SHEET, 9, (r) => parseTxRow(r, fmtOf(deps)), txToRow);
const scanCat = (deps: Deps) => scan<Category>(deps, CAT_SHEET, 8, parseCatRow, catToRow);

function readSettings(deps: Deps): RemoteSettings {
  const out: RemoteSettings = { ...DEFAULT_SETTINGS };
  let version: unknown = SCHEMA_VERSION;
  for (const row of deps.sheet.readAll(SETTINGS_SHEET).slice(1)) {
    const k = str(cell(row, 0)).trim();
    const v = cell(row, 1);
    if (k === 'schemaVersion') version = typeof v === 'string' ? Number(v) : v;
    else if (k === 'bigAmountMinor') {
      const n = typeof v === 'string' ? Number(v) : v;
      if (typeof n === 'number' && Number.isInteger(n) && n > 0) out.bigAmountMinor = n;
    }
  }
  if (version !== SCHEMA_VERSION) throw new ApiError('SCHEMA_MISMATCH', 'schema version mismatch');
  return out;
}

// ---------- actions ----------

function ok(deps: Deps, data: Rec): ResponseEnvelope {
  return { ok: true, v: 1, serverTime: isoOf(deps.now()), ...data };
}

function ping(deps: Deps): ResponseEnvelope {
  readSettings(deps);
  const head = Math.max(scanTx(deps).head, scanCat(deps).head);
  return ok(deps, { schemaVersion: SCHEMA_VERSION, head });
}

function pull(deps: Deps, req: Rec): ResponseEnvelope {
  const since = req.since === undefined ? 0 : req.since;
  const limit = req.limit === undefined ? MAX_PULL : req.limit;
  if (typeof since !== 'number' || !Number.isInteger(since) || since < 0) throw new ApiError('BAD_REQUEST', 'bad since');
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) throw new ApiError('BAD_REQUEST', 'bad limit');
  const lim = Math.min(limit, MAX_PULL);
  return deps.lock.run(() => {
    const settings = readSettings(deps);
    const tx = scanTx(deps);
    const cat = scanCat(deps);
    const items: { e: 'tx' | 'cat'; rev: number; rec: Transaction | Category }[] = [];
    for (const r of tx.list) if (r.rev > since) items.push({ e: 'tx', rev: r.rev, rec: r });
    for (const r of cat.list) if (r.rev > since) items.push({ e: 'cat', rev: r.rev, rec: r });
    items.sort((a, b) => a.rev - b.rev || (a.e < b.e ? -1 : a.e > b.e ? 1 : 0));
    const page = items.slice(0, lim);
    return ok(deps, {
      head: Math.max(tx.head, cat.head),
      rev: page.length ? page[page.length - 1].rev : since,
      more: items.length > page.length,
      tx: page.filter((i) => i.e === 'tx').map((i) => i.rec),
      cat: page.filter((i) => i.e === 'cat').map((i) => i.rec),
      settings,
      counts: { tx: tx.list.filter((r) => !r.deleted).length, cat: cat.list.length },
      invalid: [...tx.invalid, ...cat.invalid],
    });
  });
}

function push(deps: Deps, req: Rec): ResponseEnvelope {
  const ops = req.ops;
  if (!Array.isArray(ops)) throw new ApiError('BAD_REQUEST', 'ops must be an array');
  if (ops.length > MAX_OPS_PER_PUSH) throw new ApiError('TOO_LARGE', 'too many ops');

  // Validate before taking the lock.
  type Checked = { entity: 'tx'; rec: Transaction } | { entity: 'cat'; rec: Category } | { entity: 'tx' | 'cat'; reason: string };
  const checked: Checked[] = ops.map((raw: unknown): Checked => {
    const op = (raw && typeof raw === 'object' ? raw : {}) as Rec;
    const entity = op.entity === 'tx' || op.entity === 'cat' ? op.entity : null;
    if (!entity) return { entity: 'tx', reason: 'bad entity' };
    if (!op.record || typeof op.record !== 'object' || Array.isArray(op.record)) return { entity, reason: 'bad record' };
    const r = entity === 'tx' ? validateTx(op.record as Rec) : validateCat(op.record as Rec);
    return typeof r === 'string' ? { entity, reason: r } : ({ entity, rec: r } as Checked);
  });

  return deps.lock.run(() => {
    readSettings(deps);
    const now = deps.now();
    const nowIso = isoOf(now);
    const limitIso = isoOf(now + CLOCK_GUARD_MS);
    const tx = scanTx(deps);
    const cat = scanCat(deps);
    let head = Math.max(tx.head, cat.head);
    const results: OpResult[] = [];

    for (let i = 0; i < checked.length; i++) {
      const c = checked[i];
      const id = (ops[i]?.record?.id ?? '') as string;
      const entityOf = c.entity;
      if ('reason' in c) {
        results.push({ entity: entityOf, id: typeof id === 'string' ? id.slice(0, 40) : '', status: 'invalid', reason: c.reason });
        continue;
      }
      // Tables are structurally compatible for what is done below.
      const table = (c.entity === 'tx' ? tx : cat) as unknown as Table<Transaction & Category>;
      const incoming = c.rec as Transaction & Category;
      const eff = incoming.updatedAt > limitIso ? nowIso : incoming.updatedAt;
      const existing = table.byId.get(incoming.id);

      if (existing && existing.rec) {
        const cur = existing.rec;
        if (eff === cur.updatedAt) {
          results.push({ entity: c.entity, id: incoming.id, status: 'duplicate', rev: cur.rev, updatedAt: cur.updatedAt });
          continue;
        }
        if (eff < cur.updatedAt) {
          results.push({ entity: c.entity, id: incoming.id, status: 'stale', record: cur } as OpResult);
          continue;
        }
      }
      // Append or overwrite. createdAt is preserved on overwrite.
      head += 1;
      const next = { ...incoming, updatedAt: eff, rev: head } as Transaction & Category;
      if (c.entity === 'tx' && existing?.rec) next.createdAt = existing.rec.createdAt;
      const row = table.toRow(next);
      if (existing) {
        if (existing.row === null) table.pending[existing.buf] = row;
        else deps.sheet.writeRow(table.name, existing.row, row);
        existing.rec = next;
      } else {
        table.pending.push(row);
        table.byId.set(next.id, { row: null, buf: table.pending.length - 1, rec: next });
      }
      results.push({ entity: c.entity, id: next.id, status: 'applied', rev: head, updatedAt: eff });
    }
    if (tx.pending.length) deps.sheet.append(TX_SHEET, tx.pending);
    if (cat.pending.length) deps.sheet.append(CAT_SHEET, cat.pending);
    return ok(deps, { head, results });
  });
}

// ---------- entry point ----------

export function handleRequest(body: string, deps: Deps): ResponseEnvelope {
  try {
    if (typeof body !== 'string' || body.length > MAX_BODY) return fail('TOO_LARGE', 'request too large');
    let req: unknown;
    try {
      req = JSON.parse(body);
    } catch {
      return fail('BAD_REQUEST', 'invalid json');
    }
    if (!req || typeof req !== 'object' || Array.isArray(req)) return fail('BAD_REQUEST', 'invalid request');
    const r = req as Rec;
    const expected = deps.getToken();
    const given = typeof r.token === 'string' ? r.token : '';
    // Same response for missing and wrong tokens.
    if (!expected || !safeEqual(given, expected) || given === '') return fail('UNAUTHORIZED', 'unauthorized');
    if (r.v !== API_VERSION) return fail('SCHEMA_MISMATCH', 'unsupported api version');
    switch (r.action) {
      case 'ping': return ping(deps);
      case 'pull': return pull(deps, r);
      case 'push': return push(deps, r);
      default: return fail('BAD_REQUEST', 'unknown action');
    }
  } catch (e) {
    if (e instanceof ApiError) return fail(e.code, e.message);
    if (e instanceof LockBusyError) return fail('BUSY', 'busy, retry');
    return fail('INTERNAL', 'internal error');
  }
}

// ---------- manual edits (§3) ----------

export interface EditEvent {
  sheet: string;
  row: number; // first edited row, 1-based
  numRows: number;
  col: number; // first edited column, 1-based
  numCols: number;
}

/** Stamps manually edited data rows. Returns the number of rows stamped. */
export function onEditCore(deps: Deps, ev: EditEvent): number {
  const layout = LAYOUTS.find((l) => l.name === ev.sheet);
  if (!layout || (ev.sheet !== TX_SHEET && ev.sheet !== CAT_SHEET)) return 0;
  const isTx = ev.sheet === TX_SHEET;
  const h = layout.header;
  const iUpdated = h.indexOf('updatedAt');
  const iRev = h.indexOf('rev');
  const touched: number[] = [];
  for (let c = ev.col; c < ev.col + ev.numCols; c++) touched.push(c - 1);
  if (touched.every((c) => c === iUpdated || c === iRev)) return 0;
  const first = Math.max(ev.row, 2);
  const last = Math.min(ev.row + ev.numRows - 1, first + MAX_EDIT_ROWS - 1);
  if (last < first) return 0;

  return deps.lock.run(() => {
    const all = deps.sheet.readAll(ev.sheet);
    let head = Math.max(scanTx(deps).head, scanCat(deps).head);
    const nowIso = isoOf(deps.now());
    let n = 0;
    for (let r = first; r <= last; r++) {
      const src = all[r - 1];
      if (!src || src.every(isBlank)) continue;
      const row = h.map((_, i) => cell(src, i));
      if (isBlank(row[0])) {
        if (!isTx) continue; // category ids are slugs chosen by a human
        row[0] = deps.uuid();
      }
      if (isTx) {
        if (isBlank(row[h.indexOf('createdAt')])) row[h.indexOf('createdAt')] = nowIso;
        if (isBlank(row[h.indexOf('deleted')])) row[h.indexOf('deleted')] = false;
      } else if (isBlank(row[h.indexOf('archived')])) row[h.indexOf('archived')] = false;
      row[iUpdated] = nowIso;
      row[iRev] = ++head;
      deps.sheet.writeRow(ev.sheet, r, row);
      n++;
    }
    return n;
  });
}

// ---------- setup ----------

export interface SetupDeps {
  setup: SetupPort;
  sheet: SheetPort;
  getToken(): string | null;
  setToken(t: string): void;
  /** 32 cryptographically random bytes. */
  randomBytes32(): Uint8Array;
}

/** Creates sheets and Settings rows. Returns a freshly generated token (show it once) or null if one existed. */
export function setupCore(d: SetupDeps, opts: { rotate?: boolean } = {}): { token: string | null } {
  for (const l of LAYOUTS) d.setup.ensureSheet(l);
  const have = new Set(d.sheet.readAll(SETTINGS_SHEET).slice(1).map((r) => str(cell(r, 0)).trim()));
  const missing: unknown[][] = [];
  for (const [k, v] of [['schemaVersion', 1], ['currency', 'UAH'], ['bigAmountMinor', 500000]] as const) {
    if (!have.has(k)) missing.push([k, v]);
  }
  if (missing.length) d.sheet.append(SETTINGS_SHEET, missing);
  if (d.getToken() && !opts.rotate) return { token: null };
  const token = base64url(d.randomBytes32());
  d.setToken(token);
  return { token };
}
