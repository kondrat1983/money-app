import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createMockBridge } from '../../src/lib/bridge/mock.ts';
import { ID_RE } from '../../src/lib/model/index.ts';
import { buildReport, loadRules, mergeRules, parseSource, plan, reconcile, uuidv5, writePlan } from './lib.ts';
import type { Rules } from './lib.ts';

const here = dirname(fileURLToPath(import.meta.url));
const csv = readFileSync(resolve(here, 'fixtures/sample.csv'), 'utf8');
const base = loadRules(resolve(here, 'rules.base.json'));
const T = '2026-01-01T00:00:00.000Z';

function run(rules: Rules = base) {
  const { rows, issues } = parseSource(csv);
  return { rows, p: plan(rows, rules, T, issues) };
}
const find = (p: ReturnType<typeof run>['p'], memo: string) => p.planned.find((x) => x.src.memo === memo)!;

describe('import pipeline', () => {
  it('parses the fixture cleanly', () => {
    const { rows, p } = run();
    expect(rows).toHaveLength(21);
    expect(p.issues).toEqual([]);
    expect(p.planned).toHaveLength(21);
    expect(find(p, 'Cinema, popcorn and drinks').src.amountMinor).toBe(-35000);
    expect(find(p, 'Taxi').tx.amountMinor).toBe(-2000200);
    expect(find(p, 'Газ').tx.amountMinor).toBe(-100000);
    expect(find(p, 'Taxi').tx.date).toBe('2024-01-18');
  });

  it('applies the base rules', () => {
    const { p } = run();
    const cat = (memo: string) => `${find(p, memo).tx.type}/${find(p, memo).tx.category}`;
    expect(cat('From piggy bank')).toBe('transfer/savings');
    expect(cat('Netflix')).toBe('expense/subscriptions');
    expect(cat('Todoist')).toBe('expense/subscriptions');
    expect(cat('осбб січень')).toBe('expense/utilities');
    expect(cat('Газ')).toBe('expense/utilities');
    expect(cat('Network Lviv')).toBe('expense/internet');
    expect(cat('Kyivstar')).toBe('expense/telephone');
    expect(cat('Комісія за переказ')).toBe('expense/bank-fees');
    expect(cat('На ЗСУ')).toBe('expense/donations');
    expect(cat('Stardew valley')).toBe('expense/games');
    expect(cat('Cinema, popcorn and drinks')).toBe('expense/entertainment');
    expect(cat('Невідомо, щось інше')).toBe('expense/bills');
    expect(cat('Found coin')).toBe('income/others-income');
    expect(cat('Taxi')).toBe('expense/transportation');
    expect(p.planned.find((x) => x.src.category === 'cigarette')!.tx.category).toBe('cigarettes');
    expect(p.planned.find((x) => x.src.category === 'Футбол')!.tx.category).toBe('football');
  });

  it('keeps the service name in subscription memos', () => {
    const { p } = run();
    expect(p.planned.find((x) => x.src.category === 'Xbox')!.tx.memo).toBe('Xbox');
    expect(p.planned.find((x) => x.src.category === 'Spotify')!.tx.memo).toBe('Spotify · Family plan');
  });

  it('local rules go first and first match wins', () => {
    const local: Rules = { version: 1, categories: [], categoryMap: {}, rules: [
      { id: 'local-netflix', when: { category: 'Bills', memo: 'netflix' }, set: { category: 'entertainment' } },
    ] };
    const { p } = run(mergeRules(base, local));
    expect(find(p, 'Netflix').tx.category).toBe('entertainment');
    expect(find(p, 'Netflix').rule).toBe('local-netflix');
    expect(find(p, 'Todoist').tx.category).toBe('subscriptions');
  });

  it('reports unmatched categories and sign mismatches', () => {
    const bad = parseSource('Date,Income/Expenses,Category,Memo,Amount\n2024-1-1,Expenses,Zzz,x,-5\n2024-1-2,Expenses,Food,y,5\n');
    expect(bad.issues.map((i) => i.reason)).toEqual(['sign mismatch with Income/Expenses']);
    const p = plan(bad.rows, base, T, bad.issues);
    expect([...p.unmatched.keys()]).toEqual(['zzz']);
    expect(p.issues.length).toBe(2);
  });

  it('ids are deterministic, valid and distinguish identical rows', () => {
    const a = run().p.planned.map((x) => x.tx.id);
    const b = run().p.planned.map((x) => x.tx.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    for (const id of a) expect(id).toMatch(ID_RE);
    expect(uuidv5('x')).toBe(uuidv5('x'));
    // RFC 4122 test vector (DNS namespace, "www.example.com")
    expect(uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('reconciles, and fails when an amount is tampered', () => {
    const { rows, p } = run();
    expect(reconcile(rows, p.planned).ok).toBe(true);
    p.planned[3].tx.amountMinor -= 1;
    const r = reconcile(rows, p.planned);
    expect(r.ok).toBe(false);
    expect(r.problems.some((x) => x.startsWith('month 2024-01'))).toBe(true);
  });

  it('report holds no memos or per-row amounts', () => {
    const { rows, p } = run();
    const rep = buildReport(p, reconcile(rows, p.planned), base, rows.length, T);
    expect(rep).not.toContain('Невідомо');
    expect(rep).not.toContain('Netflix');
    expect(rep).toContain('## Moves');
  });

  it('--write pushes once, skips existing ids, and reconciles against the sheet', async () => {
    const { rows, p } = run();
    const bridge = createMockBridge();
    const r1 = await writePlan(bridge, p, rows, T);
    expect(r1.messages).toEqual([]);
    expect(r1.ok).toBe(true);
    expect(r1.pushedTx).toBe(21);
    const r2 = await writePlan(bridge, p, rows, T);
    expect(r2.ok).toBe(true);
    expect(r2.pushedTx).toBe(0);
    expect(r2.skipped).toBe(21);
    const pulled = await bridge.pull(0, 1000);
    expect(pulled.tx).toHaveLength(21);
  });

  it('--write fails when the sheet differs from the plan', async () => {
    const { rows, p } = run();
    const bridge = createMockBridge();
    await writePlan(bridge, p, rows, T);
    bridge.editInSheet(p.planned[0].tx.id, { amountMinor: p.planned[0].tx.amountMinor - 100 });
    const r = await writePlan(bridge, p, rows, T);
    expect(r.ok).toBe(false);
  });
});
