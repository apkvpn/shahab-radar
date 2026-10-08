import { SCAN_INTERVAL_SEC, TF_MS, TIMEFRAMES, TOP_N, freshWindowMs, isTimeframe, type Timeframe } from "@/lib/shared";
import { BinanceStreamGroup, fetchKlines, type KlineMsg, type TickerMsg } from "./binance";
import { analyze, isValidCandle, type Candle } from "./engine";
import {
  backoffMs,
  comboKey,
  getState,
  log,
  nowEx,
  publish,
  sleep,
  type Combo,
  type UniverseItem,
} from "./core";
import { selectUniverse } from "./universe";
import { dispatchSignal } from "./notify";
import {
  ensureSchema,
  getSetting,
  insertSignal,
  lastSignalPerCombo,
  setSetting,
  toPublic,
  type NewSignal,
} from "./repo";
import { buildSnapshot } from "./views";

const SCAN_MS = SCAN_INTERVAL_SEC * 1000;
const SYNC_LIMIT = 500; // candles fetched once per market/timeframe (initial sync)
const CACHE_MAX = 700; // candles retained in memory per market/timeframe
const SYNC_CONCURRENCY = 5;
const GRACE_MS = 2500;
const DATA_SOURCE = "binance-spot";
const UNIVERSE_REFRESH_MS = 5 * 60_000;

const errMsg = (e: unknown) => (e instanceof Error ? e.message.slice(0, 80) : "error");

// ---------------------------------------------------------------------------------
// Universe (dynamic Top 50)
// ---------------------------------------------------------------------------------
function newCombo(symbol: string, pair: string, tf: Timeframe): Combo {
  return {
    key: comboKey(symbol, tf),
    symbol,
    tf,
    pair,
    candles: [],
    synced: false,
    syncing: false,
    needsRefresh: false,
    failures: 0,
    nextRetryAt: 0,
    lastRefreshAt: 0,
    lastError: null,
    evaluatedThrough: 0,
    lastSignal: null,
    lastUpdateAt: 0,
  };
}

function streamNames(list: UniverseItem[]): string[] {
  const out: string[] = [];
  for (const m of list) {
    const p = m.pair.toLowerCase();
    out.push(`${p}@miniTicker`);
    for (const tf of TIMEFRAMES) out.push(`${p}@kline_${tf}`);
  }
  return out;
}

async function hydrateLastSignals() {
  try {
    const st = getState();
    for (const r of await lastSignalPerCombo()) {
      const c = st.combos.get(comboKey(r.symbol, r.timeframe));
      if (c && (!c.lastSignal || r.candleTime > c.lastSignal.candleTime)) {
        c.lastSignal = { id: r.id, price: r.price, signalTime: r.signalTime, candleTime: r.candleTime };
      }
    }
  } catch (e) {
    log("hydrate last signals failed:", errMsg(e));
  }
}

/** Safely swaps the monitored universe: other assets keep running untouched. */
function applyUniverse(list: UniverseItem[], source: string, excluded: number, unavailable: number) {
  const st = getState();
  const keep = new Set(list.map((i) => i.symbol));
  let removed = 0;
  let added = 0;
  for (const old of st.universe) {
    if (keep.has(old.symbol)) continue;
    for (const tf of TIMEFRAMES) st.combos.delete(comboKey(old.symbol, tf));
    st.pairToSymbol.delete(old.pair);
    st.tickers.delete(old.symbol);
    removed++;
  }
  for (const item of list) {
    st.pairToSymbol.set(item.pair, item.symbol);
    for (const tf of TIMEFRAMES) {
      const k = comboKey(item.symbol, tf);
      if (!st.combos.has(k)) {
        st.combos.set(k, newCombo(item.symbol, item.pair, tf));
        added++;
      }
    }
  }
  st.universe = [...list].sort((a, b) => a.rank - b.rank);
  st.universeVersion++;
  st.universeSource = source;
  st.excludedStable = excluded;
  st.unavailable = unavailable;
  st.stream?.setStreams(streamNames(list));
  if (added || removed) log(`universe updated (+${added / 6 | 0} / -${removed}) source=${source}`);
  if (added) void hydrateLastSignals();
  pumpSync();
}

async function universeLoop() {
  const st = getState();
  let failures = 0;
  for (;;) {
    let delay = UNIVERSE_REFRESH_MS;
    try {
      const r = await selectUniverse();
      applyUniverse(r.list, r.source, r.excludedStable, r.unavailable);
      st.universeUpdatedAt = Date.now();
      st.universeError = null;
      failures = 0;
      await setSetting("universe", {
        list: r.list,
        at: st.universeUpdatedAt,
        source: r.source,
        excludedStable: r.excludedStable,
        unavailable: r.unavailable,
      }).catch(() => {});
    } catch (e) {
      failures++;
      st.universeError = errMsg(e);
      delay = Math.min(UNIVERSE_REFRESH_MS, backoffMs(failures, 5000, UNIVERSE_REFRESH_MS));
      log("universe refresh failed (keeping current universe):", errMsg(e));
    }
    await sleep(delay);
  }
}

// ---------------------------------------------------------------------------------
// Candle cache (incremental updates)
// ---------------------------------------------------------------------------------
function applyLive(c: Combo, k: Candle) {
  const arr = c.candles;
  const last = arr[arr.length - 1];
  const iv = TF_MS[c.tf];
  c.lastUpdateAt = Date.now();
  if (!last || k.t > last.t) {
    if (last && (k.t > last.t + iv || !last.x)) c.needsRefresh = true; // gap or missed close event
    arr.push(k);
    if (arr.length > CACHE_MAX) arr.splice(0, arr.length - CACHE_MAX);
    return;
  }
  if (k.t === last.t) {
    if (last.x && !k.x) return;
    arr[arr.length - 1] = k;
    return;
  }
  let i = arr.length - 1;
  while (i >= 0 && arr[i].t > k.t) i--;
  if (i >= 0 && arr[i].t === k.t && !(arr[i].x && !k.x)) arr[i] = k;
}

function mergeBulk(c: Combo, incoming: Candle[]) {
  const map = new Map<number, Candle>();
  for (const x of c.candles) map.set(x.t, x);
  for (const k of incoming) {
    const e = map.get(k.t);
    if (!e || !(e.x && !k.x)) map.set(k.t, k);
  }
  const merged = [...map.values()].sort((a, b) => a.t - b.t);
  if (merged.length > CACHE_MAX) merged.splice(0, merged.length - CACHE_MAX);
  c.candles = merged;
  c.lastUpdateAt = Date.now();
}

// ---------------------------------------------------------------------------------
// REST sync / recovery queue
// ---------------------------------------------------------------------------------
function refreshLimit(c: Combo): number {
  const iv = TF_MS[c.tf];
  const last = c.candles[c.candles.length - 1];
  if (!last) return SYNC_LIMIT;
  const expected = Math.floor(nowEx() / iv) * iv;
  const missing = Math.ceil((expected - last.t) / iv) + 2;
  return Math.min(SYNC_LIMIT, Math.max(3, missing));
}

function pumpSync() {
  const st = getState();
  if (st.syncInFlight >= SYNC_CONCURRENCY) return;
  const now = Date.now();
  for (const c of st.combos.values()) {
    if (st.syncInFlight >= SYNC_CONCURRENCY) break;
    if (c.syncing || now < c.nextRetryAt) continue;
    if (!c.synced) void runSync(c, SYNC_LIMIT, false);
    else if (c.needsRefresh) void runSync(c, refreshLimit(c), true);
  }
}

async function runSync(c: Combo, limit: number, isRefresh: boolean) {
  const st = getState();
  c.syncing = true;
  st.syncInFlight++;
  try {
    const before = c.candles[c.candles.length - 1]?.t ?? 0;
    if (isRefresh && limit >= SYNC_LIMIT) c.candles = []; // huge gap: rebuild from scratch
    const fetched = await fetchKlines(c.pair, c.tf, limit);
    if (!getState().combos.has(c.key)) return; // asset left the universe meanwhile
    mergeBulk(c, fetched);
    c.synced = true;
    c.failures = 0;
    c.lastError = null;
    c.needsRefresh = false;
    c.lastRefreshAt = Date.now();
    const after = c.candles[c.candles.length - 1]?.t ?? 0;
    c.nextRetryAt = isRefresh ? Date.now() + (after === before ? 30_000 : 4000) : 0;
    evaluateCombo(c, nowEx());
  } catch (e) {
    c.failures++;
    c.lastError = errMsg(e);
    c.nextRetryAt = Date.now() + backoffMs(c.failures, 1500, 120_000);
  } finally {
    c.syncing = false;
    st.syncInFlight--;
    setTimeout(pumpSync, 0);
  }
}

function needsRecovery(c: Combo, now: number, grace: number): boolean {
  const last = c.candles[c.candles.length - 1];
  if (!last) return true;
  const iv = TF_MS[c.tf];
  if (!last.x && now >= last.t + iv + grace) return true; // should have closed already
  if (last.x && now >= last.t + 2 * iv + grace) return true; // a whole candle is missing
  return false;
}

// ---------------------------------------------------------------------------------
// Signal evaluation (closed candles only) + persistence + realtime alert
// ---------------------------------------------------------------------------------
function evaluateCombo(c: Combo, now: number): boolean {
  const arr = c.candles;
  let li = arr.length - 1;
  while (li >= 0 && !arr[li].x) li--;
  if (li < 0) return false;
  const lastClosedT = arr[li].t;
  if (lastClosedT <= c.evaluatedThrough) return false; // nothing new -> no work

  const st = getState();
  const meta = st.universe.find((u) => u.symbol === c.symbol);
  if (!meta) return false;

  const initial = c.evaluatedThrough === 0;
  const prevThrough = c.evaluatedThrough;
  const { signals } = analyze(arr);
  c.evaluatedThrough = lastClosedT;

  const iv = TF_MS[c.tf];
  const fresh = freshWindowMs(c.tf);
  for (const s of signals) {
    if (s.t <= prevThrough) continue;
    const id = `${c.symbol}-${c.tf}-${s.t}`;
    const signalTime = s.t + iv;
    if (!c.lastSignal || s.t > c.lastSignal.candleTime) {
      c.lastSignal = { id, price: s.price, signalTime, candleTime: s.t };
    }
    const isFresh = now - signalTime <= fresh;
    if (initial && !isFresh) continue; // pre-existing chart history only (not persisted)
    const row: NewSignal = {
      id,
      symbol: c.symbol,
      name: meta.name,
      pair: meta.pair,
      timeframe: c.tf,
      price: s.price,
      signalTime: new Date(signalTime),
      candleTime: new Date(s.t),
      support: s.support,
      midline: s.mid,
      resistance: s.resistance,
      marketCapRank: meta.rank,
      dataSource: DATA_SOURCE,
      confirmation: isFresh ? "confirmed" : "recovered",
    };
    handleSignal(row, isFresh ? "alert" : "record");
  }
  return true;
}

async function persistAndAlert(row: NewSignal, mode: "alert" | "record"): Promise<void> {
  const inserted = await insertSignal(row); // unique Signal ID => duplicates are impossible
  if (!inserted) return;
  if (mode === "alert") {
    publish({ type: "signal", data: toPublic(inserted) }); // realtime event first
    dispatchSignal(inserted).catch((e) => log("dispatch error:", errMsg(e)));
  }
}

function handleSignal(row: NewSignal, mode: "alert" | "record") {
  persistAndAlert(row, mode).catch((e) => {
    const st = getState();
    log("signal persistence failed, queued for retry:", errMsg(e));
    if (st.pending.length < 500) st.pending.push({ row: row as unknown as Record<string, unknown>, mode, tries: 1 });
  });
}

async function retryPending() {
  const st = getState();
  if (!st.pending.length) return;
  const batch = st.pending.splice(0, 50);
  for (let i = 0; i < batch.length; i++) {
    const p = batch[i];
    try {
      await persistAndAlert(p.row as unknown as NewSignal, p.mode);
    } catch {
      p.tries++;
      st.pending.unshift(...batch.slice(i).filter((x) => x.tries < 200));
      return; // database still unavailable – retry next cycle
    }
  }
}

// ---------------------------------------------------------------------------------
// Stream handlers
// ---------------------------------------------------------------------------------
function onKline(m: KlineMsg) {
  const st = getState();
  const sym = st.pairToSymbol.get(m.pair);
  if (!sym || !isTimeframe(m.tf)) return;
  const c = st.combos.get(comboKey(sym, m.tf));
  if (!c || !isValidCandle(m.candle)) return;
  applyLive(c, m.candle);
  if (m.candle.x && c.synced) {
    // closed candle: evaluate immediately – never wait for the next 5s cycle
    try {
      evaluateCombo(c, nowEx());
    } catch (e) {
      c.lastError = errMsg(e);
    }
  }
}

function onTicker(m: TickerMsg) {
  const st = getState();
  const sym = st.pairToSymbol.get(m.pair);
  if (!sym || !(m.price > 0)) return;
  st.tickers.set(sym, { price: m.price, open: m.open, ts: m.ts });
}

// ---------------------------------------------------------------------------------
// 5-second scan cycle
// ---------------------------------------------------------------------------------
export async function scanCycle(manual = false): Promise<void> {
  const st = getState();
  if (st.scan.running) return;
  st.scan.running = true;
  const t0 = Date.now();
  let evaluated = 0;
  try {
    st.stream?.watchdog();
    await retryPending();
    const now = nowEx();
    for (const c of st.combos.values()) {
      if (!c.synced) continue;
      try {
        if (!c.syncing && !c.needsRefresh && needsRecovery(c, now, manual ? 0 : GRACE_MS)) c.needsRefresh = true;
        if (evaluateCombo(c, now)) evaluated++;
      } catch (e) {
        c.lastError = errMsg(e); // one failing market never stops the scan
      }
    }
    pumpSync();
    st.scan.lastError = null;
  } catch (e) {
    st.scan.lastError = errMsg(e);
  } finally {
    st.scan.running = false;
    st.scan.lastAt = Date.now();
    st.scan.durationMs = Date.now() - t0;
    st.scan.count++;
    st.scan.evaluated = evaluated;
    try {
      publish({ type: "snapshot", data: buildSnapshot() });
    } catch {
      /* ignore */
    }
  }
}

/** Manual "scan now": runs an immediate cycle (rate limited). */
export async function scanNow(): Promise<boolean> {
  const st = getState();
  const now = Date.now();
  if (now - st.scan.lastManualAt < 1500) return false;
  st.scan.lastManualAt = now;
  if (st.scan.running) {
    for (let i = 0; i < 60 && st.scan.running; i++) await sleep(50);
    return true;
  }
  await scanCycle(true);
  return true;
}

let nextAt = 0;
function scheduleScan() {
  const now = Date.now();
  nextAt = nextAt ? nextAt + SCAN_MS : now + SCAN_MS;
  if (nextAt < now - SCAN_MS) nextAt = now + SCAN_MS;
  setTimeout(async () => {
    try {
      await scanCycle(false);
    } catch (e) {
      log("scan cycle error:", errMsg(e));
    } finally {
      scheduleScan();
    }
  }, Math.max(0, nextAt - now));
}

// ---------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------
export async function startScanner(): Promise<void> {
  const st = getState();
  if (st.started) return;
  for (let a = 0; ; a++) {
    try {
      await ensureSchema();
      break;
    } catch (e) {
      if (a >= 8) throw e;
      await sleep(backoffMs(a, 500, 5000));
    }
  }
  if (st.started) return;
  st.started = true;
  st.startedAt = Date.now();
  st.stream = new BinanceStreamGroup(onKline, onTicker);

  try {
    const cached = await getSetting<{
      list: UniverseItem[];
      at: number;
      source: string;
      excludedStable?: number;
      unavailable?: number;
    }>("universe");
    if (cached?.list?.length && cached.list.length >= TOP_N) {
      applyUniverse(cached.list, "cache", cached.excludedStable ?? 0, cached.unavailable ?? 0);
      st.universeUpdatedAt = cached.at;
      await hydrateLastSignals();
    } else if (cached?.list?.length) {
      log(`ignoring cached universe (${cached.list.length}) because Top-${TOP_N} is required`);
    }
  } catch (e) {
    log("cached universe unavailable:", errMsg(e));
  }

  st.stream.start();
  void universeLoop();
  scheduleScan();
  log("scanner started");
}
