<script lang="ts">
  import { untrack } from 'svelte'
  import RollNumber from '../common/RollNumber.svelte'
  import type { Totals } from '../../lib/stores'

  let { totals }: { totals: Totals } = $props()

  const neg = $derived(totals.balance < 0)
  let shake = $state(false)
  let prev = untrack(() => totals.balance)
  $effect(() => {
    const b = totals.balance
    if (b < 0 && b < prev) {
      shake = false
      requestAnimationFrame(() => (shake = true))
    }
    prev = b
  })
</script>

<section class="card" aria-label="Month summary" data-testid="month-card">
  <div class="cell inc">
    <span class="lbl">INCOME</span>
    <output data-testid="income"><RollNumber value={totals.income} /></output>
  </div>
  <div class="cell exp">
    <span class="lbl">EXPENSES</span>
    <output data-testid="expense"><RollNumber value={totals.expense} /></output>
  </div>
  <div class="cell bal">
    <span class="lbl">BALANCE</span>
    <output class:neg class:shake data-testid="balance" onanimationend={() => (shake = false)}><RollNumber value={totals.balance} /></output>
  </div>
</section>

<style>
  .card { flex: none; margin-top: 6px; background: var(--panel); border-top: 3px double var(--line2); border-bottom: 1px solid var(--line); display: grid; grid-template-columns: 1fr 1fr 1.25fr; }
  .cell { padding: 18px 6px 14px 12px; min-width: 0; }
  .cell + .cell { border-left: 1px solid var(--line); }
  .lbl { display: block; font-family: var(--display); font-weight: 500; font-size: 10px; letter-spacing: 0.2em; color: var(--ink3); margin-bottom: 9px; }
  output { display: block; font-family: var(--pixel); font-weight: 700; font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .inc output { color: var(--inc); }
  .exp output { color: var(--exp); }
  .bal output { color: var(--ink); font-size: 15px; }
  .bal output.neg { color: var(--exp); }
  .bal output.shake { animation: shake 0.32s cubic-bezier(0.3, 0.7, 0.4, 1); }
  @keyframes shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-5px); } 45% { transform: translateX(4px); } 70% { transform: translateX(-2px); } }
  @media (prefers-reduced-motion: reduce) { .bal output.shake { animation: none; } }
</style>
