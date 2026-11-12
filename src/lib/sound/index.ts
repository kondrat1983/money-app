// WebAudio synth, no audio files. Off by default; the AudioContext is created lazily on first sound.
let enabled = false;
let ctx: AudioContext | null = null;

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}
export function isSoundEnabled(): boolean {
  return enabled;
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(c: AudioContext, type: OscillatorType, f0: number, f1: number, t0: number, dur: number, peak: number): void {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

/** Short two-note coin blip. */
export function coin(): void {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  tone(c, 'square', 988, 988, t, 0.07, 0.06);
  tone(c, 'square', 1319, 1319, t + 0.07, 0.22, 0.06);
}

/** Low, dark drone for big spends. */
export function drone(): void {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  tone(c, 'sawtooth', 55, 48, t, 1.2, 0.08);
  tone(c, 'sine', 110, 96, t, 1.2, 0.08);
}
