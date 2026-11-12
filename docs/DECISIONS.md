# YOU SPENT: decisions log

No personal data in this repo: no real amounts, names, tokens or spreadsheet IDs. Tests use invented data.

## Product
- Name: **YOU SPENT**. English UI. Currency UAH (₴), thousands separator is a space (`-20 002`).
- Single user, iPhone, installed as a PWA from Safari. Not in the App Store.
- Signature moment: after each save a Souls-like card "YOU SPENT ₴420" (~1 s, any tap dismisses, never blocks input). Income: "YOU EARNED". Heavier variant at ≥ 5 000 ₴. Reduced motion: static text ~0.6 s.
- Visual direction: **Hybrid** (`prototypes/hybrid.html` is the reference): dark-fantasy ledger, carved serif display (Cinzel), pixel-art 16×16 category icons, pixel digits for amounts, blood-red expenses, blue income, amber accent, light theme too.
- Sounds exist, **off by default** (WebAudio synth, no files).
- Entry flow: amount first, then category (2 taps). Recent categories first.

## Data
- Google Sheets is the source of truth. A **new** working spreadsheet; the original export is never modified.
- Bridge: Google Apps Script web app. Token stored only on the phone.
- Offline required: IndexedDB cache + outbox, flush on open / `online` / `visibilitychange` / after save (no Background Sync on iOS, see `docs/RESEARCH.md`).
- Transaction types: `expense`, `income`, `transfer`. Transfers are excluded from income and expense totals.
- Single wallet in v0 (no accounts).

## Import rules (history since 2021)
- Income `Savings` → type `transfer`.
- `ATM` stays an expense. ATM rows whose memo shows a transfer to a person's card → category `Family`.
- Category regrouping:
  - Subscriptions (Xbox, PlayStation Plus, YouTube premium, Spotify, and Bills/Entertainment rows with subscription memos such as Netflix, Todoist, ChatGPT, Claude, Roblox) → `Subscriptions`, service name kept in memo.
  - `Bills` split into `Utilities` (housing association, gas, communal), `Internet` (network provider), `Bank fees` (card service, top-up commission); mobile operator → `Telephone`.
  - `Others`: donations → `Donations`, transfers to people → `Family`.
  - One-off game purchases in `Entertainment` → `Games`.
  - Normalize case (`arcade` → `Arcade`, `network lviv` merged).
  - Ambiguous rows stay where they are. The owner approves the rule table before import.
- Mapping rules that need personal names live outside the repo (local config), never committed.

## Engineering
- Stack: Svelte 5 + Vite + TypeScript, `idb`, `vite-plugin-pwa`, Vitest, Playwright.
- Hosting: GitHub Pages from this public repo; deploy only after owner approval.
- "Done" requires evidence (test output, screenshots with fake data).
