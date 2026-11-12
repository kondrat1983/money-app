<!-- TEMPORARY stub. Real component: src/ui/icons/PixelIcon.svelte -->
<script lang="ts">
  let { icon, size = 28 }: { icon: string; size?: number } = $props()
</script>

<span class="stub" style:width="{size}px" style:height="{size}px" style:font-size="{size * 0.6}px" aria-hidden="true"
  >{icon.charAt(0).toUpperCase()}</span
>

<style>
  .stub { display: inline-grid; place-items: center; font-family: var(--pixel); color: var(--amber); }
</style>
