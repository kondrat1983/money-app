// In-memory sheet + Bridge that runs the real bridge/core.ts. Used by sync tests and Playwright.
import type { Bridge, Op, PingRes, PullRes, PushRes } from '../model/index.ts';
import type { Deps, SetupPort, SheetLayout, SheetPort } from '../../../bridge/core.ts';
import { CAT_SHEET, LAYOUTS, TX_SHEET, handleRequest, onEditCore, setupCore } from '../../../bridge/core.ts';
import { BridgeError, unwrapEnvelope } from './index.ts';

export class MemorySheet implements SheetPort, SetupPort {
  sheets = new Map<string, unknown[][]>();

  readAll(sheet: string): unknown[][] {
    return (this.sheets.get(sheet) ?? []).map((r) => [...r]);
  }
  append(sheet: string, rows: unknown[][]): void {
    const s = this.sheets.get(sheet) ?? [];
    this.sheets.set(sheet, s);
    for (const r of rows) s.push([...r]);
  }
  writeRow(sheet: string, rowIndex: number, row: unknown[]): void {
    const s = this.sheets.get(sheet) ?? [];
    this.sheets.set(sheet, s);
    while (s.length < rowIndex) s.push([]);
    s[rowIndex - 1] = [...row];
  }
  ensureSheet(l: SheetLayout): void {
    if (!this.sheets.has(l.name)) this.sheets.set(l.name, [[...l.header]]);
  }
}

export interface MockOptions {
  sheet?: MemorySheet;
  token?: string;
  /** Initial value of the clock offset. */
  clockOffsetMs?: number;
}

let uuidCounter = 0;
function fakeUuid(): string {
  uuidCounter++;
  return `00000000-0000-4000-8000-${uuidCounter.toString(16).padStart(12, '0')}`;
}

export interface MockBridge extends Bridge {
  readonly sheet: MemorySheet;
  readonly token: string;
  /** true or a count of upcoming calls: the request never reaches the server. */
  failBefore: boolean | number;
  /** true or a count: the server applies the request, the response is lost. */
  failAfter: boolean | number;
  delayMs: number;
  offline: boolean;
  /** Shifts the server clock (positive = server ahead). */
  clockOffsetMs: number;
  /** Number of requests that reached the server (not failBefore / offline). */
  requests: number;
  serverNow(): number;
  /** Mimics a human editing the Sheet: patches the row, then the onEdit stamping runs. */
  editInSheet(id: string, patch: Record<string, unknown>): void;
}

function consume(m: MockBridge, key: 'failBefore' | 'failAfter'): boolean {
  const v = m[key];
  if (v === true) return true;
  if (typeof v === 'number' && v > 0) {
    m[key] = v - 1;
    return true;
  }
  return false;
}

export function createMockBridge(opts: MockOptions = {}): MockBridge {
  const sheet = opts.sheet ?? new MemorySheet();
  const token = opts.token ?? 'mock-token';
  const deps: Deps = {
    sheet,
    getToken: () => token,
    now: () => Date.now() + m.clockOffsetMs,
    uuid: fakeUuid,
    lock: { run: (fn) => fn() },
  };
  setupCore({ setup: sheet, sheet, getToken: () => token, setToken: () => {}, randomBytes32: () => new Uint8Array(32) });

  async function roundTrip<T>(action: string, params: Record<string, unknown>): Promise<T> {
    if (m.offline) throw new BridgeError('NETWORK', 'offline', true);
    if (consume(m, 'failBefore')) throw new BridgeError('NETWORK', 'request lost', true);
    m.requests++;
    if (m.delayMs > 0) await new Promise((r) => setTimeout(r, m.delayMs));
    const env = handleRequest(JSON.stringify({ v: 1, token, action, ...params }), deps);
    if (consume(m, 'failAfter')) throw new BridgeError('NETWORK', 'response lost', true);
    return unwrapEnvelope<T>(JSON.parse(JSON.stringify(env)));
  }

  const m: MockBridge = {
    sheet,
    token,
    failBefore: false,
    failAfter: false,
    delayMs: 0,
    offline: false,
    clockOffsetMs: opts.clockOffsetMs ?? 0,
    requests: 0,
    serverNow: () => deps.now(),
    ping: () => roundTrip<PingRes>('ping', {}),
    pull: (since: number, limit?: number) => roundTrip<PullRes>('pull', limit === undefined ? { since } : { since, limit }),
    push: (ops: Op[]) => roundTrip<PushRes>('push', { ops }),
    editInSheet(id, patch) {
      for (const layout of LAYOUTS.filter((l) => l.name === TX_SHEET || l.name === CAT_SHEET)) {
        const rows = sheet.readAll(layout.name);
        const i = rows.findIndex((r, n) => n > 0 && r[0] === id);
        if (i < 0) continue;
        const row = [...rows[i]];
        for (const [k, v] of Object.entries(patch)) {
          if (k === 'amountMinor') row[layout.header.indexOf('amount')] = (v as number) / 100;
          else if (layout.header.includes(k)) row[layout.header.indexOf(k)] = v;
        }
        sheet.writeRow(layout.name, i + 1, row);
        onEditCore(deps, { sheet: layout.name, row: i + 1, numRows: 1, col: 1, numCols: 1 });
        return;
      }
      throw new Error('editInSheet: id not found');
    },
  };
  return m;
}
