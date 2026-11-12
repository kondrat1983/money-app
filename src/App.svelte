<script lang="ts">
  import { onMount } from 'svelte'
  import { db, stores, isBigAmount, type TxInput, type TxPatch } from './lib/stores'
  import { startApp, sync } from './lib/stores/app'
  import { coin, setSoundEnabled } from './lib/sound'
  import type { Transaction } from './lib/model'
  import type { OutboxEntry } from './lib/db'
  import Main from './ui/main/Main.svelte'
  import TxDetails from './ui/main/TxDetails.svelte'
  import EntrySheet from './ui/entry/EntrySheet.svelte'
  import SpentCard from './ui/overlay/SpentCard.svelte'
  import Settings from './ui/settings/Settings.svelte'
  import DeadOps from './ui/common/DeadOps.svelte'
  import Toast from './ui/common/Toast.svelte'

  let entryOpen = $state(false)
  let settingsOpen = $state(false)
  let details = $state<Transaction | null>(null)
  let spent = $state<{ type: Transaction['type']; amountMinor: number; big: boolean; key: number } | null>(null)
  let online = $state(typeof navigator === 'undefined' ? true : navigator.onLine)
  let toast = $state<string | null>(null)
  let syncStatus = $state(sync.status.get())
  let key = 0
  let keptSeen = sync.status.get().sheetVersionKept

  onMount(() => {
    startApp().catch((e) => console.error('init failed', e))
    const unsub = sync.status.subscribe((s) => {
      syncStatus = s
      if (s.sheetVersionKept > keptSeen) toast = 'Sheet version kept'
      keptSeen = s.sheetVersionKept
    })
    const on = () => (online = true)
    const off = () => (online = false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      unsub()
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
  $effect(() => setSoundEnabled(stores.settings.device.sound))

  async function save(input: TxInput) {
    entryOpen = false
    const tx = await stores.addTx(input)
    coin()
    spent = { type: tx.type, amountMinor: tx.amountMinor, big: isBigAmount(tx.amountMinor), key: ++key }
  }
  async function edit(id: string, patch: TxPatch) {
    details = null
    if (stores.ledger.rows.some((r) => r.id === id)) await stores.editTx(id, patch)
    else {
      // Rejected (dead) entry that is not in the visible month: re-save it, which re-queues it.
      await db.saveTx({ ...(await currentRecord(id)), ...patch })
      await stores.ledger.refresh()
      stores.hooks.onSaved()
    }
  }
  async function currentRecord(id: string): Promise<Transaction> {
    const dead = (await db.listDead()).find((e) => e.key === `tx:${id}`)
    return dead!.record as Transaction
  }
  async function remove(id: string) {
    details = null
    await stores.removeTx(id)
  }
  async function discardDead(k: string) {
    await db.discardDead(k)
    sync.requestFlush('user') // refreshes the counts
  }
</script>

<div class="app">
  <Main {stores} {online} onAdd={() => (entryOpen = true)} onOpen={(tx) => (details = tx)} onSettings={() => (settingsOpen = true)}>
    {#snippet notice()}
      <DeadOps
        count={stores.syncStatus.value.dead}
        load={() => db.listDead()}
        byId={stores.categories.byId}
        onEdit={(e: OutboxEntry) => (details = e.record as Transaction)}
        onDiscard={discardDead}
      />
    {/snippet}
  </Main>

  <EntrySheet
    open={entryOpen}
    categories={stores.categories.active}
    recentIds={stores.categories.recentIds}
    onSave={save}
    onClose={() => (entryOpen = false)}
  />
  <SpentCard event={spent} onDone={() => (spent = null)} />
</div>
{#if details}
  {#key details.id}
    <TxDetails tx={details} categories={stores.categories.list} onSave={edit} onDelete={remove} onClose={() => (details = null)} />
  {/key}
{/if}
{#if settingsOpen}
  <Settings {stores} {sync} {db} status={syncStatus} onClose={() => (settingsOpen = false)} />
{/if}
<Toast message={toast} onDone={() => (toast = null)} />

<style>
  .app { position: relative; height: 100dvh; overflow: hidden; }
</style>
