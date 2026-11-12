<script lang="ts">
  import { onMount } from 'svelte'
  import { stores, isBigAmount, type TxInput, type TxPatch } from './lib/stores'
  import type { Transaction } from './lib/model'
  import Main from './ui/main/Main.svelte'
  import TxDetails from './ui/main/TxDetails.svelte'
  // TEMPORARY stubs: switch to ../ui/entry, ../ui/overlay when the real components land.
  import EntrySheet from './ui/_stubs/EntrySheet.svelte'
  import SpentCard from './ui/_stubs/SpentCard.svelte'

  let entryOpen = $state(false)
  let details = $state<Transaction | null>(null)
  let spent = $state<{ type: Transaction['type']; amountMinor: number; big: boolean; key: number } | null>(null)
  let online = $state(typeof navigator === 'undefined' ? true : navigator.onLine)
  let key = 0

  onMount(() => {
    stores.init().catch((e) => console.error('init failed', e))
    const on = () => (online = true)
    const off = () => (online = false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  })

  $effect(() => {
    const t = stores.settings.device.theme
    const root = document.documentElement
    if (t === 'auto') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', t)
  })

  async function save(input: TxInput) {
    entryOpen = false
    const tx = await stores.addTx(input)
    spent = { type: tx.type, amountMinor: tx.amountMinor, big: isBigAmount(tx.amountMinor), key: ++key }
  }
  async function edit(id: string, patch: TxPatch) {
    details = null
    await stores.editTx(id, patch)
  }
  async function remove(id: string) {
    details = null
    await stores.removeTx(id)
  }
</script>

<Main {stores} {online} onAdd={() => (entryOpen = true)} onOpen={(tx) => (details = tx)} />

<EntrySheet
  open={entryOpen}
  categories={stores.categories.active}
  recentIds={stores.categories.recentIds}
  onSave={save}
  onClose={() => (entryOpen = false)}
/>
<SpentCard event={spent} onDone={() => (spent = null)} />
{#if details}
  {#key details.id}
    <TxDetails tx={details} categories={stores.categories.list} onSave={edit} onDelete={remove} onClose={() => (details = null)} />
  {/key}
{/if}
