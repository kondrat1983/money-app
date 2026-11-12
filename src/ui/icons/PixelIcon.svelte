<script lang="ts">
  import { spritePaths } from './sprites';

  let { icon, size = 32 }: { icon: string; size?: number } = $props();
  const paths = $derived(spritePaths(icon));
</script>

<svg
  class="px"
  viewBox="0 0 16 16"
  width={size}
  height={size}
  shape-rendering="crispEdges"
  aria-hidden="true"
>
  {#each paths as p (p.fill)}
    <path fill={p.fill} d={p.d} />
  {/each}
</svg>

<style>
  .px {
    display: block;
    flex: none;
    image-rendering: pixelated;
  }
</style>
