<script lang="ts">
  import { monthLabel } from '../../lib/stores'
  import SyncPill from '../common/SyncPill.svelte'
  import type { SyncStatus } from '../../lib/stores'

  let { month, status, online, onPrev, onNext }: {
    month: string
    status: SyncStatus
    online: boolean
    onPrev: () => void
    onNext: () => void
  } = $props()

  const label = $derived(monthLabel(month))
</script>

<header>
  <div class="top">
    <span class="brand">YOU SPENT</span>
    <SyncPill {status} {online} />
  </div>
  <div class="nav">
    <button type="button" class="arrow" aria-label="Previous month" onclick={onPrev}>
      <svg viewBox="0 0 12 16" aria-hidden="true"><path d="M9 2 3 8l6 6" fill="none" stroke="currentColor" stroke-width="2" /></svg>
    </button>
    <div class="mname" aria-live="polite">
      <b data-testid="month-name">{label.name.toUpperCase()}</b>
      <span data-testid="month-year">{label.year}</span>
    </div>
    <button type="button" class="arrow" aria-label="Next month" onclick={onNext}>
      <svg viewBox="0 0 12 16" aria-hidden="true"><path d="m3 2 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" /></svg>
    </button>
  </div>
</header>

<style>
  header { flex: none; padding-top: calc(env(safe-area-inset-top, 0px) + 8px); }
  .top { display: flex; align-items: center; justify-content: space-between; min-height: 32px; }
  .brand { font-family: var(--display); font-weight: 700; font-size: 11px; letter-spacing: 0.24em; color: var(--ink3); }
  .nav { display: flex; align-items: center; justify-content: space-between; height: 64px; }
  .mname { text-align: center; }
  .mname b { display: block; font-family: var(--display); font-weight: 700; font-size: 19px; letter-spacing: 0.16em; margin-right: -0.16em; }
  .mname span { display: block; font-family: var(--pixel); font-size: 9px; letter-spacing: 0.3em; margin-top: 6px; color: var(--ink3); margin-right: -0.3em; }
  .arrow { width: 44px; height: 44px; display: grid; place-items: center; color: var(--ink2); background: none; border: 0; cursor: pointer; }
  .arrow svg { width: 12px; height: 16px; }
  .arrow:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; border-radius: var(--radius-sm); }
</style>
