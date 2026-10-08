// Shared (client + server) constants and public types. Contains NO strategy details.

export const TIMEFRAMES = ["15m", "1h", "4h", "1d"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TF_MS: Record<Timeframe, number> = {
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

export const TOP_N = 1000;
export const SCAN_INTERVAL_SEC = 5;

export function isTimeframe(v: string): v is Timeframe {
  return (TIMEFRAMES as readonly string[]).includes(v);
}

/** A market shows LONG while its latest confirmed signal is inside this window. */
export function activeWindowMs(tf: Timeframe): number {
  return Math.min(Math.max(TF_MS[tf] * 2, 300_000), 86_400_000);
}

/** A newly detected signal is only alerted if its candle closed within this window. */
export function freshWindowMs(tf: Timeframe): number {
  return Math.min(Math.max(TF_MS[tf], 180_000), 7_200_000);
}

export interface PublicSignal {
  id: string;
  symbol: string;
  name: string;
  timeframe: Timeframe;
  price: number;
  signalTime: number;
  candleTime: number;
  support: number;
  midline: number;
  resistance: number;
  rank: number;
  source: string;
  confirmation: string;
  createdAt: number;
}

export interface MarketMetaPublic {
  symbol: string;
  name: string;
  rank: number;
  marketCap: number;
}

/** [price, change24h %, timestamp] */
export type Tick = [number | null, number | null, number];
/** [signalTime, price, candleTime] */
export type LastTuple = [number, number, number];

export interface SystemStatus {
  system: "active" | "degraded" | "starting";
  markets: number;
  timeframes: number;
  combos: number;
  scanIntervalSec: number;
  lastScanAt: number;
  lastScanMs: number;
  scanCount: number;
  feed: "connected" | "connecting" | "disconnected";
  stale: boolean;
  feedLastMessageAt: number;
  synced: number;
  failing: number;
  universeUpdatedAt: number;
  universeSource: string;
  excludedStable: number;
  unavailable: number;
  serverTime: number;
}

export interface Snapshot {
  ts: number;
  version: number;
  status: SystemStatus;
  ticks: Record<string, Tick>;
  last: Record<string, Partial<Record<Timeframe, LastTuple>>>;
}

export interface MarketState {
  timeframe: Timeframe;
  signal: "LONG" | "WAIT";
  lastSignal: { id: string; price: number; signalTime: number; candleTime: number } | null;
  synced: boolean;
}

export interface MarketRow extends MarketMetaPublic {
  price: number | null;
  change24h: number | null;
  priceTs: number;
  stale: boolean;
  states: MarketState[];
}

export interface ChartMarker {
  id: string;
  /** candle open time in seconds */
  t: number;
  price: number;
  support: number;
  midline: number;
  resistance: number;
  signalTime: number;
  confirmed: boolean;
}

export interface ChartPayload {
  symbol: string;
  name: string;
  rank: number | null;
  timeframe: Timeframe;
  pair: string;
  source: "cache" | "rest";
  live: boolean;
  stale: boolean;
  serverTime: number;
  price: number | null;
  change24h: number | null;
  signal: "LONG" | "WAIT";
  lastSignal: { id: string; price: number; signalTime: number; candleTime: number } | null;
  /** [timeSec, open, high, low, close, volume] */
  candles: number[][];
  bands: {
    support: (number | null)[];
    mid: (number | null)[];
    resistance: (number | null)[];
  };
  markers: ChartMarker[];
}

export interface PublicConfig {
  push: { configured: boolean; enabled: boolean; subscribers: number };
  telegram: { configured: boolean; enabled: boolean };
  email: { configured: boolean; enabled: boolean };
  vapidPublicKey: string | null;
}
