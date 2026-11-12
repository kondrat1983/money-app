<script lang="ts">
  import PixelIcon from '../icons/PixelIcon.svelte'
  import { formatMinor } from '../../lib/money'
  import type { Category, Transaction } from '../../lib/model'
  import type { DayGroup } from '../../lib/stores'

  let { groups, byId, ready, lastAddedId, onOpen }: {
    groups: DayGroup[]
    byId: Map<string, Category>
    ready: boolean
    lastAddedId: string | null
    onOpen: (tx: Transaction) => void
  } = $props()
</script>

{#if ready && groups.length === 0}
  <p class="empty" data-testid="empty">NO ENTRIES THIS MONTH<br />TAP + TO RECORD ONE</p>
{/if}

{#each groups as g (g.date)}
  <section aria-label={g.label}>
    <div class="day">
      <span>{g.label.toUpperCase()}</span>
      <i>{formatMinor(g.subtotal, { sign: true })}</i>
    </div>
    {#each g.rows as r (r.id)}
      {@const c = byId.get(r.category)}
      <button type="button" class="row {r.type}" class:enter={r.id === lastAddedId} data-testid="tx-row" onclick={() => onOpen(r)}>
        <span class="ic"><PixelIcon icon={c?.icon ?? 'coin'} size={28} /></span>
        <span class="nm">
          <b>{c?.name ?? 'Unknown'}</b>
          {#if r.memo}<small>{r.memo}</small>{/if}
        </span>
        <span class="am">{formatMinor(r.amountMinor, { sign: r.type !== 'expense' })}</span>
      </button>
    {/each}
  </section>
{/each}

<style>
  .day { display: flex; justify-content: space-between; align-items: baseline; padding: 22px 0 8px; font-family: var(--display); font-size: 11px; font-weight: 500; letter-spacing: 0.18em; color: var(--ink3); }
  .day i { font-style: normal; font-family: var(--pixel); font-size: 10px; letter-spacing: 0.04em; font-variant-numeric: tabular-nums; }
  .row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 58px; padding: 0; background: none; border: 0; border-top: 1px solid var(--line); color: inherit; font: inherit; text-align: left; cursor: pointer; }
  section .row:first-of-type { border-top: 0; }
  .row:focus-visible { outline: 2px solid var(--amber); outline-offset: -2px; }
  .ic { flex: none; width: 44px; height: 44px; border-radius: 50%; background: var(--circle); border: 1px solid var(--line2); display: grid; place-items: center; }
  .nm { flex: 1; min-width: 0; line-height: 1.2; }
  .nm b { display: block; font-weight: 500; font-size: 16px; overflow-wrap: anywhere; }
  .nm small { display: block; font-size: 13px; color: var(--ink3); margin-top: 1px; overflow-wrap: anywhere; }
  .am { font-family: var(--pixel); font-weight: 700; font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; }
  .expense .am { color: var(--exp); }
  .income .am { color: var(--inc); }
  .transfer .am { color: var(--ink2); }
  .enter { animation: rowin 0.34s var(--ease-out) both; animation-delay: 0.62s; }
  @keyframes rowin { from { opacity: 0; transform: translateX(34px); } to { opacity: 1; transform: none; } }
  .empty { padding: 60px 20px; text-align: center; color: var(--ink3); font-family: var(--display); font-size: 13px; letter-spacing: 0.14em; line-height: 1.8; }
  @media (prefers-reduced-motion: reduce) { .enter { animation: none; } }
</style>
