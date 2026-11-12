<script lang="ts">
  import { untrack } from 'svelte'
  import { formatMinor } from '../../lib/money'

  let { value, sign = false }: { value: number; sign?: boolean } = $props()

  let shown = $state(untrack(() => value))
  let raf = 0

  function reduced(): boolean {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      return false
    }
  }

  $effect(() => {
    const to = value
    cancelAnimationFrame(raf)
    const from = shown
    if (from === to || reduced()) {
      shown = to
      return
    }
    const dur = 650
    const t0 = performance.now()
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur)
      const e = 1 - Math.pow(1 - p, 3)
      shown = p === 1 ? to : Math.round(from + (to - from) * e)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  })
</script>

<span data-value={value}>{formatMinor(shown, { sign })}</span>
