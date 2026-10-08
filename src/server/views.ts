import {
  TF_MS,
  TIMEFRAMES,
  SCAN_INTERVAL_SEC,
  activeWindowMs,
  type ChartMarker,
  type ChartPayload,
  type LastTuple,
  type MarketRow,
  type Snapshot,
  type SystemStatus,
  type Tick,
  type Timeframe,
} from "@/lib/shared";
import { analyze, type Candle } from "./engine";
import { fetchKlines } from "./binance";
import { comboKey, getState, nowEx, type Combo } from "./core";
import { signalsForCombo } from "./repo";

export function feedLive(): boolean {
  const s = getState().stream;
  return !!s && s.state === "connected" && Date.now() - s.lastMessageAt < 15_000;
}

export function liveTick(symbol: string): { price: number | null; change24h: number | null; ts: number } {
  const st = getState();
  const t = st.tickers.get(symbol);
  if (t && t.price > 0) {
    return { price: t.price, change24h: t.open > 0 ? (t.price / t.open - 1) * 100 : null, ts: t.ts };
  }
  const c = st.combos.get(comboKey(symbol, "15m"));
  const last = c?.candles[c.candles.length - 1];
  if (c && last) return { price: last.c, change24h: null, ts: c.lastUpdateAt };
  return { price: null, change24h: null, ts: 0 };
}

export function signalState(c: Combo | undefined, tf: Timeframe): "LONG" | "WAIT" {
  if (!c?.lastSignal) return "WAIT";
  return nowEx() - c.lastSignal.signalTime <= activeWindowMs(tf) ? "LONG" : "WAIT";
}

export function buildStatus(): SystemStatus {
  const st = getState();
  let synced = 0;
  let failing = 0;
  for (const c of st.combos.values()) {
    if (c.synced) synced++;
    if (c.failures >= 3) failing++;
  }
  const live = feedLive();
  const total = st.combos.size;
  let system: SystemStatus["system"] = "active";
  if (!total || synced < total * 0.5) system = "starting";
  else if (!live || failing > total * 0.2) system = "degraded";
  return {
    system,
    markets: st.universe.length,
    timeframes: TIMEFRAMES.length,
    combos: total,
    scanIntervalSec: SCAN_INTERVAL_SEC,
    lastScanAt: st.scan.lastAt,
    lastScanMs: st.scan.durationMs,
    scanCount: st.scan.count,
    feed: st.stream?.state ?? "disconnected",
    stale: !live,
    feedLastMessageAt: st.stream?.lastMessageAt ?? 0,
    synced,
    failing,
    universeUpdatedAt: st.universeUpdatedAt,
    universeSource: st.universeSource,
    excludedStable: st.excludedStable,
    unavailable: st.unavailable,
    serverTime: Date.now(),
  };
}

export function buildSnapshot(): Snapshot {
  const st = getState();
  const ticks: Record<string, Tick> = {};
  const last: Record<string, Partial<Record<Timeframe, LastTuple>>> = {};
  for (const m of st.universe) {
    const t = liveTick(m.symbol);
    ticks[m.symbol] = [t.price, t.change24h, t.ts];
    const row: Partial<Record<Timeframe, LastTuple>> = {};
    for (const tf of TIMEFRAMES) {
      const ls = st.combos.get(comboKey(m.symbol, tf))?.lastSignal;
      if (ls) row[tf] = [ls.signalTime, ls.price, ls.candleTime];
    }
    last[m.symbol] = row;
  }
  return { ts: Date.now(), version: st.universeVersion, status: buildStatus(), ticks, last };
}

export function marketRow(symbol: string): MarketRow | null {
  const st = getState();
  const m = st.universe.find((u) => u.symbol === symbol);
  if (!m) return null;
  const t = liveTick(symbol);
  const stale = !feedLive();
  return {
    symbol: m.symbol,
    name: m.name,
    rank: m.rank,
    marketCap: m.marketCap,
    price: t.price,
    change24h: t.change24h,
    priceTs: t.ts,
    stale,
    states: TIMEFRAMES.map((tf) => {
      const c = st.combos.get(comboKey(symbol, tf));
      return {
        timeframe: tf,
        signal: signalState(c, tf),
        lastSignal: c?.lastSignal ?? null,
        synced: !!c?.synced,
      };
    }),
  };
}

export function marketRows(): MarketRow[] {
  return getState()
    .universe.map((m) => marketRow(m.symbol))
    .filter((r): r is MarketRow => r !== null);
}

const round = (x: number): number | null => (Number.isFinite(x) ? Number(x.toPrecision(10)) : null);

async function restWindow(pair: string, tf: Timeframe, startTime?: number): Promise<Candle[]> {
  const st = getState();
  const key = `${pair}|${tf}|${startTime ?? "latest"}`;
  const ttl = startTime ? 300_000 : 15_000;
  const hit = st.restCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.candles;
  const candles = await fetchKlines(pair, tf, 500, startTime);
  st.restCache.set(key, { at: Date.now(), candles });
  if (st.restCache.size > 40) {
    const oldest = [...st.restCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) st.restCache.delete(oldest[0]);
  }
  return candles;
}

/**
 * Chart data for one market/timeframe. Served from the scanner cache whenever possible;
 * REST is only used for a historical window older than the cache (focusing an old signal).
 */
export async function getChart(
  symbol: string,
  tf: Timeframe,
  opts: { focus?: number; live?: boolean } = {},
): Promise<ChartPayload | null> {
  const st = getState();
  const meta = st.universe.find((m) => m.symbol === symbol);
  const combo = st.combos.get(comboKey(symbol, tf));
  const iv = TF_MS[tf];
  const pair = meta?.pair ?? `${symbol}USDT`;
  const cached = combo && combo.synced && combo.candles.length > 0 ? combo.candles : null;
  const focus = opts.focus && opts.focus > 0 ? opts.focus : 0;
  const warmIdx = cached ? Math.min(100, cached.length - 1) : 0;

  let candles: Candle[];
  let source: "cache" | "rest" = "cache";
  if (cached && !(focus && focus < cached[warmIdx].t)) {
    candles = cached;
  } else {
    if (opts.live) return null;
    source = "rest";
    candles = await restWindow(pair, tf, focus ? Math.max(0, focus - 350 * iv) : undefined);
  }
  if (!candles.length) return null;

  // everything below up to `out` is synchronous (the cache may mutate during awaits)
  const res = analyze(candles);
  const n = candles.length;
  const from = opts.live ? Math.max(0, n - 3) : 0;
  const outCandles: number[][] = [];
  const support: (number | null)[] = [];
  const mid: (number | null)[] = [];
  const resistance: (number | null)[] = [];
  for (let i = from; i < n; i++) {
    const c = candles[i];
    outCandles.push([Math.floor(c.t / 1000), c.o, c.h, c.l, c.c, c.v]);
    support.push(round(res.sup[i]));
    mid.push(round(res.mid[i]));
    resistance.push(round(res.res[i]));
  }
  const firstT = candles[0].t;
  const lastT = candles[n - 1].t;
  const engineSignals = opts.live ? [] : res.signals;

  let markers: ChartMarker[] = [];
  let dbName: string | null = null;
  if (!opts.live) {
    const rows = await signalsForCombo(symbol, tf, firstT, lastT).catch(() => []);
    const seen = new Set<number>();
    for (const r of rows) {
      dbName = r.name;
      seen.add(r.candleTime.getTime());
      markers.push({
        id: r.id,
        t: Math.floor(r.candleTime.getTime() / 1000),
        price: r.price,
        support: r.support,
        midline: r.midline,
        resistance: r.resistance,
        signalTime: r.signalTime.getTime(),
        confirmed: true,
      });
    }
    for (const s of engineSignals) {
      if (seen.has(s.t)) continue;
      markers.push({
        id: `${symbol}-${tf}-${s.t}`,
        t: Math.floor(s.t / 1000),
        price: s.price,
        support: s.support,
        midline: s.mid,
        resistance: s.resistance,
        signalTime: s.t + iv,
        confirmed: false,
      });
    }
    markers = markers.sort((a, b) => a.t - b.t);
  }

  const tick = meta ? liveTick(symbol) : { price: candles[n - 1].c, change24h: null, ts: 0 };
  const lastMarker = markers[markers.length - 1];
  const lastSignal =
    combo?.lastSignal ??
    (lastMarker
      ? { id: lastMarker.id, price: lastMarker.price, signalTime: lastMarker.signalTime, candleTime: lastMarker.t * 1000 }
      : null);

  return {
    symbol,
    name: meta?.name ?? dbName ?? symbol,
    rank: meta?.rank ?? null,
    timeframe: tf,
    pair,
    source,
    live: source === "cache",
    stale: source === "cache" ? !feedLive() : true,
    serverTime: Date.now(),
    price: tick.price,
    change24h: tick.change24h,
    signal: combo ? signalState(combo, tf) : "WAIT",
    lastSignal,
    candles: outCandles,
    bands: { support, mid, resistance },
    markers,
  };
}
