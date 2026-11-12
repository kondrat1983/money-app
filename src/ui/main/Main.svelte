<script lang="ts">
  import MonthHeader from './MonthHeader.svelte'
  import MonthCard from './MonthCard.svelte'
  import TxList from './TxList.svelte'
  import type { Stores } from '../../lib/stores'
  import type { Transaction } from '../../lib/model'

  let { stores, online, onAdd, onOpen }: {
    stores: Stores
    online: boolean
    onAdd: () => void
    onOpen: (tx: Transaction) => void
  } = $props()

  const ledger = $derived(stores.ledger)
  const categories = $derived(stores.categories)
  const syncStatus = $derived(stores.syncStatus)

  let x0 = 0
  let y0 = 0
  let tracking = false
  function down(e: TouchEvent) {
    const t = e.touches[0]
    x0 = t.clientX
    y0 = t.clientY
    tracking = e.touches.length === 1
  }
  function up(e: TouchEvent) {
    if (!tracking) return
    tracking = false
    const t = e.changedTouches[0]
    const dx = t.clientX - x0
    const dy = t.clientY - y0
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0) ledger.prev()
      else ledger.next()
    }
  }
</script>

<div class="screen" role="group" ontouchstart={down} ontouchend={up} ontouchcancel={() => (tracking = false)}>
  <MonthHeader month={ledger.month} status={syncStatus.value} {online} onPrev={ledger.prev} onNext={ledger.next} />
  <MonthCard totals={ledger.totals} />
  <div class="listwrap">
    <TxList groups={ledger.groups} byId={categories.byId} ready={ledger.ready} lastAddedId={ledger.lastAddedId} {onOpen} />
  </div>
  <div class="fabzone"></div>
  <button type="button" class="fab" aria-label="Add entry" onclick={onAdd}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="3" fill="none" /></svg>
  </button>
</div>

<style>
  .screen { position: relative; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; padding: 0 max(16px, env(safe-area-inset-right, 0px)) 0 max(16px, env(safe-area-inset-left, 0px)); max-width: 520px; margin: 0 auto; }
  .listwrap { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; margin: 0 -16px; padding: 0 16px calc(130px + env(safe-area-inset-bottom, 0px)); overscroll-behavior: contain; scrollbar-width: none; }
  .listwrap::-webkit-scrollbar { display: none; }
  .fabzone { position: absolute; left: 0; right: 0; bottom: 0; height: 150px; pointer-events: none; background: linear-gradient(to top, var(--bg) 38%, transparent); }
  .fab { position: absolute; left: 50%; bottom: calc(28px + env(safe-area-inset-bottom, 0px)); width: 70px; height: 70px; margin-left: -35px; border-radius: 50%; background: var(--bg2); border: 2px solid var(--amber); color: var(--amber); display: grid; place-items: center; cursor: pointer; box-shadow: 0 0 0 5px var(--bg), 0 0 0 6px var(--line2), 0 10px 24px rgba(0, 0, 0, 0.45); transition: transform 0.16s var(--ease-spring); }
  .fab:active { transform: scale(0.92); }
  .fab:focus-visible { outline: 2px solid var(--ink); outline-offset: 4px; }
  .fab svg { width: 30px; height: 30px; }
</style>
