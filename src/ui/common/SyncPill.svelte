<script lang="ts">
  import type { SyncStatus } from '../../lib/stores'

  let { status, online }: { status: SyncStatus; online: boolean } = $props()

  const label = $derived.by(() => {
    if (!online || status.state === 'offline') return status.pending > 0 ? `Offline · ${status.pending}` : 'Offline'
    if (status.state === 'error') return status.pending > 0 ? `Error · ${status.pending}` : 'Error'
    if (status.state === 'syncing') return status.pending > 0 ? `Syncing · ${status.pending}` : 'Syncing'
    if (status.pending > 0) return `${status.pending} unsynced`
    if (status.state === 'unconfigured') return 'Local only'
    return 'Synced'
  })
  const warn = $derived(!online || status.state === 'offline' || status.state === 'error' || status.dead > 0)
</script>

<span class="pill" class:warn data-testid="sync-pill" role="status" aria-label="Sync status: {label}">
  <i aria-hidden="true"></i>{label}
</span>

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
