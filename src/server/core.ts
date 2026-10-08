import type { PublicSignal, Timeframe } from "@/lib/shared";
import type { Candle } from "./engine";
import type { BinanceStreamGroup } from "./binance";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function backoffMs(attempt: number, base = 500, max = 30_000): number {
  const exp = Math.min(max, base * 2 ** attempt);
  return Math.round(exp * (0.7 + Math.random() * 0.6));
}

export function log(...args: unknown[]) {
  console.log("[radar]", ...args);
}

/** Error that never contains the request path/query (may hold secrets). */
export class HttpError extends Error {
  constructor(
    public status: number,
    url: string,
    public retryable: boolean,
  ) {
    let host = "";
    try {
      host = new URL(url).host;
    } catch {
      host = "";
    }
    super(`HTTP ${status} ${host}`.trim());
  }
}

export async function fetchJson<T>(
  url: string,
  opts: {
    headers?: Record<string, string>;
    method?: string;
    body?: string;
    timeoutMs?: number;
    retries?: number;
    baseDelayMs?: number;
  } = {},
): Promise<T> {
  const { headers, method = "GET", body, timeoutMs = 12_000, retries = 3, baseDelayMs = 800 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let retryAfter = 0;
    try {
      const res = await fetch(url, {
        method,
        headers,
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return (await res.json()) as T;
      if (res.status !== 429 && res.status < 500) throw new HttpError(res.status, url, false);
      retryAfter = Number(res.headers.get("retry-after")) || 0;
      lastErr = new HttpError(res.status, url, true);
    } catch (e) {
      if (e instanceof HttpError && !e.retryable) throw e;
      lastErr = e instanceof Error ? new Error(e.name === "TimeoutError" ? "timeout" : "network_error") : e;
    }
    if (attempt < retries) {
      await sleep(retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : backoffMs(attempt, baseDelayMs));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------------
// Process-wide state (anchored on globalThis so every Next.js bundle shares it)
// ---------------------------------------------------------------------------------

export interface UniverseItem {
  symbol: string;
  name: string;
  id: string;
  pair: string;
  rank: number;
  marketCap: number;
}

export interface LastSignal {
  id: string;
  price: number;
  signalTime: number;
  candleTime: number;
}

export interface Combo {
  key: string;
  symbol: string;
  tf: Timeframe;
  pair: string;
  candles: Candle[];
  synced: boolean;
  syncing: boolean;
  needsRefresh: boolean;
  failures: number;
  nextRetryAt: number;
  lastRefreshAt: number;
  lastError: string | null;
  evaluatedThrough: number;
  lastSignal: LastSignal | null;
  lastUpdateAt: number;
}

export interface Ticker {
  price: number;
  open: number;
  ts: number;
}

export type RadarEvent =
  | { type: "signal"; data: PublicSignal }
  | { type: "snapshot"; data: unknown };

export interface PendingSignal {
  row: Record<string, unknown>;
  mode: "alert" | "record";
  tries: number;
}

export interface RadarState {
  started: boolean;
  startedAt: number;
  universe: UniverseItem[];
  universeVersion: number;
  universeUpdatedAt: number;
  universeSource: string;
  excludedStable: number;
  unavailable: number;
  universeError: string | null;
  combos: Map<string, Combo>;
  pairToSymbol: Map<string, string>;
  tickers: Map<string, Ticker>;
  exchange: { at: number; pairs: Map<string, string> };
  clockOffset: number;
  scan: {
    running: boolean;
    lastAt: number;
    durationMs: number;
    count: number;
    evaluated: number;
    lastError: string | null;
    lastManualAt: number;
  };
  stream: BinanceStreamGroup | null;
  listeners: Set<(e: RadarEvent) => void>;
  pending: PendingSignal[];
  syncInFlight: number;
  restCache: Map<string, { at: number; candles: Candle[] }>;
  testLimiter: Map<string, number>;
}

function createState(): RadarState {
  return {
    started: false,
    startedAt: Date.now(),
    universe: [],
    universeVersion: 0,
    universeUpdatedAt: 0,
    universeSource: "none",
    excludedStable: 0,
    unavailable: 0,
    universeError: null,
    combos: new Map(),
    pairToSymbol: new Map(),
    tickers: new Map(),
    exchange: { at: 0, pairs: new Map() },
    clockOffset: 0,
    scan: { running: false, lastAt: 0, durationMs: 0, count: 0, evaluated: 0, lastError: null, lastManualAt: 0 },
    stream: null,
    listeners: new Set(),
    pending: [],
    syncInFlight: 0,
    restCache: new Map(),
    testLimiter: new Map(),
  };
}

const g = globalThis as typeof globalThis & { __shahabRadar?: RadarState };

export function getState(): RadarState {
  if (!g.__shahabRadar) g.__shahabRadar = createState();
  return g.__shahabRadar;
}

export function nowEx(): number {
  return Date.now() + getState().clockOffset;
}

export function publish(evt: RadarEvent) {
  for (const l of getState().listeners) {
    try {
      l(evt);
    } catch {
      /* a broken listener must never affect the scanner */
    }
  }
}

export function subscribe(fn: (e: RadarEvent) => void): () => void {
  const st = getState();
  st.listeners.add(fn);
  return () => st.listeners.delete(fn);
}

export function comboKey(symbol: string, tf: string): string {
  return `${symbol}|${tf}`;
}
