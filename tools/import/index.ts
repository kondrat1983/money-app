// CLI: npm run import -- --dry|--write [--csv path] [--force]. Docs: docs/ARCHITECTURE.md §7.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBridge } from '../../src/lib/bridge/index.ts';
import { buildReport, loadRules, parseSource, plan, reconcile, writePlan } from './lib.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (n: string) => process.argv.includes(n);

async function main(): Promise<number> {
  const write = has('--write');
  if (write === has('--dry')) { console.error('usage: npm run import -- (--dry | --write) [--csv path] [--force]'); return 2; }
  const csv = resolve(root, arg('--csv') ?? 'private/export.csv');
  const reportPath = resolve(root, arg('--report') ?? 'private/import-report.md');
  const runStart = new Date().toISOString();

  const rules = loadRules(resolve(here, 'rules.base.json'), resolve(root, 'private/rules.local.json'));
  const { rows, issues } = parseSource(readFileSync(csv, 'utf8'));
  const p = plan(rows, rules, runStart, issues);
  const rec = reconcile(rows, p.planned);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, buildReport(p, rec, rules, rows.length, runStart));

  const hits = [...p.ruleHits.values()].reduce((a, b) => a + b, 0);
  console.log(`rows read: ${rows.length}; planned: ${p.planned.length}; rule/map hits: ${hits}`);
  console.log(`problems: ${p.issues.length}; unmatched source categories: ${p.unmatched.size}; reconcile: ${rec.ok ? 'OK' : 'FAILED'}`);
  console.log(`report: ${reportPath}`);
  if (p.issues.length || !rec.ok) { console.error('dry-run problems found; see report'); return 1; }
  if (!write) return 0;

  const cfg = JSON.parse(readFileSync(resolve(root, 'private/bridge.json'), 'utf8')) as { url: string; token: string };
  const bridge = createBridge({ url: cfg.url, token: cfg.token, fetchImpl: globalThis.fetch });
  const res = await writePlan(bridge, p, rows, runStart, has('--force'));
  console.log(`pushed categories: ${res.pushedCat}; pushed transactions: ${res.pushedTx}; skipped existing: ${res.skipped}`);
  if (!res.ok) { for (const m of res.messages) console.error(m); console.error('write reconcile FAILED'); return 1; }
  console.log('sheet reconcile: OK');
  return 0;
}

main().then((c) => { process.exitCode = c; }, (e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
