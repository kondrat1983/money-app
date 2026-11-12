# YOU SPENT: prototype brief (M1)

Personal expense tracker PWA for iPhone. English UI. Currency UAH (₴), thousands separated by a space: `-20 002`, `207 733`.
This step builds throwaway **interactive HTML prototypes** so the owner can pick a visual direction on their iPhone.

## Signature moment
After every saved expense, a Souls-like death-screen card appears: **YOU SPENT ₴420**.
- Dark band across the screen, large serif caps, slow fade/letter-spacing expansion, about 1 s total.
- It must never block input: any tap dismisses it instantly; the next entry can start right away.
- Income gets a pair: **YOU EARNED ₴…**.
- Big expense (≥ 5 000 ₴) may get a heavier variant (your call).
- `prefers-reduced-motion`: show the text statically for ~0.6 s, no motion.
- Original implementation only: no game fonts, logos, sounds or assets.

## Screens to include (one file, single-page)
1. **Main screen**: month name with prev/next (swipe or arrows), month card (Income / Expenses / Balance in the middle), list of transactions grouped by day, big round **+** button at the bottom (thumb zone).
2. **Entry screen**: opened by morphing the + button. Order is **amount first, then category** (2 taps):
   - Expense / Income toggle at the top (expense = red, income = blue; Souls direction may use dull gold for income).
   - Large amount display + big numeric keypad (digits pop in with a small spring), backspace.
   - Then category grid, 4 per row, icon in a circle, **recent categories first**. Tapping a category saves.
   - Optional memo field and date chip (default "Today"), both secondary.
3. After save: signature moment, then the new row slides into the list and the month card numbers roll up to the new totals. If balance goes negative, the balance reacts (color + tiny shake).

## Data (fake, never real)
Use invented amounts. Seed about 12 transactions over 4-5 days of the current month, e.g. Salary 52 000, Food 640, Subscriptions 199 (memo "Spotify"), Utilities 1 870, Transportation 120, Pizza 389, Family 1 500, Donations 500, Games 449 (memo "Indie game"). Include one 7-digit-ish amount like `207 733` somewhere to prove it fits. No real names anywhere.

Categories (expense): Food, Pizza, Snacks, Fruits, Wine, Transportation, Utilities, Internet, Telephone, Subscriptions, Bank fees, Home, Electronics, Clothing, Health, Gift, Family, Donations, Games, Entertainment, ATM, Cigarettes, Filter, Books, Education, Football, Arcade, Others.
Categories (income): Salary, Refunds, Others.
Long names (e.g. "Transportation", "Entertainment") must wrap or fit, never get cut with "...".
You may draw only ~16 icons and give the rest a fallback glyph; Food, Pizza, Transportation, Utilities, Subscriptions, Family, Donations, Games, Salary, ATM must have real icons.

## Constraints
- Phone-first: on a phone the app fills the screen; on desktop show it centered in a ~390×844 frame.
- Respect safe areas (`env(safe-area-inset-*)`), 60 fps, CSS transforms/opacity for motion, springy physics feel but short (≤ 400 ms for UI motion).
- Must work with `prefers-reduced-motion` (simplified motion).
- Dark-first design, but define a light theme too (see artifact rules below).
- Sound: a small speaker toggle, **off by default**; if on, a short WebAudio-synthesized coin/low drone. No audio files.

## Artifact file rules (the file is published as a claude.ai Artifact)
- Do NOT write `<!doctype>`, `<html>`, `<head>`, `<body>` tags. Start the file with `<title>…</title>`, then `<meta name="claude:viewport-fit-sides" content="cover">`, then `<style>`, markup, `<script>`.
- External scripts only from cdnjs.cloudflare.com / cdn.jsdelivr.net/npm / unpkg.com, pinned exact versions. Prefer no libraries at all (vanilla JS + CSS).
- Fonts only from Google Fonts `<link>`; always a fallback stack.
- No images from the network; draw icons with inline SVG or canvas generated from compact data (e.g. 16×16 pixel maps as strings) in JS.
- Colors as CSS tokens. Dark-first pattern: dark values + `color-scheme: dark` on bare `:root`; light values under `@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) {…} }` and again under `:root[data-theme="light"] {…}`. `body` sets an explicit background from a token.
- Side gutter: `padding-left: max(16px, env(safe-area-inset-left, 0px))` and the same for right, on one outer wrapper. No horizontal page scroll at 390px. Use `height: 100%` rather than `100vh`.
- No `alert/confirm/prompt`, no localStorage required (wrap in try/catch if used).
- `font-variant-numeric: tabular-nums` on amounts.
- Visible keyboard focus; double-quoted attributes; close every element.
