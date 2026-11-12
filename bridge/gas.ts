// Google Apps Script adapters (container-bound). Bundled with core.ts into dist/Code.gs.
import type { Deps, EditEvent, SetupPort, SheetLayout, SheetPort } from './core.ts';
import { handleRequest, LAYOUTS, LockBusyError, onEditCore, setupCore, TX_SHEET, CAT_SHEET } from './core.ts';

// ---- minimal ambient types for the Google globals we use ----
interface GRange {
  getValues(): unknown[][];
  setValues(v: unknown[][]): GRange;
  setNumberFormat(f: string): GRange;
  setNumberFormats(f: string[][]): GRange;
  setDataValidation(r: unknown): GRange;
  setFontWeight(w: string): GRange;
  protect(): { setDescription(d: string): unknown; setWarningOnly(b: boolean): unknown };
}
interface GSheet {
  getName(): string;
  getLastRow(): number;
  getLastColumn(): number;
  getMaxRows(): number;
  getRange(row: number, col: number, numRows?: number, numCols?: number): GRange;
  insertRowsAfter(after: number, n: number): unknown;
  setFrozenRows(n: number): void;
}
interface GSpreadsheet {
  getSheetByName(n: string): GSheet | null;
  insertSheet(n: string): GSheet;
  getSpreadsheetTimeZone(): string;
}
interface GTrigger { getHandlerFunction(): string }
declare const SpreadsheetApp: {
  getActiveSpreadsheet(): GSpreadsheet;
  newDataValidation(): {
    requireCheckbox(): any; requireValueInRange(r: GRange, show?: boolean): any; build(): unknown; setAllowInvalid(b: boolean): any;
  };
};
declare const LockService: { getScriptLock(): { waitLock(ms: number): void; releaseLock(): void } };
declare const PropertiesService: {
  getScriptProperties(): { getProperty(k: string): string | null; setProperty(k: string, v: string): unknown };
};
declare const Utilities: {
  getUuid(): string;
  formatDate(d: Date, tz: string, fmt: string): string;
  computeDigest(alg: unknown, v: string): number[];
  DigestAlgorithm: { SHA_256: unknown };
};
declare const ContentService: {
  createTextOutput(s: string): { setMimeType(m: unknown): unknown };
  MimeType: { JSON: unknown };
};
declare const ScriptApp: {
  getProjectTriggers(): GTrigger[];
  deleteTrigger(t: GTrigger): void;
  newTrigger(fn: string): { forSpreadsheet(ss: GSpreadsheet): { onEdit(): { create(): unknown } } };
};
declare const Logger: { log(m: string): void };

const TOKEN_KEY = 'TOKEN';
const TEXT_FMT = '@';

const ss = (): GSpreadsheet => SpreadsheetApp.getActiveSpreadsheet();

function layoutOf(name: string): SheetLayout | undefined {
  return LAYOUTS.find((l) => l.name === name);
}

function sheetOrThrow(name: string): GSheet {
  const s = ss().getSheetByName(name);
  if (!s) throw new Error('missing sheet');
  return s;
}

const sheetPort: SheetPort = {
  readAll(name) {
    const s = ss().getSheetByName(name);
    if (!s) return [];
    const rows = s.getLastRow();
    const cols = s.getLastColumn();
    return rows < 1 || cols < 1 ? [] : s.getRange(1, 1, rows, cols).getValues();
  },
  append(name, rows) {
    if (!rows.length) return;
    const s = sheetOrThrow(name);
    const start = s.getLastRow() + 1;
    const need = start + rows.length - 1;
    if (s.getMaxRows() < need) s.insertRowsAfter(s.getMaxRows(), need - s.getMaxRows() + 200);
    const l = layoutOf(name);
    const width = rows[0].length;
    const range = s.getRange(start, 1, rows.length, width);
    if (l) {
      const fmts = l.header.map((h) => (l.textColumns.includes(h) ? TEXT_FMT : 'General'));
      range.setNumberFormats(rows.map(() => fmts.slice(0, width)));
    }
    range.setValues(rows);
  },
  writeRow(name, rowIndex, row) {
    sheetOrThrow(name).getRange(rowIndex, 1, 1, row.length).setValues([row]);
  },
};

const lock = {
  run<T>(fn: () => T): T {
    const l = LockService.getScriptLock();
    try {
      l.waitLock(10000);
    } catch {
      throw new LockBusyError();
    }
    try {
      return fn();
    } finally {
      l.releaseLock();
    }
  },
};

function deps(): Deps {
  const tz = ss().getSpreadsheetTimeZone();
  return {
    sheet: sheetPort,
    getToken: () => PropertiesService.getScriptProperties().getProperty(TOKEN_KEY),
    now: () => Date.now(),
    uuid: () => Utilities.getUuid(),
    lock,
    formatDate: (d) => Utilities.formatDate(d, tz, 'yyyy-MM-dd'),
  };
}

const json = (o: unknown) =>
  ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

export function doPost(e: { postData?: { contents?: string } }) {
  const body = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
  return json(handleRequest(body, deps()));
}

export function doGet() {
  return json({ ok: false });
}

export function onEditInstalled(e: { range?: { getSheet(): GSheet; getRow(): number; getNumRows(): number; getColumn(): number; getNumColumns(): number } }) {
  if (!e || !e.range) return;
  const r = e.range;
  const ev: EditEvent = { sheet: r.getSheet().getName(), row: r.getRow(), numRows: r.getNumRows(), col: r.getColumn(), numCols: r.getNumColumns() };
  try {
    onEditCore(deps(), ev);
  } catch (err) {
    Logger.log('onEdit failed: ' + (err instanceof Error ? err.name : 'error'));
  }
}

const setupPort: SetupPort = {
  ensureSheet(l) {
    const book = ss();
    let s = book.getSheetByName(l.name);
    if (!s) s = book.insertSheet(l.name);
    const max = Math.max(s.getMaxRows(), 1000);
    if (s.getMaxRows() < max) s.insertRowsAfter(s.getMaxRows(), max - s.getMaxRows());
    s.getRange(1, 1, 1, l.header.length).setValues([[...l.header]]).setFontWeight('bold');
    s.setFrozenRows(1);
    l.header.forEach((h, i) => {
      const col = i + 1;
      const data = s.getRange(2, col, max - 1, 1);
      if (l.textColumns.includes(h)) data.setNumberFormat(TEXT_FMT);
      if (l.checkboxColumns.includes(h)) data.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    });
    if (l.name === TX_SHEET) {
      const cats = book.getSheetByName(CAT_SHEET);
      if (cats) {
        const rule = SpreadsheetApp.newDataValidation().requireValueInRange(cats.getRange(2, 1, 1000, 1), true).setAllowInvalid(true).build();
        s.getRange(2, 4, max - 1, 1).setDataValidation(rule);
      }
      for (const h of ['id', 'createdAt', 'updatedAt', 'rev']) {
        s.getRange(2, l.header.indexOf(h) + 1, max - 1, 1).protect().setWarningOnly(true);
      }
    }
  },
};

function randomBytes32(): Uint8Array {
  // Utilities.getUuid() is backed by a secure RNG; hash several to get 32 bytes.
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid());
  return Uint8Array.from(d.map((b) => (b + 256) % 256));
}

function runSetup(rotate: boolean): void {
  const props = PropertiesService.getScriptProperties();
  const res = setupCore(
    { setup: setupPort, sheet: sheetPort, getToken: () => props.getProperty(TOKEN_KEY), setToken: (t) => void props.setProperty(TOKEN_KEY, t), randomBytes32 },
    { rotate },
  );
  // Categories sheet may have been created after Transactions: refresh the dropdown.
  setupPort.ensureSheet(LAYOUTS[0]);
  for (const t of ScriptApp.getProjectTriggers()) if (t.getHandlerFunction() === 'onEditInstalled') ScriptApp.deleteTrigger(t);
  ScriptApp.newTrigger('onEditInstalled').forSpreadsheet(ss()).onEdit().create();
  Logger.log(res.token ? 'TOKEN (shown once, copy it now): ' + res.token : 'Setup done. Token already exists (not shown). Run rotateToken() to replace it.');
}

export function setup(): void {
  runSetup(false);
}

export function rotateToken(): void {
  runSetup(true);
}
