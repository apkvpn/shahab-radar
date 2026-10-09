"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  TickMarkType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { TF_MS, TIMEFRAMES, type ChartMarker, type ChartPayload, type PublicSignal, type Timeframe } from "@/lib/shared";
import { fmtDateTime, fmtNum, fmtPct, fmtPrice } from "@/lib/format";
import { ZonesPrimitive, type ZonePoint } from "./chart/zones";

const pad = (n: number) => String(n).padStart(2, "0");

function tickLabel(t: Time, type: TickMarkType): string {
  const d = new Date((t as number) * 1000);
  switch (type) {
    case TickMarkType.Year:
      return String(d.getFullYear());
    case TickMarkType.Month:
      return d.toLocaleString("en-GB", { month: "short" });
    case TickMarkType.DayOfMonth:
      return String(d.getDate());
    default:
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}

function precisionFor(p: number): number {
  const a = Math.abs(p);
  if (a >= 1000) return 2;
  if (a >= 1) return 4;
  if (a >= 0.01) return 5;
  if (a >= 0.0001) return 7;
  return 9;
}

const TAKE_PROFIT = 0.25;
const STOP_LOSS = 0.25;

interface NewsItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: number;
  translated: boolean;
}

export interface ChartHeader {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  state: "LONG" | "WAIT";
  stale: boolean;
}

export default function ChartPanel({
  header,
  symbols,
  tf,
  signal,
  nonce,
  liveSignals,
  onTf,
  onSymbol,
}: {
  header: ChartHeader;
  symbols: string[];
  tf: Timeframe;
  signal: PublicSignal | null;
  nonce: number;
  liveSignals: PublicSignal[];
  onTf: (tf: Timeframe) => void;
  onSymbol: (s: string) => void;
}) {
  const symbol = header.symbol;
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const supRef = useRef<ISeriesApi<"Line"> | null>(null);
  const midRef = useRef<ISeriesApi<"Line"> | null>(null);
  const resRef = useRef<ISeriesApi<"Line"> | null>(null);
  const zonesRef = useRef<ZonesPrimitive | null>(null);
  const markersApi = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const timesRef = useRef<Set<number>>(new Set());
  const zoneData = useRef<ZonePoint[]>([]);
  const lastTime = useRef(0);
  const signalRef = useRef<PublicSignal | null>(signal);

  const [data, setData] = useState<ChartPayload | null>(null);
  const [markers, setMarkers] = useState<ChartMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [fs, setFs] = useState(false);
  const [pseudoFs, setPseudoFs] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [newsOpen, setNewsOpen] = useState(false);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState(false);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [newsPage, setNewsPage] = useState(1);
  const [newsHasMore, setNewsHasMore] = useState(false);
  const detail = signal && signal.symbol === symbol && signal.timeframe === tf ? signal : null;

  useEffect(() => {
    signalRef.current = signal;
    setDetailsOpen(true);
    setNewsOpen(false);
  }, [signal, nonce]);

  const loadNews = useCallback(async (page = 1) => {
    if (!detail) return;
    setNewsLoading(true);
    setNewsError(false);
    try {
      const res = await fetch(`/api/news/${encodeURIComponent(detail.symbol)}?name=${encodeURIComponent(detail.name)}&page=${page}`, { cache: "no-store" });
      const body = await res.json() as { items?: NewsItem[]; hasMore?: boolean };
      if (!res.ok) throw new Error("news unavailable");
      setNewsItems((prev) => page === 1 ? (body.items ?? []) : [...prev, ...(body.items ?? [])]);
      setNewsPage(page);
      setNewsHasMore(!!body.hasMore);
    } catch {
      setNewsError(true);
    } finally {
      setNewsLoading(false);
    }
  }, [detail]);

  // ---- create chart once ---------------------------------------------------------------
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#52525b",
        fontFamily: "IBM Plex Sans, sans-serif",
        fontSize: 11,
        attributionLogo: true,
      },
      grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#f3f4f6" } },
      rightPriceScale: { borderColor: "#e5e7eb", scaleMargins: { top: 0.08, bottom: 0.1 } },
      timeScale: {
        borderColor: "#e5e7eb",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 8,
        minBarSpacing: 1.5,
        tickMarkFormatter: tickLabel,
      },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        timeFormatter: (t: Time) => {
          const d = new Date((t as number) * 1000);
          return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        },
      },
    });
    const zones = new ZonesPrimitive();
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#16a34a",
      wickDownColor: "#ef4444",
      priceLineVisible: true,
    });
    candle.attachPrimitive(zones);
    // overlay lines never influence the price autoscale
    const lineOpts = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null };
    supRef.current = chart.addSeries(LineSeries, { ...lineOpts, color: "#16a34a", lineWidth: 1 });
    midRef.current = chart.addSeries(LineSeries, { ...lineOpts, color: "#c3c9d3", lineWidth: 2 });
    resRef.current = chart.addSeries(LineSeries, { ...lineOpts, color: "#ef4444", lineWidth: 1 });
    markersApi.current = createSeriesMarkers(candle, []);
    chartRef.current = chart;
    candleRef.current = candle;
    zonesRef.current = zones;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      markersApi.current = null;
    };
  }, []);

  // ---- apply a full payload -------------------------------------------------------------
  const applyPayload = useCallback((p: ChartPayload, focus: PublicSignal | null) => {
    const chart = chartRef.current;
    const candle = candleRef.current;
    if (!chart || !candle || !p.candles.length) return;
    const cs = p.candles;
    const n = cs.length;
    candle.setData(cs.map((c) => ({ time: c[0] as UTCTimestamp, open: c[1], high: c[2], low: c[3], close: c[4] })));
    const line = (arr: (number | null)[]) =>
      arr.flatMap((v, i) => (v == null ? [] : [{ time: cs[i][0] as UTCTimestamp, value: v }]));
    supRef.current?.setData(line(p.bands.support));
    midRef.current?.setData(line(p.bands.mid));
    resRef.current?.setData(line(p.bands.resistance));
    const zp: ZonePoint[] = [];
    for (let i = 0; i < n; i++) {
      const s = p.bands.support[i];
      const m = p.bands.mid[i];
      const r = p.bands.resistance[i];
      if (s != null && m != null && r != null) zp.push({ t: cs[i][0], s, m, r });
    }
    zoneData.current = zp;
    zonesRef.current?.setData(zp);
    timesRef.current = new Set(cs.map((c) => c[0]));
    lastTime.current = cs[n - 1][0];
    const pr = precisionFor(cs[n - 1][4]);
    candle.applyOptions({ priceFormat: { type: "price", precision: pr, minMove: Math.pow(10, -pr) } });

    const width = hostRef.current?.clientWidth ?? 800;
    const visible = Math.min(170, Math.max(40, Math.round(width / 7)));
    const ts = chart.timeScale();
    const idx = focus ? cs.findIndex((c) => c[0] * 1000 === focus.candleTime) : -1;
    if (idx >= 0) {
      ts.setVisibleLogicalRange({ from: idx - Math.round(visible * 0.6), to: Math.min(n + 6, idx + Math.round(visible * 0.4)) });
    } else {
      ts.setVisibleLogicalRange({ from: n - visible, to: n + 8 });
    }
  }, []);

  // ---- load data on market / timeframe / focus change -----------------------------------
  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(false);
    const f = signalRef.current;
    const q = f && f.symbol === symbol && f.timeframe === tf ? `?focus=${f.candleTime}` : "";
    fetch(`/api/markets/${symbol}/${tf}${q}`, { cache: "no-store", signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<ChartPayload>;
      })
      .then((p) => {
        applyPayload(p, q ? f : null);
        setData(p);
        setMarkers(p.markers);
        setLoading(false);
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setError(true);
        setLoading(false);
      });
    return () => ac.abort();
  }, [symbol, tf, nonce, reload, applyPayload]);

  // full refresh when returning to a hidden tab (live poll only covers the last candles)
  useEffect(() => {
    const h = () => document.visibilityState === "visible" && setReload((x) => x + 1);
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);

  // ---- live candle updates (served from the scanner's in-memory cache) ------------------
  const live = data?.source === "cache";
  useEffect(() => {
    if (!live) return;
    let busy = false;
    const iv = TF_MS[tf] / 1000;
    const id = setInterval(async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const r = await fetch(`/api/markets/${symbol}/${tf}?live=1`, { cache: "no-store" });
        if (!r.ok) return;
        const p = (await r.json()) as ChartPayload;
        const candle = candleRef.current;
        if (!candle || !p.candles.length) return;
        if (p.candles[0][0] > lastTime.current + iv * 2) {
          setReload((x) => x + 1); // missed too many candles: reload everything
          return;
        }
        p.candles.forEach((c, i) => {
          if (c[0] < lastTime.current) return;
          const time = c[0] as UTCTimestamp;
          candle.update({ time, open: c[1], high: c[2], low: c[3], close: c[4] });
          lastTime.current = c[0];
          timesRef.current.add(c[0]);
          const s = p.bands.support[i];
          const m = p.bands.mid[i];
          const rr = p.bands.resistance[i];
          if (s != null) supRef.current?.update({ time, value: s });
          if (m != null) midRef.current?.update({ time, value: m });
          if (rr != null) resRef.current?.update({ time, value: rr });
          if (s != null && m != null && rr != null) {
            const zd = zoneData.current;
            const pt = { t: c[0], s, m, r: rr };
            const last = zd[zd.length - 1];
            if (last && last.t === c[0]) zd[zd.length - 1] = pt;
            else zd.push(pt);
          }
        });
        zonesRef.current?.setData([...zoneData.current]);
      } catch {
        /* next tick retries */
      } finally {
        busy = false;
      }
    }, 2000);
    return () => clearInterval(id);
  }, [live, symbol, tf]);

  // ---- realtime signals for this market/timeframe become markers instantly --------------
  useEffect(() => {
    if (!data) return;
    const add: ChartMarker[] = [];
    for (const s of liveSignals) {
      if (s.symbol !== symbol || s.timeframe !== tf) continue;
      if (markers.some((m) => m.id === s.id)) continue;
      add.push({
        id: s.id,
        t: Math.floor(s.candleTime / 1000),
        price: s.price,
        support: s.support,
        midline: s.midline,
        resistance: s.resistance,
        signalTime: s.signalTime,
        confirmed: true,
      });
    }
    if (add.length) setMarkers((prev) => [...prev, ...add]);
  }, [liveSignals, data, symbol, tf, markers]);

  // ---- render markers (historical + selected focus) --------------------------------------
  useEffect(() => {
    const api = markersApi.current;
    if (!api) return;
    const sel = signal?.id;
    const list = markers
      .filter((m) => timesRef.current.has(m.t))
      .sort((a, b) => a.t - b.t)
      .map((m) => ({
        time: m.t as UTCTimestamp,
        position: "belowBar" as const,
        shape: "arrowUp" as const,
        color: m.id === sel ? "#15803d" : "#65a30d",
        size: m.id === sel ? 2 : 1,
        text: "LONG",
      }));
    api.setMarkers(list);
  }, [markers, signal, data]);

  // ---- full screen -----------------------------------------------------------------------
  useEffect(() => {
    const h = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  const toggleFs = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (pseudoFs) {
      setPseudoFs(false);
    } else if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => setPseudoFs(true));
    } else {
      setPseudoFs(true); // iOS Safari: CSS full-viewport fallback
    }
  };
  const isFull = fs || pseudoFs;

  const up = header.change != null && header.change >= 0;
  const entryPrice = detail?.price ?? null;
  const takeProfit = entryPrice == null ? null : entryPrice * (1 + TAKE_PROFIT);
  const stopLoss = entryPrice == null ? null : entryPrice * (1 - STOP_LOSS);

  return (
    <div
      ref={wrapRef}
      className={`flex min-h-0 flex-col overflow-hidden bg-white ${
        pseudoFs ? "fixed inset-0 z-50" : "h-full rounded-xl border border-line shadow-[0_1px_2px_rgba(16,24,40,0.05)]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <select
            aria-label="انتخاب ارز"
            value={symbol}
            onChange={(e) => onSymbol(e.target.value)}
            className="num rounded-md border border-line bg-white px-1.5 py-1 text-[13px] font-bold lg:hidden"
          >
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="num hidden text-[18px] font-extrabold tracking-tight lg:inline">{symbol}</span>
          <span className="hidden max-w-[120px] truncate text-[12px] text-gray-500 sm:inline">{header.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`num text-[17px] font-bold ${header.stale ? "text-gray-400" : "text-[#0b0b0c]"}`}>{fmtPrice(header.price)}</span>
          <span className={`num text-[12px] font-medium ${header.change == null ? "text-gray-400" : up ? "text-emerald-600" : "text-red-500"}`}>
            {fmtPct(header.change)}
          </span>
          {header.state === "LONG" ? (
            <span className="num rounded-md bg-lime-400 px-2 py-0.5 text-[12px] font-extrabold text-black">LONG</span>
          ) : (
            <span className="num rounded-md bg-gray-100 px-2 py-0.5 text-[12px] font-semibold text-gray-500">WAIT</span>
          )}
          {header.stale && <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">داده کهنه</span>}
        </div>
        <div className="ms-auto flex items-center gap-2" dir="rtl">
          <div className="flex rounded-lg border border-line p-0.5">
            {TIMEFRAMES.map((t) => (
              <button
                key={t}
                onClick={() => onTf(t)}
                className={`num rounded-md px-2 py-1 text-[12px] font-semibold transition-colors ${
                  t === tf ? "bg-[#111214] text-white" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <button
            onClick={toggleFs}
            className="rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-semibold text-gray-800 hover:bg-gray-50"
          >
            {isFull ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1" dir="ltr">
        <div ref={hostRef} className="absolute inset-0" />
        {loading && (
          <div className="absolute left-3 top-3 rounded-md bg-white/90 px-2 py-1 text-[11px] text-gray-600 shadow-sm" dir="rtl">
            در حال بارگذاری…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center bg-white/80" dir="rtl">
            <div className="text-center">
              <p className="text-[13px] font-semibold text-red-600">داده‌ی این بازار در دسترس نیست</p>
              <button onClick={() => setReload((x) => x + 1)} className="mt-2 rounded-lg bg-[#111214] px-3 py-1.5 text-[12px] font-semibold text-white">
                تلاش دوباره
              </button>
            </div>
          </div>
        )}
        {detail && detailsOpen && !error && (
          <div
            dir="rtl"
            className="absolute left-3 top-3 z-10 w-[270px] rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-white to-emerald-50/90 p-4 text-[14px] shadow-xl shadow-slate-900/10 backdrop-blur-sm"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="num inline-flex items-center gap-1 rounded-lg bg-gradient-to-l from-lime-400 to-emerald-400 px-2.5 py-1 text-[12px] font-extrabold text-slate-950 shadow-sm">
                ▲ LONG
              </span>
              <button onClick={() => setDetailsOpen(false)} className="rounded-md px-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="بستن">
                ×
              </button>
            </div>
            <div className="num text-[19px] font-extrabold tracking-tight text-slate-900">
              {detail.symbol} <span className="text-gray-400">·</span> {detail.timeframe}
            </div>
            <div className="num mt-1 text-[20px] font-bold text-slate-800">{fmtPrice(detail.price)}</div>
            <div className="num text-[12px] text-slate-500">{fmtDateTime(detail.signalTime)}</div>
            <button
              onClick={() => {
                setNewsOpen(true);
                if (!newsItems.length) void loadNews(1);
              }}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-[13px] font-bold text-white shadow-sm transition hover:bg-slate-700"
            >
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-lime-400" />
              Live News <span className="font-normal text-slate-300">· اخبار زنده</span>
            </button>
            <dl className="mt-3 space-y-1.5 border-t border-emerald-100 pt-3">
              <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-2.5 py-1.5">
                <dt className="font-semibold text-emerald-700">قیمت ورود واقعی</dt>
                <dd className="num text-[15px] font-bold text-emerald-800">{fmtNum(detail.support)}</dd>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-sky-50 px-2.5 py-1.5">
                <dt className="font-semibold text-sky-700">حد سود</dt>
                <dd className="num text-[15px] font-bold text-sky-800">{takeProfit == null ? "—" : fmtNum(takeProfit)}</dd>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-rose-50 px-2.5 py-1.5">
                <dt className="font-semibold text-rose-700">حدضرر</dt>
                <dd className="num text-[15px] font-bold text-rose-800">{stopLoss == null ? "—" : fmtNum(stopLoss)}</dd>
              </div>
              <div className="flex items-center justify-between px-2.5 pt-1 text-slate-500">
                <dt className="font-semibold">رتبه</dt>
                <dd className="num font-bold text-slate-700">#{detail.rank}</dd>
              </div>
            </dl>
          </div>
        )}
        {newsOpen && detail && (
          <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-4" dir="rtl" onMouseDown={(e) => { if (e.target === e.currentTarget) setNewsOpen(false); }}>
            <section className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <header className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-l from-slate-950 to-slate-800 px-5 py-4 text-white">
                <div>
                  <h2 className="text-lg font-extrabold">اخبار زنده {detail.symbol}</h2>
                  <p className="mt-0.5 text-xs text-slate-300">جدیدترین اخبار بازار، مرتب‌شده از جدید به قدیم</p>
                </div>
                <button onClick={() => setNewsOpen(false)} className="rounded-lg px-2 py-1 text-2xl leading-none text-slate-300 hover:bg-white/10 hover:text-white" aria-label="بستن اخبار">×</button>
              </header>
              <div className="min-h-0 overflow-y-auto p-4">
                {newsLoading && !newsItems.length && <div className="py-12 text-center text-sm text-slate-500">در حال دریافت و ترجمهٔ اخبار…</div>}
                {newsError && !newsItems.length && <div className="py-12 text-center text-sm text-rose-600">دریافت اخبار ممکن نشد. لطفاً دوباره تلاش کنید.</div>}
                {!newsLoading && !newsError && !newsItems.length && <div className="py-12 text-center text-sm text-slate-500">خبر جدیدی برای این ارز پیدا نشد.</div>}
                <div className="space-y-3">
                  {newsItems.map((item) => (
                    <article key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 transition hover:border-lime-300 hover:bg-lime-50/40">
                      <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500">
                        <span>{item.source}</span>
                        <time>{new Date(item.publishedAt).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" })}</time>
                      </div>
                      <h3 className="mt-1.5 text-[14px] font-extrabold leading-6 text-slate-900">{item.title}</h3>
                      {item.summary && <p className="mt-1 text-[12px] leading-5 text-slate-600">{item.summary}</p>}
                      <a href={item.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[11px] font-bold text-sky-700 hover:text-sky-900">مشاهدهٔ منبع خبر ←</a>
                    </article>
                  ))}
                </div>
                {newsHasMore && (
                  <button onClick={() => void loadNews(newsPage + 1)} disabled={newsLoading} className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    {newsLoading ? "در حال بارگذاری…" : "نمایش بیشتر"}
                  </button>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
