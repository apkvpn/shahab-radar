/**
 * PRIVATE SIGNAL ENGINE (server only).
 *
 * Fixed configuration, identical for every timeframe. These values are never
 * exposed through any API response, UI string or log and are never tuned.
 */
export interface Candle {
  /** open time (ms) */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  /** true once the candle is closed/final */
  x: boolean;
}

export interface EngineSignal {
  index: number;
  /** open time of the confirming (closed) candle */
  t: number;
  price: number;
  support: number;
  mid: number;
  resistance: number;
}

export interface EngineResult {
  mid: number[];
  sup: number[];
  res: number[];
  signals: EngineSignal[];
}

// ---- fixed internal configuration -------------------------------------------------
const SOURCE = "close" as const; // Source = Close
const BANDWIDTH = 2;
const ENVELOPE_MULT = 4;
const ALMA_WINDOW = 20;
const ALMA_OFFSET = 0.85;
const ALMA_SIGMA = 2;
const ATR_LENGTH = 100;
// -----------------------------------------------------------------------------------

/** Causal Gaussian kernel weights, index = bars back (0 = current bar). */
const KERNEL: number[] = (() => {
  const w: number[] = [];
  let sum = 0;
  for (let k = 0; k < ALMA_WINDOW; k++) {
    const v = Math.exp(-(k * k) / (2 * BANDWIDTH * BANDWIDTH));
    w.push(v);
    sum += v;
  }
  return w.map((v) => v / sum);
})();

/** ALMA weights, index 0 = oldest bar of the window. */
const ALMA: number[] = (() => {
  const m = Math.floor(ALMA_OFFSET * (ALMA_WINDOW - 1));
  const s = ALMA_WINDOW / ALMA_SIGMA;
  const w: number[] = [];
  let sum = 0;
  for (let i = 0; i < ALMA_WINDOW; i++) {
    const v = Math.exp(-((i - m) * (i - m)) / (2 * s * s));
    w.push(v);
    sum += v;
  }
  return w.map((v) => v / sum);
})();

function src(c: Candle): number {
  return SOURCE === "close" ? c.c : c.c;
}

export function isValidCandle(c: Candle | undefined): c is Candle {
  if (!c) return false;
  const { o, h, l, c: cl } = c;
  if (![o, h, l, cl].every((n) => Number.isFinite(n) && n > 0)) return false;
  const eps = h * 1e-12;
  return h + eps >= Math.max(o, cl) && l - eps <= Math.min(o, cl) && h + eps >= l;
}

export function computeBands(candles: Candle[]): { mid: number[]; sup: number[]; res: number[] } {
  const n = candles.length;
  const W = ALMA_WINDOW;
  const nw = new Array<number>(n).fill(NaN);
  const mid = new Array<number>(n).fill(NaN);
  const atr = new Array<number>(n).fill(NaN);
  const sup = new Array<number>(n).fill(NaN);
  const res = new Array<number>(n).fill(NaN);

  // kernel regression estimate
  for (let i = W - 1; i < n; i++) {
    let acc = 0;
    for (let k = 0; k < W; k++) acc += src(candles[i - k]) * KERNEL[k];
    nw[i] = acc;
  }
  // smoothed centre line
  for (let i = 2 * W - 2; i < n; i++) {
    let acc = 0;
    const base = i - (W - 1);
    for (let j = 0; j < W; j++) acc += nw[base + j] * ALMA[j];
    mid[i] = acc;
  }
  // volatility (Wilder RMA of true range, SMA-seeded)
  let rma = NaN;
  let seed = 0;
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const pc = i > 0 ? candles[i - 1].c : NaN;
    const tr = Number.isFinite(pc)
      ? Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc))
      : c.h - c.l;
    if (i < ATR_LENGTH) {
      seed += tr;
      if (i === ATR_LENGTH - 1) {
        rma = seed / ATR_LENGTH;
        atr[i] = rma;
      }
    } else {
      rma = (rma * (ATR_LENGTH - 1) + tr) / ATR_LENGTH;
      atr[i] = rma;
    }
  }
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(mid[i]) && Number.isFinite(atr[i])) {
      sup[i] = mid[i] - ENVELOPE_MULT * atr[i];
      res[i] = mid[i] + ENVELOPE_MULT * atr[i];
    }
  }
  return { mid, sup, res };
}

/**
 * Detect Touch + Breakout-Up entries on CLOSED candles only.
 * A signal fires on candle i when:
 *  - candle i and candle i-1 have valid OHLC data,
 *  - candle i is closed (final),
 *  - candle i-1 touched the green line (low <= line),
 *  - candle i-1 closed on/below the line and candle i closed above it.
 */
export function analyze(candles: Candle[]): EngineResult {
  const { mid, sup, res } = computeBands(candles);
  const signals: EngineSignal[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    if (!c.x) continue;
    if (!isValidCandle(c) || !isValidCandle(p)) continue;
    const s = sup[i];
    const ps = sup[i - 1];
    if (!Number.isFinite(s) || !Number.isFinite(ps)) continue;
    const touched = p.l <= ps;
    const breakoutUp = p.c <= ps && c.c > s;
    if (touched && breakoutUp) {
      signals.push({ index: i, t: c.t, price: c.c, support: s, mid: mid[i], resistance: res[i] });
    }
  }
  return { mid, sup, res, signals };
}
