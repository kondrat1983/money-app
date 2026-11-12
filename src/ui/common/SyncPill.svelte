<script lang="ts">
  import type { SyncStatus } from '../../lib/stores'

  let { status, online, onTap }: { status: SyncStatus; online: boolean; onTap?: () => void } = $props()

  const label = $derived.by(() => {
    if (!online || status.state === 'offline') return status.pending > 0 ? `Offline · ${status.pending}` : 'Offline'
    if (status.state === 'error') return status.pending > 0 ? `Error · ${status.pending}` : 'Error'
    if (status.state === 'syncing') return status.pending > 0 ? `Syncing · ${status.pending}` : 'Syncing'
    if (status.pending > 0) return `${status.pending} unsynced`
    if (status.state === 'unconfigured' || !status.lastSyncAt) return 'Never synced'
    return 'Synced'
  })
  const warn = $derived(!online || status.state === 'offline' || status.state === 'error' || status.dead > 0)
</script>

<button type="button" class="pill" class:warn data-testid="sync-pill" aria-label="Sync status: {label}" onclick={() => onTap?.()}>
  <i aria-hidden="true"></i>{label}
</button>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 28px;
    padding: 0 10px;
    border: 1px solid var(--line2);
    border-radius: var(--radius-pill);
    font-family: var(--pixel);
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink2);
    white-space: nowrap;
    background: none;
    cursor: pointer;
  }
  .pill:focus-visible {
    outline: 2px solid var(--amber);
    outline-offset: 2px;
  }
  i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--inc);
  }
  .warn i {
    background: var(--amber);
  }
  .warn {
    color: var(--amber);
  }
</style>
