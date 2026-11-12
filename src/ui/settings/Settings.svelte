<script lang="ts">
  import { untrack } from 'svelte'
  import { createBridge } from '../../lib/bridge'
  import type { Db } from '../../lib/db'
  import type { Stores, SyncStatus } from '../../lib/stores'
  import type { Sync } from '../../lib/sync'
  import { checkBridgeUrl, parseSetupString } from '../../lib/setup'

  let { stores, sync, db, status, onClose }: {
    stores: Stores
    sync: Sync
    db: Db
    status: SyncStatus & { errorCode?: string | null }
    onClose: () => void
  } = $props()

  const device = $derived(stores.settings.device)
  const configured = $derived(!!device.bridgeUrl && !!device.token)

  let setup = $state('')
  let setupMsg = $state<{ ok: boolean; text: string } | null>(null)
  let url = $state(untrack(() => stores.settings.device.bridgeUrl))
  let token = $state('')
  let manualMsg = $state<{ ok: boolean; text: string } | null>(null)
  let test = $state<{ ok: boolean; text: string; hint?: string } | null>(null)
  let testing = $state(false)
  let exported = $state('')
  let copied = $state(false)
  let area = $state<HTMLTextAreaElement>()
  let busy = $state(false)

  async function connect(u: string, t: string) {
    await stores.settings.update({ bridgeUrl: u, token: t })
    test = null
    sync.requestFlush('user')
  }

  async function applySetup() {
    const r = parseSetupString(setup)
    if (!r.ok) {
      setupMsg = { ok: false, text: r.error }
      return
    }
    await connect(r.value.url, r.value.token)
    url = r.value.url
    setup = ''
    setupMsg = { ok: true, text: 'Saved. Use Test connection to check it.' }
  }

  async function saveManual() {
    const u = url.trim()
    const bad = checkBridgeUrl(u)
    if (bad) {
      manualMsg = { ok: false, text: bad }
      return
    }
    const t = token.trim() || device.token
    if (!t) {
      manualMsg = { ok: false, text: 'Enter the token.' }
      return
    }
    await connect(u, t)
    token = ''
    manualMsg = { ok: true, text: 'Saved.' }
  }

  async function testConnection() {
    testing = true
    test = null
    try {
      const res = await createBridge({ url: device.bridgeUrl, token: device.token }).ping()
      test = { ok: true, text: `OK. Sheet reachable (revision ${res.head}).` }
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'UNAUTHORIZED') {
        test = { ok: false, text: 'Unauthorized.', hint: 'The token is wrong or was rotated. Paste a fresh setup string.' }
      } else if (code === 'NETWORK' || code === 'BAD_RESPONSE') {
        test = { ok: false, text: 'Unreachable.', hint: 'Check that you are online, the URL ends with /exec and the deployment access is "Anyone".' }
      } else {
        test = { ok: false, text: `Error: ${code ?? 'unknown'}.`, hint: code === 'SCHEMA_MISMATCH' ? 'Update the Apps Script and this app.' : undefined }
      }
    } finally {
      testing = false
    }
  }

  async function syncNow() {
    sync.requestFlush('user')
  }
  async function fullResync() {
    busy = true
    try {
      await sync.fullResync()
      await stores.ledger.refresh()
    } finally {
      busy = false
    }
  }

  async function doExport() {
    exported = await db.exportJson()
    copied = false
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(exported)
      copied = true
    } catch {
      area?.focus()
      area?.select()
      copied = document.execCommand?.('copy') ?? false
    }
  }

  const THEMES = ['auto', 'dark', 'light'] as const
  const theme = (t: 'auto' | 'dark' | 'light') => stores.settings.update({ theme: t })
  const sound = (on: boolean) => stores.settings.update({ sound: on })

  const statusText = $derived.by(() => {
    const parts: string[] = [status.state]
    if (status.pending > 0) parts.push(`${status.pending} unsynced`)
    if (status.dead > 0) parts.push(`${status.dead} rejected`)
    parts.push(status.lastSyncAt ? `last sync ${new Date(status.lastSyncAt).toLocaleString()}` : 'never synced')
    if (status.errorCode) parts.push(status.errorCode)
    return parts.join(' · ')
  })
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<div class="scrim" role="presentation" onclick={onClose}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label="Settings" data-testid="settings">
  <header>
    <h2>SETTINGS</h2>
    <button type="button" class="close" aria-label="Close settings" onclick={onClose}>Done</button>
  </header>

  <section>
    <h3>Connection</h3>
    <p class="state" data-testid="conn-state">{configured ? 'Configured.' : 'Not configured. Entries stay on this device.'}</p>
    <label>Setup string
      <textarea rows="3" bind:value={setup} autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="youspent1...."></textarea>
    </label>
    <div class="row">
      <button type="button" class="primary" onclick={applySetup} disabled={!setup.trim()}>Apply</button>
    </div>
    {#if setupMsg}<p class:bad={!setupMsg.ok} role="status">{setupMsg.text}</p>{/if}

    <details>
      <summary>Enter URL and token manually</summary>
      <label>Script URL
        <input type="url" bind:value={url} autocomplete="off" autocapitalize="off" spellcheck="false" />
      </label>
      <label>Token
        <input type="password" bind:value={token} autocomplete="off" placeholder={device.token ? 'unchanged' : ''} />
      </label>
      <div class="row"><button type="button" onclick={saveManual}>Save</button></div>
      {#if manualMsg}<p class:bad={!manualMsg.ok} role="status">{manualMsg.text}</p>{/if}
    </details>

    <div class="row">
      <button type="button" onclick={testConnection} disabled={!configured || testing}>{testing ? 'Testing…' : 'Test connection'}</button>
    </div>
    {#if test}
      <p class:bad={!test.ok} role="status" data-testid="test-result">{test.text} {test.hint ?? ''}</p>
    {/if}
  </section>

  <section>
    <h3>Appearance</h3>
    <div class="seg" role="group" aria-label="Theme">
      {#each THEMES as t (t)}
        <button type="button" aria-pressed={device.theme === t} onclick={() => theme(t)}>{t}</button>
      {/each}
    </div>
    <label class="check">
      <input type="checkbox" checked={device.sound} onchange={(e) => sound(e.currentTarget.checked)} />
      Sound effects
    </label>
  </section>

  <section>
    <h3>Sync</h3>
    <p class="state" data-testid="sync-state">{statusText}</p>
    <div class="row">
      <button type="button" onclick={syncNow}>Sync now</button>
      <button type="button" onclick={fullResync} disabled={busy || !configured}>Full resync</button>
    </div>
  </section>

  <section>
    <h3>Data</h3>
    <div class="row"><button type="button" onclick={doExport}>Export JSON</button></div>
    {#if exported}
      <textarea rows="6" readonly bind:this={area} value={exported} aria-label="Exported JSON"></textarea>
      <div class="row"><button type="button" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
    {/if}
  </section>

  <footer>YOU SPENT v{__APP_VERSION__}</footer>
</div>

<style>
  .scrim { position: fixed; inset: 0; background: rgba(var(--band), 0.6); z-index: 40; }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 41; max-height: 92dvh; overflow-y: auto; overscroll-behavior: contain; background: var(--panel); border-top: 3px double var(--line2); padding: 16px max(16px, env(safe-area-inset-right, 0px)) calc(20px + env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px)); display: grid; gap: 18px; max-width: 480px; margin: 0 auto; animation: up var(--dur-slow) var(--ease-out); }
  @keyframes up { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
  header { display: flex; justify-content: space-between; align-items: center; }
  h2 { margin: 0; font-family: var(--display); font-size: 12px; letter-spacing: 0.2em; color: var(--ink3); }
  h3 { margin: 0 0 8px; font-family: var(--display); font-size: 11px; letter-spacing: 0.18em; color: var(--ink2); font-weight: 500; text-transform: uppercase; }
  section { display: grid; gap: 10px; border-top: 1px solid var(--line); padding-top: 14px; }
  p { margin: 0; font-size: 13px; color: var(--ink2); overflow-wrap: anywhere; }
  p.bad { color: var(--exp); }
  .state { color: var(--ink3); }
  label { display: grid; gap: 4px; font-size: 12px; color: var(--ink3); }
  label.check { display: flex; align-items: center; gap: 10px; font-size: 14px; color: var(--ink); min-height: 44px; }
  input[type='checkbox'] { width: 22px; height: 22px; accent-color: var(--amber); }
  input, textarea { font: inherit; font-size: 16px; color: var(--ink); background: var(--bg2); border: 1px solid var(--line2); border-radius: var(--radius-sm); padding: 10px; min-height: 44px; width: 100%; box-sizing: border-box; }
  input[type='checkbox'] { width: 22px; min-height: 0; padding: 0; }
  textarea { resize: vertical; font-family: ui-monospace, monospace; font-size: 13px; }
  details { display: grid; gap: 10px; }
  summary { min-height: 44px; display: flex; align-items: center; font-size: 13px; color: var(--ink2); cursor: pointer; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .seg { display: flex; gap: 8px; }
  button { font: inherit; min-height: 44px; padding: 0 16px; border-radius: var(--radius-pill); border: 1px solid var(--line2); background: none; color: var(--ink); cursor: pointer; text-transform: none; }
  .seg button { flex: 1; text-transform: capitalize; }
  button[aria-pressed='true'], .primary { background: var(--amber); color: var(--on-amber); border-color: var(--amber); }
  button:disabled { opacity: 0.4; }
  button:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
  footer { text-align: center; font-family: var(--pixel); font-size: 9px; letter-spacing: 0.1em; color: var(--ink3); }
</style>
