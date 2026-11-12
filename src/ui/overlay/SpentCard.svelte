<script lang="ts">
  import type { TxType } from '../../lib/model';
  import { formatMinor } from '../../lib/money';

  type SpentEvent = { type: TxType; amountMinor: number; big: boolean; key: number };
  let { event, onDone }: { event: SpentEvent | null; onDone: () => void } = $props();

  let dismissed = $state(false);
  let canvas = $state<HTMLCanvasElement>();

  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const word = $derived(event?.type === 'income' ? 'YOU EARNED' : event?.type === 'transfer' ? 'STASHED' : 'YOU SPENT');
  const amount = $derived(event ? `₴${formatMinor(Math.abs(event.amountMinor))}` : '');
  const asz = $derived(Math.max(26, Math.min(46, Math.floor(330 / Math.max(amount.length, 1) / 0.78))));

  function finish() {
    if (dismissed) return;
    dismissed = true;
    onDone();
  }

  // A new event key restarts everything (timer, animation via {#key}, particles).
  $effect(() => {
    if (!event) return;
    void event.key;
    dismissed = false;
    const ms = reduced() ? 600 : event.big ? 1400 : 1100;
    const t = setTimeout(finish, ms);
    return () => clearTimeout(t);
  });

  // Falling pixel coins for the big variant.
  $effect(() => {
    if (!event?.big || reduced() || !canvas) return;
    void event.key;
    const c = canvas;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const w = (c.width = 390);
    const h = (c.height = 300);
    const colors = ['#d0a03a', '#f3deaa', '#7a5614', '#c4552a'];
    const ps = Array.from({ length: 34 }, () => ({
      x: Math.floor(Math.random() * w),
      y: -Math.random() * 120,
      v: 140 + Math.random() * 160,
      s: Math.random() < 0.4 ? 6 : 4,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    let raf = 0;
    let last = performance.now();
    const t0 = last;
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      ctx.clearRect(0, 0, w, h);
      const fade = Math.max(0, 1 - Math.max(0, (now - t0 - 700) / 600));
      ctx.globalAlpha = fade;
      for (const p of ps) {
        p.y += p.v * dt;
        ctx.fillStyle = p.c;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
      }
      if (now - t0 < 1400) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });
</script>

{#if event}
  {#key event.key}
    <!-- Dismiss on pointerdown, then immediately stop catching pointers so the next tap reaches the UI. -->
    <div
      class="sig {event.type}"
      class:heavy={event.big}
      class:gone={dismissed}
      role="status"
      aria-live="polite"
      onpointerdown={finish}
    >
      {#if event.big}<canvas bind:this={canvas} class="coins" aria-hidden="true"></canvas>{/if}
      <div class="band">
        <div class="t">{word}</div>
        <div class="a" style:--asz="{asz}px">{amount}</div>
      </div>
    </div>
  {/key}
{/if}

<style>
  .sig {
    position: absolute;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    pointer-events: auto;
    touch-action: manipulation;
  }
  .sig.gone,
  .sig.gone .band {
    display: none;
    pointer-events: none;
  }
  .coins {
    position: absolute;
    left: 0;
    top: calc(50% - 150px);
    width: 100%;
    height: 300px;
    pointer-events: none;
  }
  .band {
    position: relative;
    width: 100%;
    padding: 30px 0 34px;
    margin-top: -90px;
    text-align: center;
    background: linear-gradient(to bottom, rgba(var(--band), 0), rgba(var(--band), 0.9) 24%, rgba(var(--band), 0.9) 76%, rgba(var(--band), 0));
    animation: sigband 1.1s linear both;
    pointer-events: none;
  }
  .t,
  .a {
    font-family: var(--display);
    font-weight: 700;
    color: var(--exp);
    text-transform: uppercase;
    white-space: nowrap;
    animation: sigtext 1.1s cubic-bezier(0.2, 0.6, 0.3, 1) both;
  }
  .t {
    font-size: 30px;
    letter-spacing: 0.1em;
  }
  .a {
    font-size: var(--asz, 46px);
    margin-top: 6px;
    animation-name: sigamt;
  }
  .income .t,
  .income .a {
    color: var(--inc);
  }
  .income .a {
    color: var(--amber);
  }
  .transfer .t,
  .transfer .a {
    color: var(--amber);
  }
  .heavy .band {
    padding: 48px 0 52px;
    animation-duration: 1.4s;
    background: linear-gradient(to bottom, rgba(var(--band), 0), rgba(60, 6, 4, 0.94) 22%, rgba(30, 3, 2, 0.96) 78%, rgba(var(--band), 0));
  }
  .heavy.income .band,
  .heavy.transfer .band {
    background: linear-gradient(to bottom, rgba(var(--band), 0), rgba(46, 30, 6, 0.94) 22%, rgba(24, 14, 2, 0.96) 78%, rgba(var(--band), 0));
  }
  .heavy .t {
    font-size: 38px;
    animation-duration: 1.4s;
  }
  .heavy .a {
    animation-duration: 1.4s;
  }
  @keyframes sigband {
    0% { opacity: 0; }
    14% { opacity: 1; }
    68% { opacity: 1; }
    100% { opacity: 0; }
  }
  @keyframes sigtext {
    0% { opacity: 0; letter-spacing: 0.06em; }
    16% { opacity: 1; }
    62% { opacity: 1; }
    100% { opacity: 0; letter-spacing: 0.36em; }
  }
  @keyframes sigamt {
    0% { opacity: 0; letter-spacing: 0.02em; }
    16% { opacity: 1; }
    62% { opacity: 1; }
    100% { opacity: 0; letter-spacing: 0.14em; }
  }
  @media (prefers-reduced-motion: reduce) {
    .band,
    .t,
    .a {
      animation: none;
      opacity: 1;
    }
    .band {
      background: rgba(var(--band), 0.9);
    }
    .coins {
      display: none;
    }
  }
</style>
