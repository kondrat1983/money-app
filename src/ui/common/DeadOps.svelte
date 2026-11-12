<script lang="ts">
  import { formatMinor } from '../../lib/money'
  import type { Category, Transaction } from '../../lib/model'
  import type { OutboxEntry } from '../../lib/db'

  let { count, load, byId, onEdit, onDiscard }: {
    count: number
    load: () => Promise<OutboxEntry[]>
    byId: Map<string, Category>
    onEdit: (e: OutboxEntry) => void
    onDiscard: (key: string) => Promise<void>
  } = $props()

  let open = $state(false)
  let entries = $state<OutboxEntry[]>([])

  async function show() {
    entries = await load()
    open = true
  }
  async function discard(key: string) {
    await onDiscard(key)
    entries = await load()
    if (entries.length === 0) open = false
  }
  function edit(e: OutboxEntry) {
    open = false
    onEdit(e)
  }
  function label(e: OutboxEntry): string {
    if (e.entity === 'tx') {
      const t = e.record as Transaction
      return `${t.date} · ${byId.get(t.category)?.name ?? 'Unknown'} · ${formatMinor(t.amountMinor)}${t.deleted ? ' (delete)' : ''}`
    }
    return `Category ${(e.record as Category).name}`
  }
</script>

{#if count > 0}
  <button type="button" class="banner" data-testid="dead-banner" onclick={show}>
    {count} {count === 1 ? 'change' : 'changes'} rejected by the Sheet. Tap to review.
  </button>
{/if}

{#if open}
  <div class="scrim" role="presentation" onclick={() => (open = false)}></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="Rejected changes">
    <h2>REJECTED CHANGES</h2>
    <ul>
      {#each entries as e (e.key)}
        <li>
          <div class="what">{label(e)}</div>
          <div class="why">{e.lastError ?? 'invalid'}</div>
          <div class="actions">
            {#if e.entity === 'tx' && !(e.record as Transaction).deleted}
              <button type="button" onclick={() => edit(e)}>Edit</button>
            {/if}
            <button type="button" class="danger" onclick={() => discard(e.key)}>Discard</button>
          </div>
        </li>
      {/each}
    </ul>
    <button type="button" onclick={() => (open = false)}>Close</button>
  </div>
{/if}

<style>
  .banner { flex: none; margin-top: 8px; padding: 10px 12px; min-height: 44px; text-align: left; font: inherit; font-size: 13px; color: var(--exp); background: none; border: 1px solid var(--exp); border-radius: var(--radius-sm); cursor: pointer; }
  .scrim { position: fixed; inset: 0; background: rgba(var(--band), 0.6); z-index: 40; }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 41; max-height: 80dvh; overflow-y: auto; background: var(--panel); border-top: 3px double var(--line2); padding: 20px 16px calc(20px + env(safe-area-inset-bottom, 0px)); display: grid; gap: 12px; max-width: 480px; margin: 0 auto; }
  h2 { margin: 0; font-family: var(--display); font-size: 12px; letter-spacing: 0.2em; color: var(--ink3); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  li { border-top: 1px solid var(--line); padding-top: 12px; display: grid; gap: 4px; }
  .why { font-size: 12px; color: var(--ink3); }
  .actions { display: flex; gap: 8px; justify-content: flex-end; }
  button:not(.banner) { font: inherit; min-height: 44px; padding: 0 16px; border-radius: var(--radius-pill); border: 1px solid var(--line2); background: none; color: var(--ink); cursor: pointer; }
  .danger { color: var(--exp); border-color: var(--exp); }
</style>
