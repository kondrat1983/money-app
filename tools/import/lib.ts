// Import pipeline core (docs/ARCHITECTURE.md §7). Pure functions; no network, no bundling into the app.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import type { Bridge, Category, Op, Transaction, TxType } from '../../src/lib/model/index.ts';
import { MAX_ABS_AMOUNT_MINOR, MAX_MEMO, MAX_OPS_PER_PUSH, SLUG_RE } from '../../src/lib/model/index.ts';
import { parseExportDate } from '../../src/lib/dates/index.ts';
import { parseAmountInput } from '../../src/lib/money/index.ts';
import { defaultCategories } from '../../src/lib/stores/defaultCategories.ts';

// ---------- rules ----------

export interface RuleWhen {
  kind?: 'Income' | 'Expenses';
  category?: string;
  memo?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: number;
  amountMax?: number;
}
export interface RuleSet { type?: TxType; category?: string; memo?: string }
export interface Rule { id: string; when: RuleWhen; set: RuleSet }
export interface CategoryDef { id: string; name: string; kind: TxType; icon: string; color: string; order: number }
export interface Rules {
  version: 1;
  categories: CategoryDef[];
  categoryMap: Record<string, string>;
  rules: Rule[];
}

function readRules(path: string): Rules {
  const j = JSON.parse(readFileSync(path, 'utf8')) as Partial<Rules>;
  if (j.version !== 1) throw new Error(`${path}: unsupported rules version`);
  return { version: 1, categories: j.categories ?? [], categoryMap: j.categoryMap ?? {}, rules: j.rules ?? [] };
}

/** Local rules first (first match wins); local categoryMap / categories override base. */
export function mergeRules(base: Rules, local?: Rules): Rules {
  if (!local) return base;
  const cats = new Map<string, CategoryDef>();
  for (const c of [...base.categories, ...local.categories]) cats.set(c.id, c);
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...base.categoryMap, ...local.categoryMap })) map[k.toLowerCase()] = v;
  return { version: 1, categories: [...cats.values()], categoryMap: map, rules: [...local.rules, ...base.rules] };
}

export function loadRules(basePath: string, localPath?: string): Rules {
  const base = readRules(basePath);
  const local = localPath && existsSync(localPath) ? readRules(localPath) : undefined;
  const merged = mergeRules(base, local);
  const seen = new Set<string>();
  for (const r of merged.rules) {
    // duplicates would make hit counts ambiguous
    if (seen.has(r.id)) throw new Error(`duplicate rule id: ${r.id}`);
    seen.add(r.id);
  }
  return merged;
}

// ---------- CSV ----------

/** RFC 4180-ish parser: quoted fields, "" escapes, CRLF/LF, BOM. Returns rows of raw fields. */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  let any = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { q = true; any = true; }
    else if (ch === ',') { row.push(field); field = ''; any = true; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (any || field !== '') { row.push(field); rows.push(row); }
      row = []; field = ''; any = false;
    } else { field += ch; any = true; }
  }
  if (any || field !== '') { row.push(field); rows.push(row); }
  return rows;
}

export interface SourceRow {
  line: number; // 1-based data row number (header excluded)
  rawDate: string;
  rawAmount: string;
  date: string;
  kind: 'Income' | 'Expenses';
  category: string;
  memo: string;
  amountMinor: number; // signed, from the source
  rawKind: string;
  rawCategory: string;
  rawMemo: string;
}
export interface Issue { line: number; reason: string }

const HEADER = ['date', 'income/expenses', 'category', 'memo', 'amount'];

export function parseAmountSigned(raw: string): number | null {
  const s = raw.replace(/\s/g, '');
  const neg = /^[-−]/.test(s);
  const body = neg ? s.slice(1) : s.replace(/^\+/, '');
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(body)) return null; // integer kopiyky only, no exotic shapes
  const minor = parseAmountInput(body);
  if (minor === null || minor === 0) return null;
  return neg ? -minor : minor;
}

export function parseSource(text: string): { rows: SourceRow[]; issues: Issue[] } {
  const table = parseCsv(text);
  const issues: Issue[] = [];
  const rows: SourceRow[] = [];
  const head = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  if (HEADER.some((h, i) => head[i] !== h)) {
    issues.push({ line: 0, reason: 'bad header (expected Date,Income/Expenses,Category,Memo,Amount)' });
    return { rows, issues };
  }
  for (let i = 1; i < table.length; i++) {
    const f = table[i];
    const line = i;
    if (f.length !== 5) { issues.push({ line, reason: `expected 5 fields, got ${f.length}` }); continue; }
    const [rawDate, rawKind, rawCategory, rawMemo, rawAmount] = f;
    let date: string;
    try { date = parseExportDate(rawDate); } catch { issues.push({ line, reason: 'bad date' }); continue; }
    const k = rawKind.trim().toLowerCase();
    const kind = k === 'income' ? 'Income' : k === 'expenses' ? 'Expenses' : null;
    if (!kind) { issues.push({ line, reason: 'bad Income/Expenses value' }); continue; }
    const amountMinor = parseAmountSigned(rawAmount);
    if (amountMinor === null) { issues.push({ line, reason: 'bad amount' }); continue; }
    if (Math.abs(amountMinor) > MAX_ABS_AMOUNT_MINOR) { issues.push({ line, reason: 'amount too large' }); continue; }
    if ((kind === 'Income') !== (amountMinor > 0)) { issues.push({ line, reason: 'sign mismatch with Income/Expenses' }); continue; }
    rows.push({
      line, rawDate, rawAmount, rawKind, rawCategory, rawMemo,
      date, kind, category: rawCategory.trim(), memo: rawMemo.trim(), amountMinor,
    });
  }
  return { rows, issues };
}

// ---------- ids ----------

const NAMESPACE = '6f3c1d0e-5b7a-4c1e-9d3a-2a8e4b6f7c10'; // fixed; changing it changes every id

export function uuidv5(name: string, namespace = NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const h = createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = b.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Ids from ORIGINAL values; n = ordinal of the identical tuple in file order. */
export function assignIds(rows: SourceRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `${r.rawDate}|${r.rawKind}|${r.rawCategory}|${r.rawMemo}|${r.rawAmount}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return uuidv5(`${base}|${n}`);
  });
}

// ---------- planning ----------

export interface Planned {
  tx: Transaction;
  src: SourceRow;
  rule: string; // rule id, 'map', or '' when unmatched
}
export interface Plan {
  planned: Planned[];
  issues: Issue[];
  ruleHits: Map<string, number>;
  unmatched: Map<string, number>; // source category (lowercased) -> rows
  categories: CategoryDef[];
}

function matchRule(r: Rule, row: SourceRow, re: RegExp | null): boolean {
  const w = r.when;
  if (w.kind && w.kind !== row.kind) return false;
  if (w.category !== undefined && w.category.trim().toLowerCase() !== row.category.toLowerCase()) return false;
  if (re && !re.test(row.memo)) return false;
  if (w.dateFrom && row.date < w.dateFrom) return false;
  if (w.dateTo && row.date > w.dateTo) return false;
  const abs = Math.abs(row.amountMinor);
  if (w.amountMin !== undefined && abs < Math.round(w.amountMin * 100)) return false;
  if (w.amountMax !== undefined && abs > Math.round(w.amountMax * 100)) return false;
  return true;
}

export function renderMemo(tpl: string, row: SourceRow): string {
  const s = tpl.replaceAll('{category}', row.category).replaceAll('{memo}', row.memo);
  // Empty {memo} must not leave a dangling separator: "Xbox · " -> "Xbox".
  return s.replace(/^[\s·]+|[\s·]+$/g, '').replace(/\s+/g, ' ').trim();
}

export function plan(rows: SourceRow[], rules: Rules, runStart: string, srcIssues: Issue[] = []): Plan {
  const issues = [...srcIssues];
  const cats = new Map<string, CategoryDef>();
  for (const c of defaultCategories) cats.set(c.id, { id: c.id, name: c.name, kind: c.kind, icon: c.icon, color: c.color, order: c.order });
  for (const c of rules.categories) cats.set(c.id, c);
  const compiled = rules.rules.map((r) => ({ r, re: r.when.memo !== undefined ? new RegExp(r.when.memo, 'iu') : null }));
  const map = new Map(Object.entries(rules.categoryMap).map(([k, v]) => [k.trim().toLowerCase(), v]));
  const ids = assignIds(rows);
  const ruleHits = new Map<string, number>();
  const unmatched = new Map<string, number>();
  const planned: Planned[] = [];

  rows.forEach((row, i) => {
    const hit = compiled.find((c) => matchRule(c.r, row, c.re));
    let type: TxType = row.kind === 'Income' ? 'income' : 'expense';
    let category: string | undefined;
    let memo = row.memo;
    let ruleId = '';
    if (hit) {
      ruleId = hit.r.id;
      if (hit.r.set.type) type = hit.r.set.type;
      category = hit.r.set.category;
      if (hit.r.set.memo !== undefined) memo = renderMemo(hit.r.set.memo, row);
    }
    if (category === undefined) {
      category = map.get(row.category.toLowerCase());
      if (category === undefined) {
        const key = row.category.toLowerCase();
        unmatched.set(key, (unmatched.get(key) ?? 0) + 1);
        issues.push({ line: row.line, reason: 'no rule or categoryMap entry for source category' });
        return;
      }
      if (!hit) ruleId = 'categoryMap';
    }
    const def = cats.get(category);
    if (!SLUG_RE.test(category) || !def) { issues.push({ line: row.line, reason: `unknown target category "${category}"` }); return; }
    if (def.kind !== type) { issues.push({ line: row.line, reason: `category "${category}" is ${def.kind}, row is ${type}` }); return; }
    if (memo.length > MAX_MEMO) { issues.push({ line: row.line, reason: 'memo too long' }); return; }
    ruleHits.set(ruleId, (ruleHits.get(ruleId) ?? 0) + 1);
    planned.push({
      src: row, rule: ruleId,
      tx: {
        id: ids[i], date: row.date, type, category, memo, amountMinor: row.amountMinor,
        createdAt: `${row.date}T12:00:00.000Z`, updatedAt: runStart, deleted: false, rev: 0,
      },
    });
  });
  return { planned, issues, ruleHits, unmatched, categories: [...cats.values()] };
}

// ---------- reconcile ----------

export interface MonthRow {
  month: string;
  srcIncome: number; srcExpense: number; srcNet: number;
  planIncome: number; planExpense: number; planTransfer: number; planNet: number;
  ok: boolean;
}
export interface Reconcile { ok: boolean; months: MonthRow[]; total: MonthRow; problems: string[] }

function blank(month: string): MonthRow {
  return { month, srcIncome: 0, srcExpense: 0, srcNet: 0, planIncome: 0, planExpense: 0, planTransfer: 0, planNet: 0, ok: true };
}

export function reconcile(source: SourceRow[], planned: Planned[]): Reconcile {
  const by = new Map<string, MonthRow>();
  const get = (m: string) => { let r = by.get(m); if (!r) { r = blank(m); by.set(m, r); } return r; };
  for (const s of source) {
    const m = get(s.date.slice(0, 7));
    if (s.kind === 'Income') m.srcIncome += s.amountMinor; else m.srcExpense += s.amountMinor;
    m.srcNet += s.amountMinor;
  }
  for (const p of planned) {
    const m = get(p.tx.date.slice(0, 7));
    if (p.tx.type === 'income') m.planIncome += p.tx.amountMinor;
    else if (p.tx.type === 'expense') m.planExpense += p.tx.amountMinor;
    else m.planTransfer += p.tx.amountMinor;
    m.planNet += p.tx.amountMinor;
  }
  const months = [...by.values()].sort((a, b) => a.month.localeCompare(b.month));
  const total = blank('TOTAL');
  const problems: string[] = [];
  for (const m of months) {
    m.ok = m.srcNet === m.planNet;
    if (!m.ok) problems.push(`month ${m.month}: source sum != planned sum`);
    for (const k of ['srcIncome', 'srcExpense', 'srcNet', 'planIncome', 'planExpense', 'planTransfer', 'planNet'] as const) total[k] += m[k];
  }
  total.ok = total.srcNet === total.planNet;
  if (!total.ok) problems.push('grand total: source sum != planned sum');
  if (source.length !== planned.length) problems.push(`row count: source ${source.length} != planned ${planned.length}`);
  return { ok: problems.length === 0, months, total, problems };
}

// ---------- report ----------

const money = (minor: number) => (minor / 100).toFixed(2);

export function buildReport(p: Plan, rec: Reconcile, rules: Rules, sourceCount: number, runStart: string): string {
  const L: string[] = [];
  L.push('# Import report', '', `Run: ${runStart}`, '');
  L.push(`- Source rows read: ${sourceCount}`, `- Planned transactions: ${p.planned.length}`, `- Problems: ${p.issues.length}`, `- Reconcile: ${rec.ok ? 'OK' : 'FAILED'}`, '');

  L.push('## Rule hits', '', '| rule | hits |', '|---|---:|');
  for (const r of rules.rules) L.push(`| ${r.id} | ${p.ruleHits.get(r.id) ?? 0} |`);
  L.push(`| (categoryMap) | ${p.ruleHits.get('categoryMap') ?? 0} |`, '');

  L.push('## Unmatched source categories', '');
  if (p.unmatched.size === 0) L.push('none', '');
  else { L.push('| source category | rows |', '|---|---:|'); for (const [k, v] of p.unmatched) L.push(`| ${k} | ${v} |`); L.push(''); }

  L.push('## Moves (owner approves this table)', '', '| source kind | source category | -> type | target category | rows |', '|---|---|---|---|---:|');
  const moves = new Map<string, number>();
  for (const x of p.planned) {
    const k = `${x.src.kind}\u0000${x.src.category}\u0000${x.tx.type}\u0000${x.tx.category}`;
    moves.set(k, (moves.get(k) ?? 0) + 1);
  }
  for (const k of [...moves.keys()].sort()) { const [a, b, c, d] = k.split('\u0000'); L.push(`| ${a} | ${b} | ${c} | ${d} | ${moves.get(k)} |`); }
  L.push('');

  L.push('## Per month (UAH)', '', '| month | src income | src expense | plan income | plan expense | plan transfer | src net | plan net | ok |', '|---|---:|---:|---:|---:|---:|---:|---:|:-:|');
  for (const m of [...rec.months, rec.total]) {
    L.push(`| ${m.month} | ${money(m.srcIncome)} | ${money(m.srcExpense)} | ${money(m.planIncome)} | ${money(m.planExpense)} | ${money(m.planTransfer)} | ${money(m.srcNet)} | ${money(m.planNet)} | ${m.ok ? 'yes' : 'NO'} |`);
  }
  L.push('');

  if (p.issues.length || rec.problems.length) {
    L.push('## Problems', '');
    for (const i of p.issues) L.push(`- row ${i.line}: ${i.reason}`);
    for (const x of rec.problems) L.push(`- ${x}`);
    L.push('');
  }
  return L.join('\n');
}

// ---------- write ----------

export interface WriteResult { ok: boolean; messages: string[]; pushedTx: number; pushedCat: number; skipped: number }

async function pullAll(bridge: Bridge): Promise<{ tx: Transaction[]; cat: Category[] }> {
  const tx = new Map<string, Transaction>();
  const cat = new Map<string, Category>();
  let since = 0;
  for (;;) {
    const r = await bridge.pull(since, 1000);
    for (const t of r.tx) tx.set(t.id, t);
    for (const c of r.cat) cat.set(c.id, c);
    if (!r.more) break;
    since = r.rev;
  }
  return { tx: [...tx.values()], cat: [...cat.values()] };
}

async function pushBatches(bridge: Bridge, ops: Op[], messages: string[]): Promise<number> {
  let applied = 0;
  for (let i = 0; i < ops.length; i += MAX_OPS_PER_PUSH) {
    const res = await bridge.push(ops.slice(i, i + MAX_OPS_PER_PUSH));
    for (const r of res.results) {
      if (r.status === 'applied' || r.status === 'duplicate') applied++;
      else messages.push(`push ${r.entity} ${r.id}: ${r.status}${r.status === 'invalid' ? ` (${r.reason})` : ''}`);
    }
  }
  return applied;
}

export async function writePlan(bridge: Bridge, p: Plan, source: SourceRow[], runStart: string, force = false): Promise<WriteResult> {
  const messages: string[] = [];
  const before = await pullAll(bridge);
  const haveTx = new Set(before.tx.map((t) => t.id));
  const haveCat = new Set(before.cat.map((c) => c.id));

  const usedCats = new Set(p.planned.map((x) => x.tx.category));
  const catOps: Op[] = p.categories
    .filter((c) => usedCats.has(c.id) && (force || !haveCat.has(c.id)))
    .map((c) => ({ entity: 'cat' as const, record: { ...c, archived: false, updatedAt: runStart, rev: 0 } }));
  const toWrite = p.planned.filter((x) => force || !haveTx.has(x.tx.id));
  const skipped = p.planned.length - toWrite.length;

  const pushedCat = await pushBatches(bridge, catOps, messages);
  const pushedTx = await pushBatches(bridge, toWrite.map((x) => ({ entity: 'tx' as const, record: x.tx })), messages);

  // Reconcile against the Sheet: rows found by id, live only, and monthly signed sums.
  const after = await pullAll(bridge);
  const mine = new Map(after.tx.filter((t) => !t.deleted).map((t) => [t.id, t]));
  const found = p.planned.filter((x) => mine.has(x.tx.id));
  if (found.length !== p.planned.length) messages.push(`rows found in sheet ${found.length} != planned ${p.planned.length}`);
  const sheetByMonth = new Map<string, number>();
  for (const x of p.planned) {
    const t = mine.get(x.tx.id);
    if (t) sheetByMonth.set(t.date.slice(0, 7), (sheetByMonth.get(t.date.slice(0, 7)) ?? 0) + t.amountMinor);
  }
  const srcByMonth = new Map<string, number>();
  for (const s of source) srcByMonth.set(s.date.slice(0, 7), (srcByMonth.get(s.date.slice(0, 7)) ?? 0) + s.amountMinor);
  for (const m of new Set([...srcByMonth.keys(), ...sheetByMonth.keys()])) {
    if ((srcByMonth.get(m) ?? 0) !== (sheetByMonth.get(m) ?? 0)) messages.push(`month ${m}: sheet sum != source sum`);
  }
  const catIds = new Set(after.cat.map((c) => c.id));
  for (const c of usedCats) if (!catIds.has(c)) messages.push(`category "${c}" missing in sheet`);
  return { ok: messages.length === 0, messages, pushedTx, pushedCat, skipped };
}
