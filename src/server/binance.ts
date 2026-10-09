import type { Timeframe } from "@/lib/shared";
import type { Candle } from "./engine";
import { HttpError, backoffMs, getState, log, nowEx, sleep } from "./core";

const envList = (v: string | undefined, d: string[]) =>
  v ? v.split(",").map((s) => s.trim()).filter(Boolean) : d;

const REST_HOSTS = envList(process.env.BINANCE_REST_URLS, [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api-gcp.binance.com",
]);

const WS_HOSTS = envList(process.env.BINANCE_WS_URLS, [
  "wss://data-stream.binance.vision",
  "wss://stream.binance.com:9443",
]);

// ---------------------------------------------------------------------------------
// REST (initial sync + recovery only) with host failover, weight budget & backoff
// ---------------------------------------------------------------------------------
let hostIdx = 0;
let pausedUntil = 0;

async function binanceGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = pausedUntil - Date.now();
    if (wait > 0) await sleep(Math.min(wait, 65_000));
    const idx = (hostIdx + attempt) % REST_HOSTS.length;
    const url = `${REST_HOSTS[idx]}${path}${qs ? `?${qs}` : ""}`;
    try {
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      const w = Number(res.headers.get("x-mbx-used-weight-1m"));
      if (w > 4500) {
        // stay well below the exchange limit: wait for the next minute window
        pausedUntil = Math.max(pausedUntil, Date.now() + 60_000 - (Date.now() % 60_000) + 500);
      }
      if (res.ok) {
        hostIdx = idx;
        return (await res.json()) as T;
      }
      if (res.status === 429 || res.status === 418) {
        const ra = Number(res.headers.get("retry-after")) || 30;
        pausedUntil = Math.max(pausedUntil, Date.now() + ra * 1000);
        lastErr = new HttpError(res.status, url, true);
      } else if (res.status === 400) {
        throw new HttpError(400, url, false);
      } else {
        lastErr = new HttpError(res.status, url, true);
      }
    } catch (e) {
      if (e instanceof HttpError && !e.retryable) throw e;
      lastErr = e;
    }
    if (attempt < 3) await sleep(backoffMs(attempt, 400, 5000));
  }
  throw lastErr instanceof Error ? lastErr : new Error("binance_request_failed");
}

function parseRestKline(r: unknown[], now: number): Candle | null {
  const t = Number(r[0]);
  const o = Number(r[1]);
  const h = Number(r[2]);
  const l = Number(r[3]);
  const c = Number(r[4]);
  const v = Number(r[5]);
  const closeTime = Number(r[6]);
  if (![t, o, h, l, c, closeTime].every(Number.isFinite)) return null;
  if (o <= 0 || h <= 0 || l <= 0 || c <= 0) return null;
  const eps = h * 1e-12;
  if (h + eps < Math.max(o, c) || l - eps > Math.min(o, c) || h + eps < l) return null;
  return { t, o, h, l, c, v: Number.isFinite(v) ? v : 0, x: closeTime + 300 < now };
}

export async function fetchKlines(
  pair: string,
  tf: Timeframe,
  limit: number,
  startTime?: number,
  endTime?: number,
): Promise<Candle[]> {
  const params: Record<string, string | number> = { symbol: pair, interval: tf, limit };
  if (startTime && startTime > 0) params.startTime = Math.floor(startTime);
  if (endTime && endTime > 0) params.endTime = Math.floor(endTime);
  const rows = await binanceGet<unknown[][]>("/api/v3/klines", params);
  const now = nowEx();
  const out: Candle[] = [];
  for (const r of rows) {
    const c = parseRestKline(r, now);
    if (c) out.push(c);
  }
  return out;
}

export async function fetchServerTime(): Promise<number> {
  const r = await binanceGet<{ serverTime: number }>("/api/v3/time");
  return r.serverTime;
}

/** base asset -> best available spot pair (TRADING only), with stable quotes preferred. */
export async function fetchUsdtPairs(): Promise<Map<string, string>> {
  const info = await binanceGet<{
    symbols: { symbol: string; status: string; baseAsset: string; quoteAsset: string; isSpotTradingAllowed?: boolean }[];
  }>("/api/v3/exchangeInfo", { permissions: "SPOT" });
  const map = new Map<string, string>();
  const preferredQuotes = ["USDT", "USDC", "FDUSD", "BTC", "ETH", "BNB"];
  const quoteRank = (quote: string) => {
    const i = preferredQuotes.indexOf(quote);
    return i >= 0 ? i : 100 + quote.length;
  };
  for (const s of info.symbols) {
    if (s.status !== "TRADING" || s.isSpotTradingAllowed === false) continue;
    const base = s.baseAsset.toUpperCase();
    const current = map.get(base);
    const currentQuote = current?.slice(base.length);
    if (!current || quoteRank(s.quoteAsset) < quoteRank(currentQuote ?? "ZZZZ")) map.set(base, s.symbol);
  }
  return map;
}

export async function fetchPrices(): Promise<Map<string, number>> {
  const rows = await binanceGet<{ symbol: string; price: string }[]>("/api/v3/ticker/price");
  const m = new Map<string, number>();
  for (const r of rows) {
    const p = Number(r.price);
    if (Number.isFinite(p) && p > 0) m.set(r.symbol, p);
  }
  return m;
}

// ---------------------------------------------------------------------------------
// WebSocket streaming (continuous updates)
// ---------------------------------------------------------------------------------
export interface KlineMsg {
  pair: string;
  tf: string;
  candle: Candle;
}
export interface TickerMsg {
  pair: string;
  price: number;
  open: number;
  ts: number;
}

export class BinanceStream {
  state: "connecting" | "connected" | "disconnected" = "disconnected";
  lastMessageAt = 0;
  connectedAt = 0;
  reconnects = 0;
  private ws: WebSocket | null = null;
  private desired = new Set<string>();
  private attempt = 0;
  private hostIdx = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private connectingSince = 0;
  private msgId = 1;
  private outbox: string[] = [];
  private pumping = false;
  private stopped = false;

  constructor(
    private onKline: (m: KlineMsg) => void,
    private onTicker: (m: TickerMsg) => void,
  ) {}

  start() {
    this.stopped = false;
    this.connect();
  }

  /** Diff-based update: only added/removed streams are (un)subscribed. */
  setStreams(list: string[]) {
    const next = new Set(list);
    const add = [...next].filter((s) => !this.desired.has(s));
    const rem = [...this.desired].filter((s) => !next.has(s));
    this.desired = next;
    if (this.state === "connected") {
      this.enqueue("SUBSCRIBE", add);
      this.enqueue("UNSUBSCRIBE", rem);
    }
  }

  /** Called from the 5s scan loop. */
  watchdog() {
    const now = Date.now();
    if (this.state === "connected" && now - this.lastMessageAt > 20_000) {
      log("stream silent for 20s – reconnecting");
      this.forceClose();
    } else if (this.state === "connecting" && now - this.connectingSince > 15_000) {
      this.forceClose();
    } else if (this.state === "disconnected" && !this.timer && !this.stopped) {
      this.scheduleReconnect();
    }
  }

  private forceClose() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    // some runtimes don't emit close for a dead socket
    this.handleClose();
  }

  private connect() {
    if (this.stopped) return;
    if (this.ws && (this.state === "connecting" || this.state === "connected")) return;
    const host = WS_HOSTS[this.hostIdx % WS_HOSTS.length];
    this.state = "connecting";
    this.connectingSince = Date.now();
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${host}/stream`);
    } catch {
      this.handleClose();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.state = "connected";
      this.connectedAt = Date.now();
      this.lastMessageAt = Date.now();
      this.attempt = 0;
      this.outbox = [];
      this.enqueue("SUBSCRIBE", [...this.desired]);
      log("market stream connected", host);
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (this.ws !== ws) return;
      this.lastMessageAt = Date.now();
      try {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)) as {
          data?: Record<string, unknown>;
        };
        const d = msg.data;
        if (!d) return;
        if (d.e === "kline") {
          const k = d.k as Record<string, unknown>;
          this.onKline({
            pair: String(k.s),
            tf: String(k.i),
            candle: {
              t: Number(k.t),
              o: Number(k.o),
              h: Number(k.h),
              l: Number(k.l),
              c: Number(k.c),
              v: Number(k.v),
              x: Boolean(k.x),
            },
          });
        } else if (d.e === "24hrMiniTicker") {
          this.onTicker({ pair: String(d.s), price: Number(d.c), open: Number(d.o), ts: Number(d.E) });
        }
      } catch {
        /* malformed frame – ignore */
      }
    };
    ws.onerror = () => {
      /* close follows */
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.handleClose();
    };
  }

  private handleClose() {
    this.ws = null;
    this.state = "disconnected";
    this.outbox = [];
    if (!this.stopped) this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.timer) return;
    this.reconnects++;
    if (this.attempt > 0 && this.attempt % 2 === 0) this.hostIdx++; // rotate host on repeated failure
    const delay = backoffMs(this.attempt, 1000, 30_000);
    this.attempt++;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, delay);
  }

  private enqueue(method: "SUBSCRIBE" | "UNSUBSCRIBE", streams: string[]) {
    for (let i = 0; i < streams.length; i += 50) {
      const params = streams.slice(i, i + 50);
      this.outbox.push(JSON.stringify({ method, params, id: this.msgId++ }));
    }
    void this.pump();
  }

  // exchange allows 5 control messages/second – stay below
  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.outbox.length && this.state === "connected" && this.ws) {
        const m = this.outbox.shift()!;
        try {
          this.ws.send(m);
        } catch {
          break;
        }
        await sleep(300);
      }
    } finally {
      this.pumping = false;
    }
  }
}

export function getStreamState() {
  return getState().stream;
}

/** Binance allows a bounded number of subscriptions per socket; shard large universes safely. */
export class BinanceStreamGroup {
  private shards: BinanceStream[] = [];
  private desired: string[] = [];
  private started = false;
  constructor(
    private onKline: (m: KlineMsg) => void,
    private onTicker: (m: TickerMsg) => void,
  ) {}
  private rebuild() {
    const count = Math.max(1, Math.ceil(this.desired.length / 900));
    while (this.shards.length < count) this.shards.push(new BinanceStream(this.onKline, this.onTicker));
    while (this.shards.length > count) this.shards.pop();
    for (let i = 0; i < this.shards.length; i++) {
      this.shards[i].setStreams(this.desired.slice(i * 900, (i + 1) * 900));
      if (this.started) this.shards[i].start();
    }
  }
  start() { this.started = true; this.rebuild(); }
  setStreams(list: string[]) { this.desired = [...list]; this.rebuild(); }
  watchdog() { for (const shard of this.shards) shard.watchdog(); }
  get state(): "connecting" | "connected" | "disconnected" {
    if (this.shards.length && this.shards.every((s) => s.state === "connected")) return "connected";
    if (this.shards.some((s) => s.state === "connecting" || s.state === "connected")) return "connecting";
    return "disconnected";
  }
  get lastMessageAt() { return this.shards.reduce((max, s) => Math.max(max, s.lastMessageAt), 0); }
}
