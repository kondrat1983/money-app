<!-- TEMPORARY stub. Real component: src/ui/overlay/SpentCard.svelte -->
<script lang="ts">
  type Ev = { type: string; amountMinor: number; big: boolean; key: number } | null
  let { event, onDone }: { event: Ev; onDone: () => void } = $props()
  $effect(() => {
    if (!event) return
    const t = setTimeout(onDone, 300)
    return () => clearTimeout(t)
  })
</script>
