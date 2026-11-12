# YOU SPENT: architecture contract (v0)

Implement from this file. Where it disagrees with code, this file wins until it is edited.
Inputs: `docs/DECISIONS.md`, `docs/RESEARCH.md`. Labels in §10: Known / Hypothesis / Unknown.

Core idea: the phone holds a cache plus an outbox of **full-row snapshots**; the Sheet holds the truth.
Every write is an idempotent upsert by `id`. Conflicts: last write wins by `updatedAt`. Pull cursor: server `rev`.

## 1. Module map

```
src/lib/model    types, constants, validate*()            deps: none
src/lib/money    minor-unit math, parse, format           deps: none
src/lib/dates    local-date helpers (no Date in UI code)  deps: none
src/lib/bridge   HTTP client for the Apps Script API      deps: model
src/lib/db       IndexedDB (idb): cache, outbox, meta     deps: model, dates
src/lib/sync     flush/pull engine, backoff, triggers     deps: model, db, bridge (injected)
src/lib/stores   Svelte 5 rune stores (*.svelte.ts)       deps: model, db, sync, money, dates
src/ui/          screens + components                     deps: stores, money, dates, model (types only)
bridge/          Apps Script source (core.ts pure + gas.ts adapters -> dist/Code.gs)
tools/import/    Node import pipeline (never bundled into the app)
```

Direction: `ui -> stores -> sync -> {db, bridge}`. Never upward. `ui` never imports `db`, `sync`, `bridge`.
`db` never touches the network; `bridge` never touches IndexedDB. `sync` receives a `Bridge` object, so tests pass a mock.

| Module | Public surface (exact) |
|---|---|
| money | `parseAmountInput(s: string): number \| null` (magnitude in minor; accepts `420`, `420.5`, `420,50`, any spaces) · `signFor(type: TxType, magnitudeMinor: number, transferOut = true): number` · `formatMinor(minor: number, o?: {sign?: boolean}): string` (`2000200 -> "20 002"`, NBSP U+00A0 groups, kopiyky shown only if non-zero) · `sumMinor(xs: number[]): number` |
| dates | `todayLocal(): string` (device timezone, never `toISOString().slice`) · `monthOf(date): string` `'YYYY-MM'` · `monthRange(month): [string, string]` (`['2026-11-01','2026-11-31']`: string bounds, day 31 is a safe upper bound for every month) · `nowIso(): string` · `nextIso(prev: string): string` = `max(now, prev + 1 ms)` |
| bridge | `createBridge(cfg: {url: string, token: string, fetchImpl?: typeof fetch}): Bridge` · `interface Bridge { ping(): Promise<PingRes>; pull(since: number, limit?: number): Promise<PullRes>; push(ops: Op[]): Promise<PushRes> }` · throws `BridgeError {code, retryable}` |
| db | `openDb()` · `saveTx(tx: Transaction)` / `deleteTx(id)` / `saveCategory(c)` (each: one IDB transaction writing cache **and** outbox) · `listMonth(month)` · `listCategories()` · `outboxBatch(n)` · `ackOp(key, sentUpdatedAt)` · `applyPulled(page, cursor)` · `getMeta(k)` / `setMeta(k, v)` · `exportJson()` |
| sync | `createSync({db, getBridge}): {requestFlush(reason): void; fullResync(): Promise<void>; status: Readable<SyncStatus>}` |
| stores | `ledger` (month, rows, totals) · `categories` (ordered, recent-first) · `syncStatus` · `settings` · commands `addTx(input)`, `editTx(id, patch)`, `removeTx(id)`: build the record, call `db.*`, then `sync.requestFlush('save')` |

## 2. Data model (`src/lib/model`)

```ts
type TxType = 'expense' | 'income' | 'transfer';
interface Transaction {
  id: string;          // UUID v4 lowercase, crypto.randomUUID()
  date: string;        // 'YYYY-MM-DD', local calendar date chosen by the user
  type: TxType;
  category: string;    // Category.id (slug)
  memo: string;        // '' allowed, <= 500 chars, trimmed
  amountMinor: number; // signed integer kopiyky. expense < 0, income > 0, transfer != 0 (+ into wallet, - out)
  createdAt: string;   // ISO 8601 UTC with ms: '2026-11-12T10:15:30.123Z'
  updatedAt: string;   // same format; conflict clock
  deleted: boolean;    // tombstone
  rev: number;         // server revision; 0 = never acknowledged
}
interface Category {
  id: string;          // slug /^[a-z0-9][a-z0-9-]{0,39}$/, immutable ('bank-fees')
  name: string;        // display, <= 40 chars, renameable
  kind: TxType;
  icon: string;        // key in the bundled 16x16 sprite set; unknown -> 'coin'
  color: string;       // '#RRGGBB'
  order: number;       // integer, ascending
  archived: boolean;   // hidden from entry grid, still rendered in history
  updatedAt: string; rev: number;
}
interface RemoteSettings { schemaVersion: 1; currency: 'UAH'; bigAmountMinor: number /* 500000 */ }
interface DeviceSettings { bridgeUrl: string; token: string; theme: 'dark'|'light'|'auto'; sound: boolean; haptics: boolean }
```

Decisions:
- **UUID v4, not ULID.** Built into Safari, zero deps; order comes from `date` + `createdAt`, so sortable ids buy nothing.
- **Signed integer kopiyky.** No float sums; kopiyky cost nothing now and avoid a migration later; the sign keeps transfer direction and makes monthly sums match the export exactly. Limit `|amountMinor| <= 1e11`.
- **ISO strings for timestamps**, one format everywhere: readable in the Sheet, and fixed-width UTC strings compare correctly with `<`.
- **`category` is a slug id**, not a name: rename touches one row, the Sheet stays readable. Unknown slug renders as "Unknown", never rejected on pull.
- Totals: `expense` and `income` sums exclude `transfer`. Refunds are entered as income (v0 limitation).
- Sync state is not a field: a record is "unsynced" iff an outbox entry exists for it.

## 3. Sheet schema

Row 1 = header exactly as below, frozen. Data from row 2. The script is **container-bound** (no spreadsheet id in code).

| Sheet | Columns A.. (exact header text) |
|---|---|
| `Transactions` | `id, date, type, category, amount, memo, createdAt, updatedAt, deleted, rev` |
| `Categories` | `id, name, kind, icon, color, order, archived, updatedAt, rev` |
| `Settings` | `key, value` (rows: `schemaVersion`=1, `currency`=UAH, `bigAmountMinor`=500000) |
| `Subscriptions` (reserved, v1; created by `setup()`, never read in v0) | `id, name, category, amount, period, nextDate, active, memo, updatedAt, deleted, rev` |

- Formats: `id, date, type, category, memo, createdAt, updatedAt, name, kind, icon, color` are plain text (`@`), so dates are not re-parsed by locale and a memo starting with `=` stays text. `amount` is a number in **hryvnias** (`amountMinor / 100`; read back with `Math.round(cell * 100)`). `deleted`, `archived` are checkboxes. `rev`, `order` integers.
- Read tolerance: if `date` arrives as a `Date`, format it with the spreadsheet timezone to `yyyy-MM-dd`.
- **Deletes are tombstones**: `deleted = TRUE`, row stays forever. Neither app nor human removes rows. (If a human does, the weekly full pull repairs the phone, §6.)
- **Fast id lookup**: per request, one `getValues()` over the used range, build `Map<id, rowIndex>` in memory (5000 x 10 cells is well under a second). Row numbers are never cached between requests, so manual sorting is harmless. Appends go out as **one** `setValues` block; updates write one row each.
- `rev`: every row write gets `head + 1`, where `head = max(rev)` over Transactions and Categories, computed under the lock. Unique per row, so paging by rev is safe. No separate counter to drift.
- Manual edits: an **installable** `onEdit` trigger (created by `setup()`) takes the lock and, for each edited data row (max 500 per event): fills a blank `id` (`Utilities.getUuid()`) and `createdAt`, sets `updatedAt = now`, `rev = ++head`, defaults `deleted = FALSE`. It does not fire for script writes. Edits that only touch `updatedAt`/`rev` are ignored.
- `setup()` also adds a dropdown on `Transactions!D` from `Categories!A` and warning-protection on `id, createdAt, updatedAt, rev`.

## 4. Apps Script API

One endpoint: `POST <execUrl>`. Deployed "Execute as: Me, access: Anyone". `doGet` returns `{"ok":false}` and nothing else.

```ts
const res = await fetch(url, {
  method: 'POST', redirect: 'follow', credentials: 'omit', cache: 'no-store',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // CORS-simple: no preflight (Apps Script answers OPTIONS with 405)
  body: JSON.stringify({ v: 1, token, action, ...params }),
  signal,                                                    // AbortController, 20 s
});
const json = JSON.parse(await res.text());                   // HTML or bad JSON -> BridgeError('BAD_RESPONSE', retryable)
```

Never `mode: 'no-cors'`, never custom headers, never the token in the URL. The script runs on the POST, then answers 302 to `script.googleusercontent.com`, which fetch follows as a GET. So a write can succeed while the response is lost: every action must be safe to repeat.
HTTP status is always 200; success is `ok`.

```jsonc
// envelope
{ "ok": true,  "v": 1, "serverTime": "2026-11-12T10:15:31.000Z", /* action fields */ }
{ "ok": false, "v": 1, "error": { "code": "UNAUTHORIZED", "message": "…", "retryable": false } }
// codes: UNAUTHORIZED, BAD_REQUEST, SCHEMA_MISMATCH, TOO_LARGE (not retryable) · BUSY, INTERNAL (retryable)

// ping     req {}                      res { "schemaVersion": 1, "head": 5321 }
// pull     req { "since": 5300, "limit": 1000 }
//          res { "head": 5321, "rev": 5321, "more": false,
//                "tx": [Transaction…], "cat": [Category…],          // rev > since, ascending rev, deleted rows included
//                "settings": { "schemaVersion": 1, "currency": "UAH", "bigAmountMinor": 500000 },
//                "counts": { "tx": 4980, "cat": 31 },               // live (non-deleted) valid rows
//                "invalid": [ { "sheet": "Transactions", "row": 812, "reason": "bad date" } ] }
//          "rev" = highest rev in this page (= since if empty). Loop with since = rev while more.
// push     req { "ops": [ { "entity": "tx", "record": Transaction }, { "entity": "cat", "record": Category } ] }   // <= 200 ops
//          res { "head": 5324, "results": [
//                  { "entity": "tx", "id": "…", "status": "applied",   "rev": 5322, "updatedAt": "…" },
//                  { "entity": "tx", "id": "…", "status": "duplicate", "rev": 5310, "updatedAt": "…" },
//                  { "entity": "tx", "id": "…", "status": "stale",     "record": Transaction },   // server row wins
//                  { "entity": "tx", "id": "…", "status": "invalid",   "reason": "amount sign" } ] }   // same order as ops
```

- There is one op kind: **upsert of a full record**. A delete is an upsert with `deleted: true`. The client-sent `rev` is ignored.
- Server rule per op, under the lock: no row with this id -> append, `applied`. Row exists: `op.updatedAt > row.updatedAt` -> overwrite all client columns except `createdAt`, `applied`; equal -> `duplicate` (retry of an applied op); smaller -> `stale`, return the server row.
- **Why LWW by `updatedAt`, with `rev` only as cursor**: an offline phone edit and a manual Sheet edit can only be ordered by when they were made, which a server counter cannot know; and a counter-based cursor means clock skew can never make a pull skip rows.
- Clock guard: if `op.updatedAt > serverTime + 5 min`, the server stores `serverTime` instead and returns it in `updatedAt`.
- `LockService.getScriptLock().waitLock(10000)` around pull, push and `onEdit`; release in `finally`. Timeout -> `BUSY`. Pull is locked too, so a page never sees half a batch and the cursor cannot jump over an unwritten rev.
- Versioning: `v` is the API version. Unknown `v`, or `Settings.schemaVersion` not equal to the script constant -> `SCHEMA_MISMATCH`; the app shows "Update needed" and stops syncing (outbox is kept).
- `bridge/core.ts` holds all logic against a `SheetPort { readAll(sheet): unknown[][]; append(sheet, rows): void; writeRow(sheet, rowIndex, row): void }`; `bridge/gas.ts` adapts SpreadsheetApp / LockService / PropertiesService. esbuild bundles both into `bridge/dist/Code.gs`. A script change needs a **new deployment version** to reach `/exec`.

## 5. Local storage (IndexedDB `youspent`, version 1, via `idb`)

| Store | Key | Indexes | Content |
|---|---|---|---|
| `tx` | `id` | `byDateCreated` on `['date','createdAt']` | live transactions only (tombstones are removed from here) |
| `cat` | `id` | none | all categories incl. archived |
| `outbox` | `key` = `` `${entity}:${id}` `` | `byQueuedAt` | `{ key, entity: 'tx'\|'cat', id, record, updatedAt, queuedAt, attempts, state: 'pending'\|'dead', lastError? }` |
| `meta` | `key` | none | `cursor: number` · `lastSyncAt` · `lastFullPullAt` · `remoteSettings` · `device: DeviceSettings` · `persistGranted: boolean` · `invalidRows: number` |

- Month view: `byDateCreated` range `[[first, ''], [last, '￿']]` from `dates.monthRange`, shown newest first.
- Each local write is one IDB transaction over `tx`/`cat` + `outbox`: either both happen or neither.
- **Compaction is the key**: `outbox.put` on `tx:<id>` replaces the previous snapshot, so N edits to one id are one op. `queuedAt` is kept from the first entry (fair ordering); `attempts` resets.
- Delete: remove from `tx`, put a snapshot with `deleted: true` in `outbox`. Create-then-delete before any push still sends the tombstone (simple, harmless).
- `ackOp(key, sentUpdatedAt)`: delete the outbox entry **only if** `entry.updatedAt === sentUpdatedAt`; otherwise the user edited during the request and the newer snapshot stays queued.
- Every new `updatedAt` is `dates.nextIso(previous.updatedAt)`: strictly increasing per record even if the phone clock is behind.
- `navigator.storage.persist()` at first launch, result in `meta.persistGranted`. Settings screen has "Export JSON" (`db.exportJson()`: tx, cat, outbox).
- Setup: one pasted string `youspent1.<base64url(JSON {u, t})>` fills `device.bridgeUrl` and `device.token`. Safari and the Home Screen app have separate storage, so setup happens inside the installed app.

## 6. Sync algorithm

Triggers -> `requestFlush(reason)`: app start, `pageshow`, `visibilitychange` to visible, `online`, after every save, "Sync now", backoff timer. No service-worker sync (iOS has no Background Sync).
Single flight: one run at a time (`navigator.locks` name `youspent-sync` if present, plus a module flag); a trigger during a run sets `rerun = true`.

One run:
1. No `bridgeUrl`/`token` -> status `unconfigured`, stop. The app still records entries locally.
2. **Push** while pending ops exist: `outboxBatch(50)` ordered `cat` before `tx`, then `queuedAt`. Send. For each result:
   `applied` / `duplicate` -> `ackOp`, set local `rev` and `updatedAt` from the result · `stale` -> overwrite the local record with `result.record` (remove it from `tx` if deleted), `ackOp`, toast "Sheet version kept" · `invalid` -> `state = 'dead'`, `lastError = reason`; shown in the UI with Edit / Discard, never auto-retried, never silently dropped.
3. **Pull** from `meta.cursor` (0 if missing), pages of 1000 until `more` is false. `applyPulled(page, page.rev)` is one IDB transaction: merge rows **and** store the cursor. Merge per row: pending outbox entry for the id and `pending.updatedAt >= row.updatedAt` -> keep local; otherwise the server row wins (write it; delete from `tx` if `deleted`; drop the outbox entry).
4. Full pull instead of step 3 when: no cursor · `head < cursor` (Sheet was restored) · after a normal pull, `counts.tx` differs from the local count of acknowledged live rows · `lastFullPullAt` older than 7 days · "Full resync". Same paging from 0; when finished, delete local rows whose id was not seen and that have no outbox entry.
5. Success: `lastSyncAt = now`, backoff reset, `rerun` -> start again.

Failure: a thrown fetch, timeout, `BAD_RESPONSE`, or a retryable error aborts the run with nothing acknowledged; `attempts++` on the batch. Backoff while the app is visible: 2 s, 5 s, 15 s, 60 s, then 5 min, jitter of 20 %; any trigger retries at once. `navigator.onLine` is only a hint; a failed fetch is what "offline" means. `UNAUTHORIZED` and `SCHEMA_MISMATCH` stop retries until the user acts. Partial failure inside a batch does not exist at the transport level: per-op results are independent and a lost response is replayed whole.
Status: `{ state: 'idle'|'syncing'|'offline'|'error'|'unconfigured', pending: number, dead: number, lastSyncAt: string|null }`. The unsynced count is always visible when above zero.

Scenarios:
- **(a) 3 entries offline, then online.** Three outbox keys. `online` fires, one push with 3 ops, 3 appends, 3 acks. A second trigger during the run only sets `rerun`; the rerun finds an empty outbox. Exactly 3 rows.
- **(b) App killed mid-push.** The server applied the batch, the phone never acked. Next start resends the same snapshots; ids exist with equal `updatedAt`, so all come back `duplicate` and are acked. No new rows.
- **(c) Phone edit + manual Sheet edit of the same row.** `onEdit` stamped the Sheet edit with server time. If the phone edit is newer, push overwrites the whole row (`applied`). If the Sheet edit is newer, push returns `stale` and the phone adopts the Sheet row. Resolution is per row, not per field. Different rows never conflict.
- **(d) Delete offline.** The row leaves the list at once; a tombstone waits in the outbox. On push the server sets `deleted = TRUE` (or appends a tombstone row if the create never arrived). Other devices or a re-pull see `deleted` and drop it.
- **(e) Empty cache, cold start, no network.** The service worker serves the shell. `cat` is empty, so it is seeded from the bundled `defaultCategories` (same slugs as the Sheet seed, `rev: 0`, not queued). The ledger shows "Never synced". Entries are accepted and queued; the first successful run pushes, then full-pulls.
- **(f) IndexedDB evicted by iOS.** `meta.device` is gone -> setup screen -> paste the setup string -> no cursor -> full pull rebuilds everything. Only ops that were still in the outbox are lost; that is why flush is immediate, the count is visible, and persist() is requested.

## 7. Import pipeline (`tools/import/`, Node + tsx, dev machine only)

```
private/export.csv -> parse -> normalize -> apply rules -> validate -> plan (dry run) -> write -> reconcile
```

- Source columns: `Date` (`YYYY-M-D`), `Income/Expenses`, `Category`, `Memo`, `Amount` (`-20 002`: strip all whitespace incl. NBSP, comma -> dot, x100, must be an integer).
- Deterministic id: UUID v5 over `date|kind|category|memo|amount|n` built from **original** values, where `n` is the ordinal of that identical tuple in file order. Re-running the import, or changing rules, updates rows in place and never duplicates.
- `createdAt = <date>T12:00:00.000Z`; `updatedAt` = run start time. Default run **skips ids already in the Sheet** (protects later edits); `--force` overwrites.
- Write through the bridge (`push`, 200 ops per call, categories first), so `rev` is assigned the normal way. Token and URL come from `private/bridge.json`.
- Commands: `npm run import -- --dry` (report only) and `npm run import -- --write`. The owner approves the dry-run report before `--write`.
- Rules: `tools/import/rules.base.json` (committed, generic service names only) merged with `private/rules.local.json` (gitignored, personal names). Local rules are evaluated first; **first match wins**; one rule may set several fields.

```jsonc
{ "version": 1,
  "categories": [ { "id": "subscriptions", "name": "Subscriptions", "kind": "expense", "icon": "scroll", "color": "#B8860B", "order": 40 } ],
  "categoryMap": { "arcade": "arcade", "telephone": "telephone" },      // lowercased source category -> slug, for rows no rule matched
  "rules": [
    { "id": "savings-is-transfer",
      "when": { "kind": "Income", "category": "Savings" },               // all given conditions must hold
      "set":  { "type": "transfer", "category": "savings" } },
    { "id": "xbox-subscription",
      "when": { "category": "Xbox" },
      "set":  { "category": "subscriptions", "memo": "{category} {memo}" } },
    { "id": "bills-internet",
      "when": { "category": "Bills", "memo": "example-provider" },       // memo: JS regex source, flags "iu"
      "set":  { "category": "internet" } } ] }
// when: kind ("Income"|"Expenses"), category (exact, case-insensitive, trimmed), memo (regex), dateFrom, dateTo, amountMin, amountMax (hryvnias, on |amount|)
// set:  type, category (must exist in "categories"), memo (template; {memo} and {category} are the original values)
```

- A row whose final category is not in `categories` fails the run. Amount and date are never changed by rules.
- Reconcile (exit code 1 on any mismatch): source row count = planned = rows found in the Sheet by id; per `YYYY-MM`, signed sum of source `Amount` = sum of `amountMinor / 100` over **all** types (rules move rows between types and categories but never change amounts); grand total; plus a per-rule hit table and the list of unmatched source categories. Report goes to `private/import-report.md`.

## 8. Security

- The token is the only gate. 32 random bytes, base64url, generated by `setup()` into Script Property `TOKEN`, shown once in the script log. On the phone it lives only in `meta.device`. It travels only in the POST body.
- The script rejects, with the same `UNAUTHORIZED` shape for missing and wrong tokens: bad token (constant-time compare) · anything but POST · body over 1 MB or more than 200 ops (`TOO_LARGE`) · non-JSON, unknown `action`, wrong `v` · any record failing validation (id and slug regex, date regex and real calendar date, type enum, integer amount within limit and sign matching type, memo length, ISO timestamps). Unknown fields are dropped, never written. Error messages never echo the token or sheet contents.
- Not in the repo, ever: token, `/exec` URL, spreadsheet id, script id, export data, personal rule patterns. `.gitignore` must contain `private/`, `.clasp.json`, `*.local.json`, `.env*`. Tests and screenshots use invented data only.
- GitHub Pages cannot send headers, so CSP is a `<meta http-equiv>` in `index.html`:
  `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src https://script.google.com https://script.googleusercontent.com; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'`
  Both Google hosts are needed because the redirect target is checked too. Fonts (Cinzel, pixel digits) are self-hosted: no third-party requests, and they work offline. Register the service worker from `main.ts` (`virtual:pwa-register`), not an inline script. Add `'unsafe-inline'` to `style-src` only if a build test shows a real violation.
- Service worker: precache the app shell only; `NetworkOnly` for the two Google hosts. Vite `base` must match the Pages path.
- Memo and names are rendered as text (no `{@html}`).

## 9. Test strategy

- **Mock bridge = the real `bridge/core.ts` over an in-memory `SheetPort`**, wrapped in a `Bridge` with fault switches: `failBefore` (request never arrives), `failAfter` (applied, response lost), `delayMs`, `offline`, `clockOffsetMs`, plus `editInSheet(id, patch)` that mimics `onEdit`. App tests and server logic cannot drift apart.
- Unit (Vitest, `fake-indexeddb`): money parse/format round trips incl. `-20 002` · dates around month ends and midnight in a non-UTC zone · model validation · db atomicity, compaction, `ackOp` guard · bridge core: append / duplicate / stale / invalid, rev uniqueness, paging, clock guard, a memo of `=1+1` round-trips as text · sync: scenarios (a) to (f), edit-during-push, backoff schedule with fake timers, full-pull triggers · import: rule matching order, deterministic ids, reconcile failure on a tampered amount.
- E2E (Playwright, Chromium, `devices['iPhone 14']`, against `vite preview`, service worker on): the bridge URL is intercepted with `page.route` and answered by the same core in the test process (with `access-control-allow-origin: *`). Flow: load, `context.setOffline(true)`, reload (shell from cache), add 3 entries, see the "YOU SPENT" card and unsynced count 3, go online, count reaches 0, the mock sheet has exactly 3 rows; reload mid-push and still 3; edit and delete offline. Screenshots with fake data are the evidence.
- Acceptance checks before "done": all of the above green · `curl -L` ping against the real deployment returns `ok` · real iPhone, installed from Safari: ping, save online, save in airplane mode then reconnect, kill and reopen with a pending entry, manual Sheet edit appears after reopen · imported Sheet passes reconcile · `git grep` for the token prefix and `script.google.com/macros/s/` finds nothing.

## 10. Open risks

| # | Risk | Label | Handling |
|---|---|---|---|
| 1 | Final `/exec` response is readable by JS on iOS Safari (CORS header after the 302) | Hypothesis | First real-device check; fallback is none in v0, so test before building UI polish |
| 2 | Home Screen IndexedDB survives weeks of disuse; `persist()` is granted | Hypothesis | Cache is disposable; outbox flushed at once; unsynced count; Export JSON |
| 3 | Exact iOS eviction rules and quota | Unknown | Same as 2; data volume is under 5 MB |
| 4 | No Background Sync on iOS | Known | Foreground triggers only |
| 5 | Installable `onEdit` fires for multi-row paste with the full range, and not for script writes | Hypothesis | Verify in the bridge acceptance run; weekly full pull covers misses |
| 6 | Text-formatted cells keep `=...` memos and ISO dates as literal text | Hypothesis | Covered by a real-sheet check; fallback: prefix `'` on write |
| 7 | Human deletes or sorts rows, or types a bad value | Known | Sort is harmless; deletions repaired by full pull; bad rows reported in `invalid`, shown as a count |
| 8 | Whole-row LWW can discard one side of a same-row conflict | Known | Accepted for one user; "Sheet version kept" toast; Sheet version history is the undo |
| 9 | Phone clock far off | Known | `nextIso` monotonic stamps, server clamps the future; a phone far behind can lose a same-row conflict |
| 10 | Apps Script latency (1 to 3 s) and 6 min execution cap | Hypothesis | UI never waits on the network; import in 200-op calls |
| 11 | Token is extractable from the phone; anyone holding it can read and write the ledger | Known | Rotate with `setup()`; revoke by redeploying |
| 12 | Chromium iPhone emulation is not WebKit | Known | Real-device checklist in §9 is part of acceptance |
| 13 | Old client after a schema change | Known | `SCHEMA_MISMATCH` stops sync, keeps the outbox, prompts an update |
