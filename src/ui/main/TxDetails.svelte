<script lang="ts">
  import { formatMinor, parseAmountInput, signFor } from '../../lib/money'
  import type { Category, Transaction } from '../../lib/model'
  import type { TxPatch } from '../../lib/stores'

  let { tx, categories, onSave, onDelete, onClose }: {
    tx: Transaction
    categories: Category[]
    onSave: (id: string, patch: TxPatch) => void
    onDelete: (id: string) => void
    onClose: () => void
  } = $props()

  const init = (() => tx)()
  const centsToInput = (m: number) => formatMinor(Math.abs(m)).replace(/\s/g, '').replace(/ /g, '')
  let amount = $state(centsToInput(init.amountMinor))
  let category = $state(init.category)
  let memo = $state(init.memo)
  let date = $state(init.date)
  let confirming = $state(false)

  const options = $derived(categories.filter((c) => c.kind === init.type && (!c.archived || c.id === init.category)))
  const mag = $derived(parseAmountInput(amount))
  const valid = $derived(mag !== null && mag > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && memo.length <= 500)

  function save() {
    if (!valid || mag === null) return
    onSave(init.id, {
      amountMinor: signFor(init.type, mag, init.amountMinor < 0),
      category,
      memo,
      date,
    })
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<div class="scrim" role="presentation" onclick={onClose}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label="Entry details" data-testid="tx-details">
  <h2>{init.type.toUpperCase()}</h2>
  <label>Amount (₴)
    <input inputmode="decimal" bind:value={amount} aria-invalid={!valid} />
  </label>
  <label>Category
    <select bind:value={category}>
      {#each options as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
    </select>
  </label>
  <label>Memo
    <input maxlength="500" bind:value={memo} />
  </label>
  <label>Date
    <input type="date" bind:value={date} />
  </label>

  {#if confirming}
    <p class="warn" role="alert">Delete this entry?</p>
    <div class="actions">
      <button type="button" onclick={() => (confirming = false)}>Keep</button>
      <button type="button" class="danger" onclick={() => onDelete(init.id)}>Yes, delete</button>
    </div>
  {:else}
    <div class="actions">
      <button type="button" class="danger ghost" onclick={() => (confirming = true)}>Delete</button>
      <button type="button" onclick={onClose}>Cancel</button>
      <button type="button" class="primary" disabled={!valid} onclick={save}>Save</button>
    </div>
  {/if}
</div>

<style>
  .scrim { position: fixed; inset: 0; background: rgba(var(--band), 0.6); z-index: 30; }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 31; background: var(--panel); border-top: 3px double var(--line2); padding: 20px max(16px, env(safe-area-inset-right, 0px)) calc(20px + env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px)); display: grid; gap: 12px; max-width: 480px; margin: 0 auto; animation: up var(--dur-slow) var(--ease-out); }
  @keyframes up { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
  h2 { margin: 0; font-family: var(--display); font-size: 12px; letter-spacing: 0.2em; color: var(--ink3); }
  label { display: grid; gap: 4px; font-size: 12px; color: var(--ink3); }
  input, select { font: inherit; font-size: 16px; color: var(--ink); background: var(--bg2); border: 1px solid var(--line2); border-radius: var(--radius-sm); padding: 10px; min-height: 44px; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; }
  button { font: inherit; min-height: 44px; padding: 0 16px; border-radius: var(--radius-pill); border: 1px solid var(--line2); background: none; color: var(--ink); cursor: pointer; }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
  .primary { background: var(--amber); color: var(--on-amber); border-color: var(--amber); }
  .primary:disabled { opacity: 0.4; }
  .danger { color: var(--exp); border-color: var(--exp); }
  .ghost { margin-right: auto; }
  .warn { margin: 0; color: var(--exp); }
</style>
