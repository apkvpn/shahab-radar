// Alert sounds are synthesized with the Web Audio API (original, royalty-free, no audio files).

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  return ctx;
}

export const SOUND_LABELS = [
  "صدای هشدار ۱",
  "صدای هشدار ۲",
  "صدای هشدار ۳",
  "صدای هشدار ۴",
  "صدای هشدار ۵",
] as const;

/** Must be called from a user gesture (click/tap/key) to satisfy autoplay policies. */
export async function unlockAudio(): Promise<boolean> {
  const c = getCtx();
  if (!c) return false;
  if (c.state !== "running") {
    try {
      await c.resume();
    } catch {
      /* needs another gesture */
    }
  }
  if (c.state === "running") {
    try {
      const b = c.createBuffer(1, 1, 22050);
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.start(0);
    } catch {
      /* ignore */
    }
  }
  return c.state === "running";
}

export function audioRunning(): boolean {
  return !!ctx && ctx.state === "running";
}

interface ToneOpts {
  f: number;
  t: number;
  d: number;
  type?: OscillatorType;
  g?: number;
  fEnd?: number;
}

function tone(c: AudioContext, dest: AudioNode, o: ToneOpts) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.f, o.t);
  if (o.fEnd) osc.frequency.exponentialRampToValueAtTime(o.fEnd, o.t + o.d);
  const peak = o.g ?? 0.5;
  g.gain.setValueAtTime(0.0001, o.t);
  g.gain.exponentialRampToValueAtTime(peak, o.t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.d);
  osc.connect(g);
  g.connect(dest);
  osc.start(o.t);
  osc.stop(o.t + o.d + 0.05);
}

/** Plays alert sound 1..5. Returns false when the browser still blocks audio. */
export function playAlert(id: number, volume: number): boolean {
  const c = getCtx();
  if (!c) return false;
  if (c.state !== "running") {
    c.resume().catch(() => {});
    // resume() is async: the state is re-read on the next gesture/alert
    if ((c.state as string) !== "running") return false;
  }
  const master = c.createGain();
  master.gain.value = Math.min(1, Math.max(0, volume));
  master.connect(c.destination);
  const t = c.currentTime + 0.02;

  switch (id) {
    case 2: // rising arpeggio
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        tone(c, master, { f, t: t + i * 0.09, d: 0.26, type: "triangle", g: 0.5 }),
      );
      break;
    case 3: // bell
      tone(c, master, { f: 1046.5, t, d: 1.0, g: 0.5 });
      tone(c, master, { f: 2093, t, d: 0.7, g: 0.2 });
      tone(c, master, { f: 3136, t, d: 0.4, g: 0.09 });
      break;
    case 4: // radar ping with echoes
      tone(c, master, { f: 1800, fEnd: 900, t, d: 0.35, g: 0.5 });
      tone(c, master, { f: 1800, fEnd: 900, t: t + 0.3, d: 0.35, g: 0.22 });
      tone(c, master, { f: 1800, fEnd: 900, t: t + 0.6, d: 0.35, g: 0.1 });
      break;
    case 5: {
      // soft pulses
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2200;
      lp.connect(master);
      [660, 880, 660, 880].forEach((f, i) =>
        tone(c, lp, { f, t: t + i * 0.18, d: i === 3 ? 0.3 : 0.15, type: "square", g: 0.22 }),
      );
      break;
    }
    default: // two-tone chime
      tone(c, master, { f: 880, t, d: 0.34, g: 0.55 });
      tone(c, master, { f: 1318.5, t: t + 0.15, d: 0.55, g: 0.55 });
  }
  return true;
}
