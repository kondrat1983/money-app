<script lang="ts">
  let { message, onDone }: { message: string | null; onDone: () => void } = $props()
  $effect(() => {
    if (!message) return
    const t = setTimeout(onDone, 3000)
    return () => clearTimeout(t)
  })
</script>

{#if message}
  <div class="toast" role="status" data-testid="toast">{message}</div>
{/if}

<style>
  .toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(120px + env(safe-area-inset-bottom, 0px)); z-index: 60; max-width: calc(100vw - 32px); padding: 10px 16px; background: var(--panel); color: var(--ink); border: 1px solid var(--amber); border-radius: var(--radius-pill); font-family: var(--pixel); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4); }
</style>
