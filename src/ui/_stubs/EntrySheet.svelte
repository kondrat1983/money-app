<!-- TEMPORARY stub. Real component: src/ui/entry/EntrySheet.svelte -->
<script lang="ts">
  import { parseAmountInput, signFor } from '../../lib/money'
  import { todayLocal } from '../../lib/dates'
  import type { Category, TxType } from '../../lib/model'
  type Input = { type: TxType; amountMinor: number; category: string; memo: string; date: string }
  let { open, categories, onSave, onClose }: {
    open: boolean
    categories: Category[]
    recentIds: Record<TxType, string[]>
    onSave: (i: Input) => void
    onClose: () => void
  } = $props()
  let amount = $state('')
  let cat = $state('')
  function save() {
    const mag = parseAmountInput(amount)
    const c = cat || categories.find((x) => x.kind === 'expense')?.id
    if (mag === null || !c) return
    onSave({ type: 'expense', amountMinor: signFor('expense', mag), category: c, memo: '', date: todayLocal() })
    amount = ''
  }
</script>

{#if open}
  <div class="stub" role="dialog" aria-label="New entry (stub)">
    <input aria-label="Amount" inputmode="decimal" bind:value={amount} />
    <select aria-label="Category" bind:value={cat}>
      {#each categories.filter((c) => c.kind === 'expense') as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
    </select>
    <button type="button" onclick={save}>Save</button>
    <button type="button" onclick={onClose}>Close</button>
  </div>
{/if}

<style>
  .stub { position: fixed; inset: auto 0 0 0; background: var(--panel); padding: 16px; display: flex; gap: 8px; z-index: 20; }
</style>
