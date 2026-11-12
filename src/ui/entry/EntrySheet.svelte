<script lang="ts">
  import type { Category, TxType } from '../../lib/model';
  import { parseAmountInput, signFor } from '../../lib/money';
  import PixelIcon from '../icons/PixelIcon.svelte';

  type SaveInput = { type: TxType; amountMinor: number; category: string; memo: string; date: string };

  let {
    open,
    categories,
    recentIds,
    onSave,
    onClose,
  }: {
    open: boolean;
    categories: Category[];
    recentIds: Record<TxType, string[]>;
    onSave: (input: SaveInput) => void;
    onClose: () => void;
  } = $props();

  const MAX_INT = 9;
  const NBSP = ' ';

  let type = $state<'expense' | 'income'>('expense');
  let raw = $state(''); // digits with optional ',' + up to 2 decimals
  let memo = $state('');
  let dateMode = $state<'today' | 'yesterday' | 'custom'>('today');
  let customDate = $state('');
  let shakeKey = $state(0);

  function ymd(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function dayOffset(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return ymd(d);
  }
  const date = $derived(dateMode === 'today' ? dayOffset(0) : dateMode === 'yesterday' ? dayOffset(-1) : customDate || dayOffset(0));

  const minor = $derived(parseAmountInput(raw) ?? 0);
  const hasAmount = $derived(minor > 0);

  const display = $derived.by(() => {
    if (!raw) return '0';
    const [i, f] = raw.split(',');
    const grouped = (i || '0').replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    return f === undefined ? grouped : `${grouped},${f}`;
  });
  const chars = $derived([...display]);
  // Shrink with length so the amount is never clipped.
  const fontSize = $derived(chars.length <= 7 ? 50 : chars.length <= 9 ? 42 : chars.length <= 11 ? 34 : 27);

  const shown = $derived.by(() => {
    const live = categories.filter((c) => c.kind === type && !c.archived);
    const byId = new Map(live.map((c) => [c.id, c]));
    const recent = (recentIds[type] ?? []).map((id) => byId.get(id)).filter((c): c is Category => !!c);
    const seen = new Set(recent.map((c) => c.id));
    const rest = live.filter((c) => !seen.has(c.id)).sort((a, b) => a.order - b.order);
    return [...recent, ...rest];
  });

  function press(k: string) {
    if (k === 'back') {
      raw = raw.slice(0, -1);
      return;
    }
    if (k === ',') {
      if (raw.includes(',')) return;
      raw = (raw || '0') + ',';
      return;
    }
    const [i, f] = raw.split(',');
    if (raw.includes(',')) {
      if ((f ?? '').length >= 2) return;
    } else if ((i ?? '').length >= MAX_INT) return;
    if (raw === '0') raw = k;
    else raw += k;
  }

  function save(cat: Category) {
    if (!hasAmount) {
      shakeKey++;
      return;
    }
    onSave({ type, amountMinor: signFor(type, minor), category: cat.id, memo: memo.trim(), date });
    raw = '';
    memo = '';
    dateMode = 'today';
    customDate = '';
    onClose();
  }

  function onKey(e: KeyboardEvent) {
    if (!open || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    const typing = el?.tagName === 'INPUT';
    if (e.key === 'Escape') {
      onClose();
      e.preventDefault();
      return;
    }
    if (typing) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === ',' || e.key === '.') press(',');
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter' && shown[0]) save(shown[0]);
    else return;
    e.preventDefault();
  }

  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'back'];
  const currency = '₴';
</script>

<svelte:window onkeydown={onKey} />

<div
  class="entry"
  class:open
  class:inc={type === 'income'}
  class:blank={!hasAmount}
  role="dialog"
  aria-modal="true"
  aria-label="New transaction"
  inert={!open}
>
  <header class="ehead">
    <button class="x" type="button" aria-label="Close" onclick={onClose}>
      <svg viewBox="0 0 10 10" width="14" height="14" shape-rendering="crispEdges" fill="currentColor"><path d="M0 0h2v2H0zM8 0h2v2H8zM2 2h2v2H2zM6 2h2v2H6zM4 4h2v2H4zM2 6h2v2H2zM6 6h2v2H6zM0 8h2v2H0zM8 8h2v2H8z" /></svg>
    </button>
    <div class="seg" role="group" aria-label="Type">
      <button type="button" class="e" aria-pressed={type === 'expense'} onclick={() => (type = 'expense')}>EXPENSE</button>
      <button type="button" class="i" aria-pressed={type === 'income'} onclick={() => (type = 'income')}>INCOME</button>
    </div>
    <span class="spacer"></span>
  </header>

  {#key shakeKey}
    <div class="amount" class:nope={shakeKey > 0} aria-live="polite" aria-label={`Amount ${display} hryvnias`}>
      <span class="cur">{currency}</span>
      <span class="val" class:zero={!raw} style:font-size="{fontSize}px">
        {#each chars as ch, i (i)}<span class="ch" class:pop={i === chars.length - 1 && !!raw}>{ch}</span>{/each}
      </span>
    </div>
  {/key}

  <input class="memo" type="text" placeholder="Note (optional)" maxlength="500" bind:value={memo} enterkeyhint="done" />
  <div class="dates">
    <button type="button" class="chip" aria-pressed={dateMode === 'today'} onclick={() => (dateMode = 'today')}>Today</button>
    <button type="button" class="chip" aria-pressed={dateMode === 'yesterday'} onclick={() => (dateMode = 'yesterday')}>Yesterday</button>
    <label class="chip pick" class:on={dateMode === 'custom'}>
      <span>{dateMode === 'custom' && customDate ? customDate : 'Pick date'}</span>
      <input
        type="date"
        max={dayOffset(0)}
        value={customDate}
        aria-label="Pick date"
        onchange={(e) => {
          customDate = e.currentTarget.value;
          dateMode = customDate ? 'custom' : 'today';
        }}
      />
    </label>
  </div>

  <div class="cats" role="group" aria-label="Category">
    {#each shown as c (c.id)}
      <button type="button" class="cat" onclick={() => save(c)}>
        <span class="ic"><PixelIcon icon={c.icon} size={32} /></span>
        <span class="nm">{c.name}</span>
      </button>
    {/each}
  </div>

  <div class="keys" role="group" aria-label="Keypad">
    {#each KEYS as k (k)}
      <button type="button" aria-label={k === 'back' ? 'Backspace' : k === ',' ? 'Decimal comma' : k} onclick={() => press(k)}>
        {#if k === 'back'}
          <svg viewBox="0 0 16 10" width="26" height="17" shape-rendering="crispEdges" fill="currentColor"><path d="M4 0h12v1H5v1H4zM3 1h1v1H3zM2 2h1v1H2zM1 3h1v1H1zM0 4h1v2H0zM1 6h1v1H1zM2 7h1v1H2zM3 8h1v1H3zM4 9h12v1H4zM15 1h1v8h-1zM7 3h1v1H7zM8 4h1v1H8zM9 5h1v1H9zM10 6h1v1h-1zM11 3h1v1h-1zM10 4h1v1h-1zM8 6h1v1H8zM7 7h1v1H7z" /></svg>
        {:else}
          {k}
        {/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .entry {
    --fx: 50%;
    --fy: calc(100% - 63px);
    position: absolute;
    inset: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--ink);
    padding: env(safe-area-inset-top, 0px) max(16px, env(safe-area-inset-right, 0px)) env(safe-area-inset-bottom, 0px) max(16px, env(safe-area-inset-left, 0px));
    visibility: hidden;
    clip-path: circle(0px at var(--fx) var(--fy));
    transition: clip-path 0.3s var(--ease-in), visibility 0s linear 0.3s;
  }
  .entry.open {
    visibility: visible;
    clip-path: circle(1400px at var(--fx) var(--fy));
    transition: clip-path 0.38s var(--ease-out), visibility 0s;
  }
  button {
    font: inherit;
    color: inherit;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }
  button:focus-visible,
  .chip:focus-within {
    outline: 2px solid var(--amber);
    outline-offset: 2px;
  }
  .ehead {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 62px;
    padding-top: 10px;
  }
  .x,
  .spacer {
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    color: var(--ink2);
  }
  .seg {
    display: flex;
    border: 1px solid var(--line2);
    border-radius: var(--radius-pill);
    padding: 3px;
  }
  .seg button {
    font-family: var(--display);
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 0.16em;
    padding: 9px 14px 8px 17px;
    min-height: 34px;
    border-radius: var(--radius-pill);
    color: var(--ink3);
  }
  .seg .e[aria-pressed='true'] {
    background: var(--exp);
    color: #f4e8d4;
  }
  .seg .i[aria-pressed='true'] {
    background: var(--inc);
    color: #0f1520;
  }
  .amount {
    flex: none;
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 8px;
    height: 74px;
    padding-top: 6px;
    white-space: nowrap;
    overflow: hidden;
  }
  .amount.nope {
    animation: shake 0.3s;
  }
  .cur {
    font-family: var(--text);
    font-weight: 500;
    font-size: 26px;
    color: var(--ink3);
  }
  .val {
    font-family: var(--pixel);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: var(--exp);
    display: inline-flex;
  }
  .inc .val {
    color: var(--inc);
  }
  .val.zero {
    opacity: 0.35;
  }
  .ch {
    display: inline-block;
    white-space: pre;
  }
  .ch.pop {
    animation: pop 0.26s var(--ease-spring);
  }
  .memo {
    flex: none;
    width: 100%;
    background: none;
    border: 0;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    color: var(--ink);
    font: inherit;
    font-size: 16px;
    padding: 8px 2px;
    text-align: center;
  }
  .memo::placeholder {
    color: var(--ink3);
  }
  .memo:focus-visible {
    outline: 2px solid var(--amber);
    outline-offset: 2px;
  }
  .dates {
    flex: none;
    display: flex;
    justify-content: center;
    gap: 8px;
    padding: 8px 0 0;
  }
  .chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    font-size: 13px;
    font-weight: 500;
    color: var(--ink2);
    border: 1px solid var(--line2);
    border-radius: var(--radius-pill);
    padding: 6px 12px;
    min-height: 32px;
    white-space: nowrap;
  }
  .chip[aria-pressed='true'],
  .chip.on {
    color: var(--amber);
    border-color: var(--amber);
  }
  .pick input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }
  .cats {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    align-content: start;
    gap: 12px 0;
    padding: 12px 0;
    transition: opacity var(--dur-base);
  }
  .cats::-webkit-scrollbar {
    display: none;
  }
  .blank .cats {
    opacity: 0.55;
  }
  .cat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    padding: 0;
    min-width: 0;
  }
  .ic {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--circle);
    border: 1px solid var(--line2);
    display: grid;
    place-items: center;
    transition: transform 0.16s var(--ease-spring), border-color 0.16s;
  }
  .cat:active .ic {
    transform: scale(0.9);
    border-color: var(--amber);
  }
  .nm {
    font-size: 12px;
    font-weight: 500;
    line-height: 1.1;
    text-align: center;
    color: var(--ink2);
    overflow-wrap: anywhere;
    max-width: 100%;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .keys {
    flex: none;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border-top: 1px solid var(--line);
    margin: 0 calc(-1 * max(16px, env(safe-area-inset-left, 0px)));
    padding-bottom: 6px;
  }
  .keys button {
    height: clamp(42px, 6vh, 52px);
    font-family: var(--display);
    font-weight: 500;
    font-size: 24px;
    display: grid;
    place-items: center;
    transition: background var(--dur-fast), transform 0.14s var(--ease-spring);
  }
  .keys button:active {
    background: var(--bg2);
    transform: scale(0.94);
  }
  .keys svg {
    color: var(--ink2);
  }
  @keyframes pop {
    0% {
      transform: scale(0.5) translateY(6px);
      opacity: 0.2;
    }
    100% {
      transform: none;
      opacity: 1;
    }
  }
  @keyframes shake {
    0%,
    100% {
      transform: translateX(0);
    }
    20% {
      transform: translateX(-7px);
    }
    45% {
      transform: translateX(6px);
    }
    70% {
      transform: translateX(-3px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .entry,
    .entry.open {
      transition: opacity 0.01s, visibility 0s;
      clip-path: none;
    }
    .ch.pop,
    .amount.nope {
      animation: none;
    }
    .ic,
    .keys button {
      transition: none;
    }
  }
</style>
