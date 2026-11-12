/* ============================================================================
   SHAHAB RADAR — app
   ============================================================================ */
/* ENGINE-START */
/* ============================================================================
   SIGNAL ENGINE — daily only
   Support band = smoothed close ± MULT·ATR, midline from the ALMA smoothing.
   A signal fires when the low pierces support and the candle closes back above
   it. Entry = that close. TP = the grey midline.
   Outcome: TP once price touches the midline, OPEN until it does. There is no
   stop loss — a trade only ever closes at the target.
   ============================================================================ */
const W = 80, BANDWIDTH = 2, OFFSET = 0.85, SIGMA = 8, ATR_LEN = 100, MULT = 4;
const TREND_LOOKBACK = 5;

const KERNEL = (() => {
  const w = []; let sum = 0;
  for (let k = 0; k < W; k++) { const v = Math.exp(-(k * k) / (2 * BANDWIDTH * BANDWIDTH)); w.push(v); sum += v; }
  return w.map(v => v / sum);
})();
const ALMA = (() => {
  const m = Math.floor(OFFSET * (W - 1)), s = W / SIGMA;
  const w = []; let sum = 0;
  for (let i = 0; i < W; i++) { const v = Math.exp(-((i - m) * (i - m)) / (2 * s * s)); w.push(v); sum += v; }
  return w.map(v => v / sum);
})();

const valid = c => c && [c.o, c.h, c.l, c.c].every(n => Number.isFinite(n) && n > 0)
  && c.h + c.h * 1e-12 >= Math.max(c.o, c.c) && c.l - c.h * 1e-12 <= Math.min(c.o, c.c) && c.h >= c.l;

function bands(candles) {
  const n = candles.length;
  const nw = new Array(n).fill(NaN), mid = new Array(n).fill(NaN), atr = new Array(n).fill(NaN);
  const sup = new Array(n).fill(NaN), res = new Array(n).fill(NaN);
  for (let i = W - 1; i < n; i++) { let acc = 0; for (let k = 0; k < W; k++) acc += candles[i - k].c * KERNEL[k]; nw[i] = acc; }
  for (let i = 2 * W - 2; i < n; i++) {
    let acc = 0; const base = i - (W - 1);
    for (let j = 0; j < W; j++) acc += nw[base + j] * ALMA[j];
    mid[i] = acc;
  }
  let rma = NaN, seed = 0;
  for (let i = 0; i < n; i++) {
    const c = candles[i], pc = i > 0 ? candles[i - 1].c : NaN;
    const tr = Number.isFinite(pc) ? Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc)) : c.h - c.l;
    if (i < ATR_LEN) { seed += tr; if (i === ATR_LEN - 1) { rma = seed / ATR_LEN; atr[i] = rma; } }
    else { rma = (rma * (ATR_LEN - 1) + tr) / ATR_LEN; atr[i] = rma; }
  }
  for (let i = 0; i < n; i++) if (Number.isFinite(mid[i]) && Number.isFinite(atr[i])) {
    sup[i] = mid[i] - MULT * atr[i]; res[i] = mid[i] + MULT * atr[i];
  }
  return { mid, sup, res, atr };
}

function analyze(candles) {
  const b = bands(candles);
  const { mid, sup, atr } = b;
  const signals = [], last = candles.length - 1;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    if (!c.x && i !== last) continue;
    if (!valid(c) || !valid(p)) continue;
    const s = sup[i], ps = sup[i - 1];
    if (!Number.isFinite(s) || !Number.isFinite(ps) || !Number.isFinite(atr[i])) continue;
    if (!(c.l < s && p.l >= ps)) continue;
    if (!(mid[i] > c.c)) continue;                    // TP must sit above the entry
    const reclaim = c.c > s;
    const trendUp = Number.isFinite(mid[i - TREND_LOOKBACK]) && mid[i] > mid[i - TREND_LOOKBACK];
    signals.push({
      i, t: c.t, entry: c.c, support: s, mid: mid[i], resistance: b.res[i], atr: atr[i],
      quality: reclaim && trendUp, live: !c.x,
      tp: mid[i],
    });
  }
  return { ...b, signals };
}

function settle(candles, s) {
  const lastClose = candles[candles.length - 1].c;
  const tpPct = (s.tp / s.entry - 1) * 100;
  for (let j = s.i + 1; j < candles.length; j++) {
    if (candles[j].h >= s.tp) return { ...s, outcome: "TP", days: j - s.i, pnlPct: tpPct };
  }
  return { ...s, outcome: "OPEN", days: null, pnlPct: (lastClose / s.entry - 1) * 100 };
}
/* ENGINE-END */

const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOST = "https://api.gateio.ws";
const UNIVERSE = 1000;
const BATCH = 110;
const CONC = 6;
const D1 = { k: "1d", iv: "1d", ms: 864e5, bars: 500 };
const CHART_BARS = 900;
const STABLE = new Set("usdt usdc dai tusd busd fdusd usde usds usdd pyusd usdg rlusd lusd susd usdp eurc eurt frax gho usdb usdx ousd mim usd1".split(" "));
const toPair = s => s.includes("_") ? s.toUpperCase() : `${s.replace(/USDT$/i, "")}_USDT`.toUpperCase();

let nextSlot = 0, gap = 130;
async function api(path, params, tries = 3, priority = false) {
  const qs = new URLSearchParams(Object.entries(params || {}).map(([k, v]) => [k, String(v)]));
  const url = `${HOST}${path}?${qs}`;
  if (priority) nextSlot = Date.now();
  for (let a = 0; a < tries; a++) {
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + gap;
    if (wait > 0) await sleep(wait);
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) { gap = Math.max(110, gap - 4); return await res.json(); }
      if (res.status === 429) { gap = Math.min(900, Math.round(gap * 1.7)); await sleep(1500); continue; }
      throw new Error("gate_" + res.status);
    } catch (e) {
      gap = Math.min(900, Math.round(gap * 1.4));
      await sleep(500 * (a + 1) + Math.round(Math.random() * 400));
    }
  }
  throw new Error("gate_failed");
}

function parse(rows, tfMs) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    const t = Number(r[0]) * 1000;
    const close = Number(r[2]), high = Number(r[3]), low = Number(r[4]), open = Number(r[5]), vol = Number(r[6]);
    if (![t, open, high, low, close].every(Number.isFinite)) continue;
    if (!(open > 0 && high > 0 && low > 0 && close > 0) || high < low) continue;
    out.push({ t, o: open, h: high, l: low, c: close, v: Number.isFinite(vol) ? vol : 0,
      x: r[7] === "true" || r[7] === true || t + tfMs + 60_000 < Date.now() });
  }
  return out.sort((a, b) => a.t - b.t);
}

async function universe() {
  const list = await api("/api/v4/spot/tickers", {});
  if (!Array.isArray(list)) throw new Error("bad_tickers");
  const seen = new Set(), ranked = [];
  for (const r of list) {
    const cp = String(r.currency_pair || "").toUpperCase();
    if (!cp.endsWith("_USDT")) continue;
    const base = cp.slice(0, -5);
    if (!/^[A-Z0-9]{2,15}$/.test(base) || STABLE.has(base.toLowerCase()) || seen.has(base)) continue;
    if (/(3L|3S|5L|5S|UP|DOWN|BULL|BEAR)$/.test(base)) continue;
    const price = Number(r.last ?? r.lowest_ask), vol = Number(r.quote_volume ?? r.base_volume);
    if (!(price > 0) || !Number.isFinite(vol) || vol <= 0) continue;
    const chg = Number(r.change_percentage);
    seen.add(base);
    ranked.push({ symbol: base, pair: cp, price, volume: vol, change: Number.isFinite(chg) ? chg : null });
  }
  ranked.sort((a, b) => b.volume - a.volume);
  return ranked.slice(0, UNIVERSE).map((m, i) => ({ ...m, rank: i + 1 }));
}

async function candles(pair, bars, priority = false) {
  const rows = await api("/api/v4/spot/candlesticks", {
    currency_pair: toPair(pair), interval: D1.iv, limit: Math.min(1000, Math.max(200, bars)),
  }, priority ? 5 : 3, priority);
  return parse(rows, D1.ms).slice(-bars);
}

const KEY = "shahab-radar-d1-v8", CACHE_VERSION = 8;

/* The scan lives in localStorage for good: the markets list, every signal that
   was already found, the position the scan stopped at and whether a full pass
   finished. Coming back to the page resumes from that point instead of starting
   over, and a rescan only ever adds or refreshes signals — never wipes them. */
function loadCache() {
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return null;
    const d = JSON.parse(raw);
    return d && d.v === CACHE_VERSION && Array.isArray(d.markets) && d.markets.length ? d : null;
  } catch { return null; }
}
function saveCache() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      v: CACHE_VERSION, at: Date.now(), done: !!state.done, strict: state.strict,
      cursor: state.cursor, round: state.round, scannedRound: state.scannedRound, scanned: state.scanned,
      markets: state.markets, signals: state.signals,
    }));
  } catch {}
}

/* ============================================================================
   STATE
   ============================================================================ */
const state = {
  markets: [], signals: [], at: 0, cursor: 0, round: 0, gen: 0, scannedRound: 0,
  busy: false, total: 0, scanned: 0, strict: true, charts: new Map(), focusT: null, drawSeq: 0, selectedSymbol: null,
  reporting: false, done: false,
  filter: "all", query: "", sort: "new", watch: new Set(), lastIds: new Set(),
};
const $ = id => document.getElementById(id);
const fmt = v => v == null || !Number.isFinite(v) ? "—"
  : Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 })
  : v.toLocaleString("en-US", { maximumSignificantDigits: 6 });
const pct = v => v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
const dayKey = t => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const stamp = t => `${dayKey(t)} ${new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}`;

function paintStatus(text, tone) {
  $("status").className = `pill ${tone || "warn"}`;
  $("statusText").textContent = text;
}
function setProgress(frac, text) {
  $("scanBar").style.width = `${Math.round(Math.min(1, Math.max(0, frac)) * 100)}%`;
  if (text) $("scanText").textContent = text;
}
function outcomeChip(s) {
  if (s.outcome === "TP") return `<span class="sig-badge tp" title="Closed in profit at the midline">TP</span>`;
  return `<span class="sig-badge open" title="Trade still open">OPEN</span>`;
}

/* ---------- watchlist ---------- */
const WATCH_KEY = "shahab-radar-watch-v1";
function loadWatch() {
  try { const a = JSON.parse(localStorage.getItem(WATCH_KEY) || "[]"); return new Set(Array.isArray(a) ? a : []); } catch { return new Set(); }
}
function saveWatch() { try { localStorage.setItem(WATCH_KEY, JSON.stringify([...state.watch])); } catch {} }
function toggleWatch(sym) {
  if (state.watch.has(sym)) state.watch.delete(sym); else state.watch.add(sym);
  saveWatch(); renderSignals();
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg) {
  const t = $("toast"); if (!t) return;
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 4000);
}

/* ---------- stats ---------- */
function renderStats() {
  const rows = state.signals, tp = rows.filter(s => s.outcome === "TP");
  const net = tp.reduce((a, s) => a + (Number.isFinite(s.pnlPct) ? s.pnlPct : 0), 0);
  $("stSignals").textContent = rows.length;
  $("stTp").textContent = tp.length;
  $("stOpen").textContent = rows.length - tp.length;
  $("stRate").textContent = rows.length ? ((tp.length / rows.length) * 100).toFixed(1) + "%" : "—";
  $("stAvg").textContent = tp.length ? pct(net / tp.length) : "—";
}

/* ---------- signal list ---------- */
const tpPctOf = s => ((s.tp / s.entry) - 1) * 100;
function marketOf(sym) { return state.markets.find(m => m.symbol === sym); }
function progressOf(s) {
  if (s.outcome === "TP") return 100;
  const m = marketOf(s.symbol);
  const p = m && Number.isFinite(m.price) ? m.price : null;
  if (p == null || !(s.tp > s.entry)) return null;
  return Math.max(0, Math.min(100, ((p - s.entry) / (s.tp - s.entry)) * 100));
}
function visibleSignals() {
  const q = state.query.trim().toUpperCase();
  const weekAgo = Date.now() - 7 * 864e5;
  let list = state.signals.slice();
  if (q) list = list.filter(x => x.symbol.includes(q));
  if (state.filter === "tp") list = list.filter(x => x.outcome === "TP");
  if (state.filter === "open") list = list.filter(x => x.outcome !== "TP");
  if (state.filter === "new") list = list.filter(x => x.candleTime >= weekAgo);
  if (state.filter === "star") list = list.filter(x => state.watch.has(x.symbol));
  const by = state.sort;
  list.sort((a, b) => {
    if (by === "rank") return (a.rank || 1e9) - (b.rank || 1e9);
    if (by === "tp") return tpPctOf(b) - tpPctOf(a);
    if (by === "prog") return (progressOf(b) ?? -1) - (progressOf(a) ?? -1);
    return b.candleTime - a.candleTime;
  });
  const pinned = [], rest = [];
  for (const x of list) (state.watch.has(x.symbol) ? pinned : rest).push(x);
  return pinned.concat(rest);
}

function renderSignals() {
  const box = $("signals");
  const list = visibleSignals();
  const total = state.signals.length;
  $("sigCount").textContent = list.length === total ? `${total} signals` : `${list.length} / ${total} signals`;
  $("sigNote").textContent = state.strict ? "Quality filter on · close back above support + rising midline" : "All support breaks";
  renderStats();
  if (!list.length) {
    box.innerHTML = `<div class="empty">${total ? "No signal matches this filter." : state.busy ? "Scanning markets…" : "No signal yet — the scan is looking."}</div>`;
    return;
  }
  const weekAgo = Date.now() - 7 * 864e5;
  const frag = document.createDocumentFragment();
  for (const s of list) {
    const fresh = s.candleTime >= weekAgo;
    const m = marketOf(s.symbol);
    const prog = progressOf(s);
    const p = m && Number.isFinite(m.price) ? m.price : null;
    const chg = m && Number.isFinite(m.change) ? m.change : null;
    const el = document.createElement("div");
    el.className = `sig${fresh ? " fresh" : ""}`;
    el.tabIndex = 0;
    el.innerHTML = `
      <span class="sig-head">
        <span style="display:flex;align-items:center;gap:6px">
          <span class="sym num">${s.symbol}</span>
          <span class="tag d1">D1</span>
          ${s.rank ? `<span class="tag rank" title="Market rank by 24h volume">#${s.rank}</span>` : ""}
        </span>
        <span class="right">
          ${outcomeChip(s)}
          <button class="star${state.watch.has(s.symbol) ? " on" : ""}" data-star="${s.symbol}" title="Watch this coin">★</button>
          <button class="bell${alerts[s.symbol] ? " on" : ""}" data-bell="${s.symbol}" title="${alerts[s.symbol] ? `Alert above ${alerts[s.symbol]}` : "Set a price alert"}">◔</button>
        </span>
      </span>
      ${fresh ? `<span class="badge-new">New Signal</span>` : ""}
      <span class="px num"><b>${p == null ? fmt(s.entry) : fmt(p)}</b>${chg == null ? "" : `<i class="${chg >= 0 ? "up" : "down"}">${pct(chg)}</i>`}</span>
      <span class="sig-rows num">
        <span>Entry <b>${fmt(s.entry)}</b></span>
        <span><em style="color:#93c5fd">TP</em> <b>${fmt(s.tp)}</b> <i>${pct(tpPctOf(s))}</i></span>
      </span>
      <span class="prog${s.outcome === "TP" ? " done" : ""}"><i style="width:${prog == null ? 0 : prog.toFixed(1)}%"></i></span>
      <span class="sig-foot num">
        <span>${stamp(s.candleTime)}</span>
        <span>${s.outcome === "OPEN" ? pct(s.pnlPct) : `${s.days}d · hit`}</span>
      </span>`;
    el.onclick = () => {
      $("chartSym").scrollIntoView({ behavior: "smooth", block: "center" });
      selectSymbol(s.symbol, s.candleTime / 1000);
    };
    el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); } };
    const star = el.querySelector("[data-star]");
    if (star) star.onclick = e => { e.stopPropagation(); toggleWatch(s.symbol); };
    const bellEl = el.querySelector("[data-bell]");
    if (bellEl) bellEl.onclick = e => { e.stopPropagation(); setAlert(s.symbol); };
    frag.appendChild(el);
  }
  box.innerHTML = "";
  box.appendChild(frag);
}

/* ============================================================================
   SCAN
   ============================================================================ */
async function loadUniverse(force) {
  const cached = !force && loadCache();
  if (cached) {
    state.markets = cached.markets; state.signals = cached.signals || [];
    state.at = cached.at; state.cursor = cached.cursor || 0; state.round = cached.round || 0;
    state.done = !!cached.done; state.strict = cached.strict !== false;
    state.scannedRound = cached.scannedRound || 0;
    state.total = cached.markets.length; state.scanned = cached.markets.filter(m => m.scannedAt).length;
    $("mode").textContent = `Quality: ${state.strict ? "High" : "All"}`;
    renderAll();
    paintStatus("Live", "live");
    if (Date.now() - cached.at < 60_000) return;
  }
  const markets = await universe();
  const prev = new Map(state.markets.map(m => [m.symbol, m]));
  state.markets = markets.map(m => {
    const old = prev.get(m.symbol);
    const sig = old && old.sig ? { ...old.sig, rank: m.rank } : null;
    return old ? { ...m, sig, scannedAt: old.scannedAt || 0 } : { ...m, sig: null, scannedAt: 0 };
  });
  state.total = state.markets.length;
  rebuildSignals();
  renderAll();
  buildReportCoins();
}

function rebuildSignals() {
  const out = [];
  for (const m of state.markets) if (m.sig) out.push(m.sig);
  state.signals = out;
}

async function scanSlice() {
  if (state.busy || !state.markets.length) return;
  state.busy = true;
  paintStatus("Scanning", "warn");
  const total = state.markets.length;
  const start = state.cursor % total;
  const slice = [];
  for (let i = 0; i < Math.min(BATCH, total); i++) slice.push(state.markets[(start + i) % total]);
  state.cursor = (start + slice.length) % total;
  if (state.cursor < start) { state.round++; state.done = true; }
  if (start === 0) state.scannedRound = 0;

  let done = 0;
  const queue = [...slice];
  const worker = async () => {
    for (;;) {
      const m = queue.shift();
      if (!m) return;
      try {
        const own = await candles(m.pair, D1.bars);
        if (own.length >= 2 * W + 10) {
          const a = analyze(own);
          const sig = a.signals[a.signals.length - 1];
          if (sig && (!state.strict || sig.quality) && (!m.sig || sig.t >= m.sig.candleTime)) {
            const out = settle(own, sig);
            m.sig = {
              id: `${m.symbol}-${sig.t}`, symbol: m.symbol, rank: m.rank,
              entry: sig.entry, tp: sig.tp, support: sig.support,
              candleTime: sig.t, quality: sig.quality, live: sig.live,
              outcome: out.outcome, days: out.days, pnlPct: out.pnlPct,
            };
          }
        }
        m.scannedAt = Date.now();
      } catch (e) {}
      done++; state.scanned++; state.scannedRound++;
      setProgress(state.scannedRound / slice.length,
        `Round ${state.round + 1} · ${Math.min(state.scannedRound, total)} of ${total} markets`);
      if (done % 10 === 0) { rebuildSignals(); renderSignals(); }
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  state.busy = false;

  rebuildSignals();
  renderAll();
  paintStatus("Live", "live");
  state.at = Date.now();
  saveCache();
}

async function refreshPrices() {
  if (state.reporting || !state.markets.length) return;
  try {
    const list = await api("/api/v4/spot/tickers", {});
    if (!Array.isArray(list)) return;
    const byPair = new Map();
    for (const r of list) byPair.set(String(r.currency_pair || "").toUpperCase(), r);
    for (const m of state.markets) {
      const r = byPair.get(m.pair); if (!r) continue;
      const pr = Number(r.last ?? r.lowest_ask), chg = Number(r.change_percentage);
      if (pr > 0) m.price = pr;
      if (Number.isFinite(chg)) m.change = chg;
    }
    renderSignals();
    const sel = marketOf(state.selectedSymbol);
    if (sel && Number.isFinite(sel.price)) {
      $("chartPrice").textContent = fmt(sel.price);
      if (Number.isFinite(sel.change)) {
        $("chartChange").textContent = pct(sel.change);
        $("chartChange").style.color = sel.change >= 0 ? "#34d399" : "#fb7185";
      }
    }
  } catch (e) {}
}

async function runRounds() {
  const gen = ++state.gen;
  while (!state.done) {
    if (state.gen !== gen || !state.markets.length) return;
    if (state.reporting) { await sleep(400); continue; }
    if (state.busy) { await sleep(300); continue; }
    await scanSlice();
  }
  if (state.gen !== gen) return;
  saveCache();
  paintStatus("Saved", "live");
  const freshCount = state.signals.filter(x => !state.lastIds.has(x.id)).length;
  state.lastIds = new Set(state.signals.map(x => x.id));
  if (freshCount) toast(`${freshCount} new signal${freshCount > 1 ? "s" : ""} found`);
  setProgress(1, `All ${state.total} markets checked · ${state.signals.length} signals saved`);
}

/* ============================================================================
   CHART
   ============================================================================ */
let chartApi = null, candleSeries = null, bandS = null, markersApi = null, priceLines = [];

function initChart() {
  const chart = LightweightCharts.createChart($("chart"), {
    autoSize: true,
    layout: { background: { type: "solid", color: "#0a0d12" }, textColor: "#8a94a4", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", fontSize: 11, attributionLogo: true },
    grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,.045)" } },
    rightPriceScale: { borderVisible: false, entireTextOnly: true, scaleMargins: { top: 0.16, bottom: 0.16 } },
    timeScale: { borderVisible: false, timeVisible: false, rightOffset: 5, barSpacing: 9, minBarSpacing: 1.2 },
    crosshair: { mode: 0, vertLine: { visible: false, labelVisible: false }, horzLine: { labelVisible: false } },
  });
  candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: "#34d399", downColor: "#fb7185", borderVisible: false,
    wickUpColor: "#34d399", wickDownColor: "#fb7185", priceLineVisible: false,
  });
  const line = (color, width, style) => chart.addSeries(LightweightCharts.LineSeries, {
    color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false,
    crosshairMarkerVisible: false, autoscaleInfoProvider: () => null,
  });
  bandS = {
    sup: line("#34d399", 1, LightweightCharts.LineStyle.Dashed),
    mid: line("#94a3b8", 1, LightweightCharts.LineStyle.Solid),
    res: line("#fb7185", 1, LightweightCharts.LineStyle.Dashed),
  };
  markersApi = LightweightCharts.createSeriesMarkers(candleSeries, []);
  chartApi = chart;
}

async function selectSymbol(symbol, focusT) {
  const seq = ++state.drawSeq;
  state.selectedSymbol = symbol;
  state.focusT = focusT == null ? null : focusT;
  $("chartSym").textContent = symbol;
  $("chartState").textContent = "…";
  $("chartState").className = "chip";
  try {
    let own = state.charts.get(symbol);
    if (!own) {
      own = await candles(symbol, CHART_BARS, true);
      state.charts.set(symbol, own);
    }
    if (seq !== state.drawSeq) return;
    drawChart(symbol, own);
    setTimeout(() => { if (seq === state.drawSeq) drawChart(symbol, own); }, 120);
  } catch (e) {
    $("chartRange").textContent = "History unavailable for this market";
  }
}

function drawChart(symbol, c) {
  if (!chartApi || !c.length) return;
  const res = analyze(c);
  const settled = res.signals.map(s => settle(c, s));
  const focusIdx = state.focusT == null ? -1
    : settled.findIndex(s => Math.floor(s.t / 1000) === Math.floor(state.focusT));
  const focusSig = focusIdx >= 0 ? settled[focusIdx] : settled[settled.length - 1];

  candleSeries.setData(c.map(k => ({ time: Math.floor(k.t / 1000), open: k.o, high: k.h, low: k.l, close: k.c })));
  const pts = arr => arr.map((v, i) => ({ time: Math.floor(c[i].t / 1000), value: v })).filter(p => Number.isFinite(p.value));
  bandS.sup.setData(pts(res.sup));
  bandS.mid.setData(pts(res.mid));
  bandS.res.setData(pts(res.res));

  markersApi.setMarkers(settled.map(s => {
    const t = Math.floor(s.t / 1000);
    const isFocus = focusSig && Math.floor(focusSig.t / 1000) === t;
    const hit = s.outcome === "TP" ? { position: "aboveBar", shape: "arrowDown", color: "#60a5fa" }
      : { position: "belowBar", shape: "arrowUp", color: "#eab308" };
    return {
      time: t, position: hit.position, shape: hit.shape, color: hit.color,
      size: isFocus ? 2 : 1.2,
      text: isFocus ? (s.outcome === "TP" ? "TP" : "OPEN") : "",
    };
  }));

  for (const pl of priceLines) { try { candleSeries.removePriceLine(pl); } catch {} }
  priceLines = [];
  if (focusSig) {
    const add = (price, color, title, style) => {
      const pl = candleSeries.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
      priceLines.push(pl);
    };
    add(focusSig.tp, "#60a5fa", `TP ${pct((focusSig.tp / focusSig.entry - 1) * 100)}`, LightweightCharts.LineStyle.Dotted);
    add(focusSig.entry, "#94a3b8", "Entry", LightweightCharts.LineStyle.Solid);
  }

  const n = c.length, viewBars = 170;
  const ts = chartApi.timeScale();
  let from, to;
  if (focusSig && state.focusT != null) {
    let idx = c.findIndex(k => Math.floor(k.t / 1000) >= Math.floor(state.focusT));
    if (idx < 0) idx = n - 1;
    from = Math.max(0, idx - Math.round(viewBars * 0.62));
    to = Math.min(n + 6, Math.max(from + viewBars, idx + 26));
    if (to - from < viewBars) from = Math.max(0, to - viewBars);
  } else {
    from = Math.max(0, n + 6 - viewBars);
    to = n + 6;
  }
  ts.setVisibleLogicalRange({ from, to });

  const m = state.markets.find(x => x.symbol === symbol);
  const last = c[c.length - 1];
  $("chartPrice").textContent = fmt(m ? (m.price ?? last.c) : last.c);
  const chg = m ? m.change : null;
  $("chartChange").textContent = chg == null ? "" : pct(chg);
  $("chartChange").className = `num ${chg == null ? "" : chg >= 0 ? "up" : "down"}`;
  $("chartChange").style.color = chg == null ? "" : chg >= 0 ? "#34d399" : "#fb7185";
  if (focusSig) {
    $("chartState").className = `chip ${focusSig.outcome === "TP" ? "blue" : "amber"}`;
    $("chartState").textContent = focusSig.outcome === "TP" ? `TP hit in ${focusSig.days}d` : "Signal open";
  }
  const rankChip = $("chartRank");
  if (m && m.rank) { rankChip.hidden = false; rankChip.textContent = `#${m.rank} by volume`; } else rankChip.hidden = true;
  $("chartRange").textContent = `D1 · ${c.length} candles · ${dayKey(c[0].t)} → ${dayKey(last.t)}`;
  renderDrawings();
}

/* ============================================================================
   DRAWING TOOLS
   ============================================================================ */
const DRAW_KEY = "shahab-radar-drawings-v1";
const DRAW_COLOR = "#38bdf8", DRAW_LIME = "#a3e635", FIB_COLOR = "#a78bfa";
let drawings = {};
try { drawings = JSON.parse(localStorage.getItem(DRAW_KEY) || "{}") || {}; } catch { drawings = {}; }
let tool = "none", draft = null, drawCanvas = null, drawCtx = null, drawDpr = 1;

const TOOL_HINTS = {
  none: "Cursor: drag the chart. Pick a tool to draw. Drawings are saved per coin.",
  trend: "Trend line — drag from A to B.",
  ray: "Ray — drag from the start point, it extends to the right.",
  hline: "Horizontal line — click a price level.",
  vline: "Vertical line — click a date.",
  rect: "Rectangle — drag to box an area.",
  fib: "Fib retracement — drag from swing low to swing high (or the reverse).",
  text: "Text — click where the note should sit.",
  ruler: "Measure — drag to see the move in price and %.",
};

function saveDrawings() {
  try { localStorage.setItem(DRAW_KEY, JSON.stringify(drawings)); } catch {}
}
function shapesOf(symbol) {
  if (!symbol) return [];
  return drawings[symbol] || (drawings[symbol] = []);
}

function initDrawing() {
  drawCanvas = $("draw");
  drawCtx = drawCanvas.getContext("2d");
  const wrap = $("chartWrap");
  const resize = () => {
    const r = wrap.getBoundingClientRect();
    drawDpr = window.devicePixelRatio || 1;
    drawCanvas.width = Math.max(1, Math.round(r.width * drawDpr));
    drawCanvas.height = Math.max(1, Math.round(r.height * drawDpr));
    drawCanvas.style.width = `${r.width}px`;
    drawCanvas.style.height = `${r.height}px`;
    renderDrawings();
  };
  new ResizeObserver(resize).observe(wrap);
  resize();
  chartApi.timeScale().subscribeVisibleLogicalRangeChange(() => renderDrawings());

  const setTool = k => {
    tool = k; draft = null;
    document.querySelectorAll("#tools .tb[data-tool]").forEach(b => b.classList.toggle("on", b.dataset.tool === k));
    drawCanvas.classList.toggle("active", k !== "none");
    $("toolHint").textContent = TOOL_HINTS[k] || "";
    renderDrawings();
  };
  document.querySelectorAll("#tools .tb[data-tool]").forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $("undoDraw").onclick = () => { const arr = shapesOf(state.selectedSymbol); arr.pop(); saveDrawings(); renderDrawings(); };
  $("clearDraw").onclick = () => { if (state.selectedSymbol) drawings[state.selectedSymbol] = []; saveDrawings(); renderDrawings(); };

  const point = e => {
    const r = drawCanvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const p = candleSeries.coordinateToPrice(y);
    const t = chartApi.timeScale().coordinateToTime(x);
    return { x, y, p, t: t == null ? null : Number(t) };
  };

  drawCanvas.addEventListener("pointerdown", e => {
    if (tool === "none") return;
    const pt = point(e);
    drawCanvas.setPointerCapture(e.pointerId);
    if (tool === "hline" && Number.isFinite(pt.p)) { shapesOf(state.selectedSymbol).push({ type: "hline", p: pt.p }); saveDrawings(); renderDrawings(); return; }
    if (tool === "vline" && pt.t != null) { shapesOf(state.selectedSymbol).push({ type: "vline", t: pt.t }); saveDrawings(); renderDrawings(); return; }
    if (tool === "text") {
      const text = window.prompt("Text note");
      if (text && Number.isFinite(pt.p) && pt.t != null) { shapesOf(state.selectedSymbol).push({ type: "text", t: pt.t, p: pt.p, text }); saveDrawings(); renderDrawings(); }
      return;
    }
    if (!Number.isFinite(pt.p) || pt.t == null) return;
    draft = { type: tool, t1: pt.t, p1: pt.p, t2: pt.t, p2: pt.p };
  });

  drawCanvas.addEventListener("pointermove", e => {
    if (!draft) return;
    const pt = point(e);
    if (Number.isFinite(pt.p)) draft.p2 = pt.p;
    if (pt.t != null) draft.t2 = pt.t;
    renderDrawings();
  });

  const finish = () => {
    if (!draft) return;
    const moved = draft.t1 !== draft.t2 || draft.p1 !== draft.p2;
    if (moved) { shapesOf(state.selectedSymbol).push({ ...draft }); saveDrawings(); }
    draft = null;
    renderDrawings();
  };
  drawCanvas.addEventListener("pointerup", finish);
  drawCanvas.addEventListener("pointercancel", () => { draft = null; renderDrawings(); });
}

function xOf(t) { const x = chartApi.timeScale().timeToCoordinate(t); return x == null ? null : x; }
function yOf(p) { return candleSeries.priceToCoordinate(p); }

function drawShape(ctx, s, W, H) {
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = DRAW_COLOR;
  ctx.fillStyle = "rgba(56,189,248,.10)";
  ctx.font = "11px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.setLineDash([]);

  if (s.type === "hline") {
    const y = yOf(s.p); if (y == null) return;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    tag(ctx, W - 4, y, ` ${fmt(s.p)} `, DRAW_COLOR, "right");
    return;
  }
  if (s.type === "vline") {
    const x = xOf(s.t); if (x == null) return;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    return;
  }
  if (s.type === "text") {
    const x = xOf(s.t), y = yOf(s.p);
    if (x == null || y == null) return;
    ctx.fillStyle = "#e6e9ef";
    ctx.font = "600 12px Inter, ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(s.text, x + 6, y - 6);
    return;
  }

  const x1 = xOf(s.t1), x2 = xOf(s.t2), y1 = yOf(s.p1), y2 = yOf(s.p2);
  if (x1 == null || x2 == null || y1 == null || y2 == null) return;

  if (s.type === "rect") {
    ctx.beginPath();
    ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    ctx.fill(); ctx.stroke();
    return;
  }

  if (s.type === "fib") {
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    ctx.strokeStyle = FIB_COLOR;
    ctx.setLineDash([4, 3]);
    for (const lv of levels) {
      const price = s.p1 + (s.p2 - s.p1) * lv;
      const y = yOf(price);
      if (y == null) continue;
      ctx.beginPath(); ctx.moveTo(Math.min(x1, x2), y); ctx.lineTo(Math.max(x1, x2), y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = FIB_COLOR;
      ctx.fillText(`${lv.toFixed(3)}  ${fmt(price)}`, Math.max(x1, x2) + 6, y - 3);
      ctx.setLineDash([4, 3]);
    }
    ctx.setLineDash([]);
    return;
  }

  if (s.type === "ruler") {
    const dP = s.p2 - s.p1, dPct = s.p1 ? (dP / s.p1) * 100 : 0;
    const up = dPct >= 0;
    ctx.strokeStyle = up ? DRAW_LIME : "#fb7185";
    ctx.fillStyle = up ? "rgba(163,230,53,.13)" : "rgba(251,113,133,.13)";
    ctx.beginPath(); ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); ctx.fill();
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.setLineDash([]);
    const label = `${up ? "+" : ""}${dPct.toFixed(2)}%  ·  ${fmt(Math.abs(dP))}`;
    ctx.fillStyle = up ? DRAW_LIME : "#fb7185";
    tag(ctx, (x1 + x2) / 2, (y1 + y2) / 2, ` ${label} `, up ? DRAW_LIME : "#fb7185", "center");
    return;
  }

  /* trend + ray */
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  if (s.type === "ray") {
    const dx = x2 - x1;
    if (dx !== 0) { const k = (W - x2) / dx; if (k > 0) ctx.lineTo(x2 + dx * k, y2 + (y2 - y1) * k); }
  }
  ctx.stroke();
}

function tag(ctx, x, y, text, color, align) {
  ctx.font = "700 10.5px Inter, ui-sans-serif, system-ui, sans-serif";
  const w = ctx.measureText(text).width + 8;
  const bx = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(bx, y - 9, w, 16, 4) : ctx.rect(bx, y - 9, w, 16);
  ctx.fill();
  ctx.fillStyle = "#0a0f02";
  ctx.fillText(text.trim(), bx + 4, y + 2);
}

function renderDrawings() {
  if (!drawCtx || !chartApi) return;
  const W = drawCanvas.width / drawDpr, H = drawCanvas.height / drawDpr;
  drawCtx.setTransform(drawDpr, 0, 0, drawDpr, 0, 0);
  drawCtx.clearRect(0, 0, W, H);
  for (const s of shapesOf(state.selectedSymbol)) drawShape(drawCtx, s, W, H);
  if (draft) {
    drawCtx.save();
    drawCtx.globalAlpha = .85;
    drawShape(drawCtx, draft, W, H);
    if (draft.type !== "rect" && draft.type !== "ruler") {
      for (const pt of [[draft.t1, draft.p1], [draft.t2, draft.p2]]) {
        const x = xOf(pt[0]), y = yOf(pt[1]);
        if (x == null || y == null) continue;
        drawCtx.fillStyle = "#0a0d12"; drawCtx.strokeStyle = DRAW_COLOR;
        drawCtx.beginPath(); drawCtx.arc(x, y, 3.5, 0, Math.PI * 2); drawCtx.fill(); drawCtx.stroke();
      }
    }
    drawCtx.restore();
  }
}

/* ============================================================================
   REPORT — password 1213
   ============================================================================ */
const REPORT_PASSWORD = "1213";
const reportCache = new Map();
let lastReport = null;

function openAuth() {
  $("pwInput").value = ""; $("pwErr").hidden = true;
  $("authModal").hidden = false;
  setTimeout(() => $("pwInput").focus(), 40);
}
function closeAuth() { $("authModal").hidden = true; }
function unlock() {
  if ($("pwInput").value.trim() === REPORT_PASSWORD) {
    closeAuth();
    openReport();
  } else {
    $("pwErr").hidden = false;
    $("pwInput").value = "";
  }
}

function buildReportCoins() {
  const box = $("coinList");
  if (!box || box.dataset.built === "1") return;
  box.dataset.built = "1";
  const frag = document.createDocumentFragment();
  for (const m of state.markets) {
    const label = document.createElement("label");
    label.dataset.sym = m.symbol;
    label.innerHTML = `<input type="checkbox" value="${m.symbol}"> ${m.symbol}`;
    frag.appendChild(label);
  }
  box.innerHTML = "";
  box.appendChild(frag);
}

function yearsInit() {
  const now = new Date().getUTCFullYear();
  const from = $("fromYear"), to = $("toYear");
  if (from.options.length) return;
  for (let y = FIRST_YEAR; y <= now; y++) {
    from.add(new Option(String(y), String(y)));
    to.add(new Option(String(y), String(y)));
  }
  from.value = String(Math.max(FIRST_YEAR, now - 2));
  to.value = String(now);
}

function openReport() {
  yearsInit();
  buildReportCoins();
  $("reportModal").hidden = false;
}
function closeReport() { $("reportModal").hidden = true; }

function selectedCoins() {
  return Array.from(document.querySelectorAll("#coinList input:checked")).map(i => i.value);
}

/* Gate caps a candlestick request at 1000 points, so the full history is walked
   backwards in ~2.5 year windows until the market's first candle. */
const FIRST_YEAR = 2009;
const HISTORY_START = Math.floor(Date.UTC(FIRST_YEAR, 0, 1) / 1000);
const HISTORY_WINDOW = 900 * 86400;

async function historyCandles(pair, sinceMs) {
  const since = Math.max(HISTORY_START, Math.floor(sinceMs / 1000));
  const found = new Map();
  let end = Math.floor(Date.now() / 1000), empty = 0;
  for (let guard = 0; guard < 12 && end > since; guard++) {
    const start = Math.max(since, end - HISTORY_WINDOW);
    let rows = [];
    try {
      rows = await api("/api/v4/spot/candlesticks", {
        currency_pair: toPair(pair), interval: D1.iv, from: start, to: end,
      });
    } catch (e) { break; }
    const parsed = parse(rows, D1.ms);
    if (parsed.length) { empty = 0; for (const k of parsed) found.set(k.t, k); }
    else if (++empty >= 2) break;   // no older candles for this market
    end = start;
  }
  return [...found.values()].sort((a, b) => a.t - b.t);
}

async function coinSignals(symbol, fromMs) {
  const key = `${symbol}|${fromMs}`;
  if (reportCache.has(key)) return reportCache.get(key);
  const m = state.markets.find(x => x.symbol === symbol);
  /* 400 extra days before the range so the bands are warmed up at its start */
  const own = await historyCandles(m ? m.pair : symbol, fromMs - 400 * 864e5);
  const res = own.length > 2 * W + 10 ? analyze(own) : { signals: [] };
  const rows = res.signals.map(s => settle(own, s));
  reportCache.set(key, rows);
  return rows;
}

function reportStats(rows) {
  const hits = rows.filter(r => r.outcome === "TP");
  const signals = rows.length, tp = hits.length;
  const netPct = hits.reduce((a, r) => a + r.pnlPct, 0);
  return {
    signals, tp, open: signals - tp,
    tpRate: signals ? (tp / signals) * 100 : null,
    netPct, avgPct: tp ? netPct / tp : null,
  };
}

function reportTable(coins, range) {
  const head = `<thead><tr>
    <th>Coin</th><th>Signals</th><th>TP</th><th>Open</th>
    <th>TP rate</th><th>Net %</th><th>Avg % / TP</th></tr></thead>`;
  let total = { signals: 0, tp: 0, open: 0, netPct: 0 };
  const body = coins.map(c => {
    const st = reportStats(c.rows);
    total.signals += st.signals; total.tp += st.tp; total.open += st.open; total.netPct += st.netPct;
    return `<tr>
      <td><b>${c.symbol}</b></td>
      <td>${st.signals}</td>
      <td>${st.tp}</td>
      <td>${st.open}</td>
      <td>${st.tpRate == null ? "—" : st.tpRate.toFixed(1) + "%"}</td>
      <td class="${st.netPct >= 0 ? "pos" : "neg"}">${pct(st.netPct)}</td>
      <td>${st.avgPct == null ? "—" : pct(st.avgPct)}</td>
    </tr>`;
  }).join("");
  const tpRate = total.signals ? (total.tp / total.signals) * 100 : null;
  const foot = `<tfoot><tr>
      <td>All selected (${coins.length})</td>
      <td>${total.signals}</td><td>${total.tp}</td><td>${total.open}</td>
      <td>${tpRate == null ? "—" : tpRate.toFixed(1) + "%"}</td>
      <td class="${total.netPct >= 0 ? "pos" : "neg"}">${total.netPct >= 0 ? "+" : ""}${total.netPct.toFixed(2)}%</td>
      <td>${total.tp ? pct(total.netPct / total.tp) : "—"}</td>
    </tr></tfoot>`;
  return `<p class="report-note">Daily signals · ${range.from} → ${range.to} · TP = the move to the grey midline · net % sums every TP trade with equal weight. No stop loss.</p>
    <table>${head}<tbody>${body}</tbody>${foot}</table>`;
}

function reportText(coins, range, total) {
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  const lines = [];
  lines.push("SHAHAB RADAR — DAILY SIGNAL REPORT");
  lines.push(`Range: ${range.from} → ${range.to}`);
  lines.push(`Coins: ${coins.length}`);
  lines.push("");
  lines.push(pad("COIN", 12) + padL("SIGNALS", 9) + padL("TP", 6) + padL("OPEN", 6) + padL("TP%", 8) + padL("NET%", 10) + padL("AVG%", 9));
  lines.push("-".repeat(60));
  for (const c of coins) {
    const st = reportStats(c.rows);
    lines.push(
      pad(c.symbol, 12) + padL(st.signals, 9) + padL(st.tp, 6) + padL(st.open, 6) +
      padL(st.tpRate == null ? "-" : st.tpRate.toFixed(1), 8) +
      padL(st.netPct.toFixed(2), 10) + padL(st.avgPct == null ? "-" : st.avgPct.toFixed(2), 9)
    );
  }
  lines.push("-".repeat(60));
  lines.push(pad("TOTAL", 12) + padL(total.signals, 9) + padL(total.tp, 6) + padL(total.open, 6) +
    padL(total.tpRate == null ? "-" : total.tpRate.toFixed(1), 8) +
    padL(total.netPct.toFixed(2), 10) + padL(total.avgPct == null ? "-" : total.avgPct.toFixed(2), 9));
  lines.push("Exit rule: TP only (the grey midline). No stop loss.");
  lines.push("");
  lines.push(`Data source: Gate.io daily candles · generated ${new Date().toISOString().slice(0, 10)}`);
  return lines.join("\n");
}

async function runReport() {
  const coinsSel = selectedCoins();
  const from = Number($("fromYear").value), to = Number($("toYear").value);
  const fromMs = Date.UTC(Math.min(from, to), 0, 1) / 1000;
  const toMs = Date.UTC(Math.max(from, to) + 1, 0, 1) / 1000;
  if (!coinsSel.length) {
    $("reportBody").innerHTML = `<p class="report-note">Select at least one coin (or “All coins”).</p>`;
    return;
  }
  const body = $("reportBody");
  body.innerHTML = `<p class="report-note">Loading ${coinsSel.length} coin(s)…</p>`;
  $("runReport").disabled = true;
  state.reporting = true;
  setProgress(0, "Report: pausing the scan while history is loaded…");

  const queue = [...coinsSel];
  const out = [];
  let done = 0;
  const worker = async () => {
    for (;;) {
      const sym = queue.shift();
      if (!sym) return;
      try {
        const rows = (await coinSignals(sym, fromMs)).filter(r => r.t / 1000 >= fromMs && r.t / 1000 < toMs);
        out.push({ symbol: sym, rows });
      } catch (e) {
        out.push({ symbol: sym, rows: [] });
      }
      done++;
      $("reportProgress").textContent = `${done} / ${coinsSel.length}`;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  state.reporting = false;

  out.sort((a, b) => a.symbol.localeCompare(b.symbol));
  const range = { from: `${new Date(fromMs * 1000).getUTCFullYear()}`, to: `${new Date((toMs - 86400) * 1000).getUTCFullYear()}` };
  const total = out.reduce((acc, c) => {
    const st = reportStats(c.rows);
    acc.signals += st.signals; acc.tp += st.tp; acc.open += st.open; acc.netPct += st.netPct;
    return acc;
  }, { signals: 0, tp: 0, open: 0, netPct: 0 });
  total.tpRate = total.signals ? (total.tp / total.signals) * 100 : null;
  total.avgPct = total.tp ? total.netPct / total.tp : null;

  body.innerHTML = reportTable(out, range);
  $("reportText").textContent = reportText(out, range, total);
  $("reportProgress").textContent = "";
  $("runReport").disabled = false;
  lastReport = { out, range, total };
}

/* ============================================================================
   WIRING
   ============================================================================ */
function renderAll() {
  renderSignals();
  $("updated").textContent = state.total
    ? `Round ${state.round + 1} · ${Math.min(state.scannedRound, state.total)} of ${state.total} markets`
    : "—";
  if (!state.selectedSymbol && state.signals.length) {
    const newest = state.signals.slice().sort((a, b) => b.candleTime - a.candleTime)[0];
    selectSymbol(newest.symbol, newest.candleTime / 1000);
  }
}

function tickCountdown() {
  const ms = D1.ms - (Date.now() % D1.ms);
  const h = Math.floor(ms / 3600e3), mi = Math.floor((ms % 3600e3) / 60e3);
  $("countdown").textContent = `Next daily candle in ${h}h ${mi}m`;
}

$("refresh").onclick = async () => {
  state.done = false; state.cursor = 0; state.round = 0; state.scanned = 0; state.scannedRound = 0;
  state.charts.clear();
  setProgress(0, "Refreshing markets…");
  try { await loadUniverse(true); } catch (e) {}
  runRounds();
};
$("mode").onclick = async () => {
  state.strict = !state.strict;
  $("mode").textContent = `Quality: ${state.strict ? "High" : "All"}`;
  state.markets.forEach(m => { m.sig = null; });
  rebuildSignals();
  renderSignals();
  state.done = false;
  state.cursor = 0; state.round = 0; state.scannedRound = 0;
  saveCache();
  runRounds();
};

$("reportBtn").onclick = openAuth;
$("pwOk").onclick = unlock;
$("pwCancel").onclick = closeAuth;
$("pwInput").addEventListener("keydown", e => { if (e.key === "Enter") unlock(); });
$("reportClose").onclick = closeReport;
$("runReport").onclick = runReport;
$("pickAll").onclick = () => {
  document.querySelectorAll("#coinList input").forEach(i => { i.checked = true; });
};
$("pickNone").onclick = () => {
  document.querySelectorAll("#coinList input").forEach(i => { i.checked = false; });
};
$("coinSearch").oninput = () => {
  const q = $("coinSearch").value.trim().toUpperCase();
  document.querySelectorAll("#coinList label").forEach(l => {
    l.style.display = !q || l.dataset.sym.includes(q) ? "" : "none";
  });
};
$("printReport").onclick = () => window.print();
$("copyReport").onclick = async () => {
  const txt = $("reportText").textContent;
  if (!txt) return;
  try { await navigator.clipboard.writeText(txt); $("copyReport").textContent = "Copied"; setTimeout(() => $("copyReport").textContent = "Copy text", 1400); }
  catch { window.prompt("Copy the report:", txt); }
};

/* ---------- search, filters, sort, export ---------- */
$("sigSearch").oninput = () => { state.query = $("sigSearch").value; renderSignals(); };
$("sigFilter").onclick = e => {
  const b = e.target.closest("button[data-f]"); if (!b) return;
  state.filter = b.dataset.f;
  document.querySelectorAll("#sigFilter button").forEach(x => x.classList.toggle("on", x === b));
  renderSignals();
};
$("sigSort").onchange = () => { state.sort = $("sigSort").value; renderSignals(); };
$("exportCsv").onclick = () => {
  const rows = visibleSignals();
  if (!rows.length) { toast("Nothing to export"); return; }
  const head = ["symbol", "rank", "signal_date", "entry", "tp", "tp_pct", "outcome", "days", "pnl_pct"];
  const body = rows.map(x => [
    x.symbol, x.rank || "", new Date(x.candleTime).toISOString().slice(0, 10),
    x.entry, x.tp, tpPctOf(x).toFixed(2), x.outcome,
    x.outcome === "TP" ? x.days : "", Number.isFinite(x.pnlPct) ? x.pnlPct.toFixed(2) : "",
  ].join(","));
  const url = URL.createObjectURL(new Blob([[head.join(",")].concat(body).join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `shahab-radar-signals-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`${rows.length} signals exported`);
};
document.addEventListener("keydown", e => {
  if (e.key === "/" && document.activeElement !== $("sigSearch")) { e.preventDefault(); $("sigSearch").focus(); }
  if (e.key === "Escape" && document.activeElement === $("sigSearch")) $("sigSearch").blur();
});

/* ============================================================================
   ENHANCEMENTS — alerts, sound, chart overlays, per-coin stats, sharing
   ============================================================================ */
const ENH_CSS = `
  .chart-card.fs{position:fixed;inset:0;z-index:75;border-radius:0;border:0;overflow:auto;background:#0a0d12}
  .chart-card.fs #chart{height:calc(100dvh - 190px)}
  .insight{display:flex;flex-wrap:wrap;gap:8px 16px;padding:10px 18px;border-top:1px solid var(--line);
    font-size:11px;color:var(--muted);background:rgba(255,255,255,.015)}
  .insight b{color:#f1f4f8;font-weight:700}
  .insight .up{color:var(--up)}
  .bell{border:0;background:transparent;color:#5b6572;font-size:12px;line-height:1;padding:2px 3px;border-radius:6px;transition:.15s}
  .bell:hover{color:#fcd34d;background:rgba(251,191,36,.12)}
  .bell.on{color:#fbbf24;text-shadow:0 0 10px rgba(251,191,36,.7)}
  .iconbtn{border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--ink-2);border-radius:9px;
    font-size:11.5px;font-weight:700;padding:5px 9px;transition:.15s}
  .iconbtn:hover{color:#fff;border-color:rgba(255,255,255,.22)}
  .iconbtn.on{background:linear-gradient(135deg,#e2ff7a,#a3e635);color:#0a0f02;border-color:rgba(200,247,81,.7)}
  .share{display:inline-flex;gap:6px;align-items:center}
`;
(function injectEnhCss() { const st = document.createElement("style"); st.textContent = ENH_CSS; document.head.appendChild(st); })();

const NOTIFY_KEY = "shahab-radar-notify-v1", ALERT_KEY = "shahab-radar-alerts-v1", PREF_KEY = "shahab-radar-view-v1";
let notifyOn = false, soundOn = false, alerts = {};
try { notifyOn = localStorage.getItem(NOTIFY_KEY) === "1"; } catch {}
try { alerts = JSON.parse(localStorage.getItem(ALERT_KEY) || "{}") || {}; } catch { alerts = {}; }

function saveAlerts() { try { localStorage.setItem(ALERT_KEY, JSON.stringify(alerts)); } catch {} }
function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify({ filter: state.filter, sort: state.sort })); } catch {} }

/* short two-tone chime for new signals and alerts */
let audioCtx = null;
function chime() {
  if (!soundOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    [880, 1174].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.16);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + i * 0.16 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.16 + 0.3);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t0 + i * 0.16); o.stop(t0 + i * 0.16 + 0.32);
    });
  } catch (e) {}
}
function notify(title, body) {
  if (!notifyOn) return;
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    new Notification(title, { body, icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='9' fill='none' stroke='%23a3e635' stroke-width='2'/%3E%3C/svg%3E" });
  } catch (e) {}
}

/* ---------- header alerts toggle ---------- */
const actions = document.querySelector(".top .actions");
if (actions) {
  const bellBtn = document.createElement("button");
  bellBtn.className = `btn${notifyOn ? " primary" : ""}`;
  bellBtn.id = "notifyBtn";
  bellBtn.title = "Alerts for new signals";
  bellBtn.textContent = notifyOn ? "🔔 On" : "🔔";
  bellBtn.onclick = async () => {
    if (!notifyOn) {
      let perm = "granted";
      try { if ("Notification" in window) perm = await Notification.requestPermission(); } catch {}
      notifyOn = perm === "granted";
      soundOn = true;
      if (!notifyOn) toast("Notifications blocked — sound alerts only");
    } else { notifyOn = false; soundOn = false; }
    try { localStorage.setItem(NOTIFY_KEY, notifyOn ? "1" : "0"); } catch {}
    bellBtn.textContent = notifyOn ? "🔔 On" : "🔔";
    bellBtn.className = `btn${notifyOn ? " primary" : ""}`;
    if (notifyOn) { chime(); toast("Alerts on — you will hear and see new signals"); }
  };
  actions.insertBefore(bellBtn, actions.querySelector("#refresh"));
}

/* ---------- per-coin price alerts ---------- */
function setAlert(sym) {
  const m = marketOf(sym);
  const cur = m && Number.isFinite(m.price) ? m.price : null;
  const raw = window.prompt(`Price alert for ${sym}${cur ? ` (now ${fmt(cur)})` : ""}\nNotify me when the price goes above:`, alerts[sym] ?? "");
  if (raw === null) return;
  const val = Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(val) || val <= 0) {
    if (String(raw).trim() === "" && alerts[sym] != null) { delete alerts[sym]; saveAlerts(); renderSignals(); toast(`Alert removed for ${sym}`); }
    return;
  }
  alerts[sym] = val; saveAlerts(); renderSignals();
  toast(`Alert set · ${sym} above ${fmt(val)}`);
}
function checkAlerts() {
  const hit = [];
  for (const [sym, target] of Object.entries(alerts)) {
    const m = marketOf(sym);
    if (!m || !Number.isFinite(m.price)) continue;
    if (m.price >= target) { hit.push(`${sym} ${fmt(m.price)}`); delete alerts[sym]; }
  }
  if (hit.length) { saveAlerts(); renderSignals(); toast(`Alert: ${hit.join(" · ")} reached`); notify("Price alert", hit.join(" · ")); chime(); }
}

/* ---------- per-coin summary under the chart ---------- */
function renderInsight(symbol, c) {
  const box = document.getElementById("insight");
  if (!box) return;
  if (!symbol || !c || !c.length) { box.textContent = ""; return; }
  const rows = analyze(c).signals.map(x => settle(c, x));
  const tp = rows.filter(r => r.outcome === "TP");
  const rate = rows.length ? (tp.length / rows.length) * 100 : null;
  const avg = tp.length ? tp.reduce((a, r) => a + r.pnlPct, 0) / tp.length : null;
  const best = rows.length ? Math.max(...rows.map(r => r.pnlPct)) : null;
  const last = rows.length ? rows[rows.length - 1] : null;
  const m = marketOf(symbol);
  box.innerHTML = [
    `<span>History <b>${rows.length}</b> signals</span>`,
    `<span>TP <b class="up">${tp.length}</b>${rate == null ? "" : ` · <b class="up">${rate.toFixed(0)}%</b>`}</span>`,
    `<span>Avg gain / TP <b class="up">${avg == null ? "—" : pct(avg)}</b></span>`,
    `<span>Best <b>${best == null ? "—" : pct(best)}</b></span>`,
    `<span>Last signal <b>${last ? dayKey(last.t) : "—"}</b></span>`,
    m && Number.isFinite(m.volume) ? `<span>24h volume <b>$${fmt(m.volume)}</b></span>` : "",
  ].filter(Boolean).join("");
}

/* ---------- chart overlays: volume, EMA, log scale, fullscreen ---------- */
let volSeries = null, emaSeries = {}, emaOn = false, logOn = false;
function enhBuildOverlays() {
  if (!chartApi || volSeries) return;
  volSeries = chartApi.addSeries(LightweightCharts.HistogramSeries, {
    priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false,
  }, 1);
  chartApi.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  ["20", "50", "200"].forEach((n, i) => {
    emaSeries[n] = chartApi.addSeries(LightweightCharts.LineSeries, {
      color: ["#c8f751", "#60a5fa", "#fb7185"][i], lineWidth: 1, priceLineVisible: false,
      lastValueVisible: false, crosshairMarkerVisible: false, visible: false,
    });
  });
}
function ema(vals, n) {
  const k = 2 / (n + 1), out = [];
  let prev = null;
  vals.forEach((v, i) => { prev = i === 0 ? v : v * k + prev * (1 - k); out.push(prev); });
  return out;
}
function enhDrawOverlays(c) {
  enhBuildOverlays();
  if (!volSeries) return;
  volSeries.setData(c.map(k => ({ time: Math.floor(k.t / 1000), value: k.v, color: k.c >= k.o ? "rgba(52,211,153,.35)" : "rgba(251,113,133,.35)" })));
  const closes = c.map(k => k.c);
  for (const n of ["20", "50", "200"]) {
    const e = ema(closes, Number(n));
    emaSeries[n].setData(c.map((k, i) => ({ time: Math.floor(k.t / 1000), value: e[i] })));
    emaSeries[n].applyOptions({ visible: emaOn });
  }
  chartApi.priceScale("right").applyOptions({ mode: logOn ? 1 : 0 });
}

(function chartTools() {
  const bar = document.getElementById("tools");
  if (!bar) return;
  const mk = (label, title, fn) => {
    const b = document.createElement("button");
    b.className = "tb"; b.textContent = label; b.title = title;
    b.onclick = () => fn(b); return b;
  };
  const sep = document.createElement("span"); sep.className = "sep";
  const emaBtn = mk("EMA", "Exponential moving averages 20 / 50 / 200", b => {
    emaOn = !emaOn; b.classList.toggle("on", emaOn);
    for (const n of ["20", "50", "200"]) emaSeries[n] && emaSeries[n].applyOptions({ visible: emaOn });
  });
  const volBtn = mk("VOL", "Show / hide the volume bars", b => {
    const on = !volSeries || !volSeries.options().visible;
    if (volSeries) volSeries.applyOptions({ visible: on });
    b.classList.toggle("on", !!on);
  });
  const logBtn = mk("LOG", "Logarithmic price scale", b => {
    logOn = !logOn; b.classList.toggle("on", logOn);
    chartApi.priceScale("right").applyOptions({ mode: logOn ? 1 : 0 });
  });
  const fsBtn = mk("⛶", "Fullscreen chart (F)", () => {
    document.querySelector(".chart-card").classList.toggle("fs");
    setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
  });
  bar.appendChild(sep);
  [emaBtn, volBtn, logBtn, fsBtn].forEach(b => bar.appendChild(b));
})();

(function insightStrip() {
  const card = document.querySelector(".chart-card");
  if (!card) return;
  const d = document.createElement("div");
  d.className = "insight"; d.id = "insight";
  card.appendChild(d);
})();

/* ---------- star + share on the chart header ---------- */
(function chartHeaderExtras() {
  const head = document.querySelector(".chart-card .card-head");
  if (!head) return;
  const wrap = document.createElement("span");
  wrap.className = "share";
  const star = document.createElement("button");
  star.className = "iconbtn"; star.id = "chartStar"; star.textContent = "★"; star.title = "Watch this coin";
  star.onclick = () => { if (state.selectedSymbol) { toggleWatch(state.selectedSymbol); syncChartStar(); } };
  const share = document.createElement("button");
  share.className = "iconbtn"; share.textContent = "🔗"; share.title = "Copy a link to this coin";
  share.onclick = async () => {
    const url = `${location.origin}${location.pathname}?coin=${state.selectedSymbol || ""}`;
    try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { window.prompt("Copy link:", url); }
  };
  wrap.appendChild(star); wrap.appendChild(share);
  head.appendChild(wrap);
})();
function syncChartStar() {
  const b = document.getElementById("chartStar");
  if (b) b.classList.toggle("on", state.watch.has(state.selectedSymbol));
}

/* ---------- report: csv ---------- */
(function reportCsv() {
  const head = document.querySelector("#reportModal .modal-head > div");
  if (!head) return;
  const csvBtn = document.createElement("button");
  csvBtn.className = "btn small"; csvBtn.textContent = "CSV";
  csvBtn.onclick = () => {
    if (!lastReport || !lastReport.out.length) { toast("Run the report first"); return; }
    const lines = ["coin,signals,tp,open,tp_rate,net_pct,avg_pct"];
    for (const c of lastReport.out) {
      const st = reportStats(c.rows);
      lines.push([c.symbol, st.signals, st.tp, st.open,
        st.tpRate == null ? "" : st.tpRate.toFixed(1),
        st.netPct.toFixed(2), st.avgPct == null ? "" : st.avgPct.toFixed(2)].join(","));
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `shahab-radar-report-${lastReport.range.from}-${lastReport.range.to}.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast("Report exported");
  };
  head.appendChild(csvBtn);
})();

/* ---------- wrap the originals ---------- */
const _drawChart = drawChart;
drawChart = function (symbol, c) {
  _drawChart(symbol, c);
  try { enhDrawOverlays(c); renderInsight(symbol, c); syncChartStar(); } catch (e) {}
};
const _selectSymbol = selectSymbol;
selectSymbol = async function (symbol, focusT) {
  await _selectSymbol(symbol, focusT);
  try {
    history.replaceState(null, "", `${location.pathname}?coin=${encodeURIComponent(symbol)}`);
    syncChartStar();
  } catch (e) {}
};
const _refreshPrices = refreshPrices;
refreshPrices = async function () {
  await _refreshPrices();
  try { checkAlerts(); $("updated").textContent = `Updated ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`; } catch (e) {}
};
const _runRounds = runRounds;
runRounds = async function () {
  const before = new Set(state.signals.map(x => x.id));
  await _runRounds();
  try {
    const added = state.signals.filter(x => !before.has(x.id));
    if (added.length) { chime(); notify(`${added.length} new daily signal${added.length > 1 ? "s" : ""}`, added.map(x => x.symbol).slice(0, 6).join(", ")); }
  } catch (e) {}
};

/* ---------- keyboard ---------- */
document.addEventListener("keydown", e => {
  if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
  if (e.key === "f" || e.key === "F") {
    document.querySelector(".chart-card").classList.toggle("fs");
    setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
  }
  if (e.key === "Escape") {
    const card = document.querySelector(".chart-card");
    if (card.classList.contains("fs")) { card.classList.remove("fs"); setTimeout(() => window.dispatchEvent(new Event("resize")), 60); }
  }
});

/* ---------- restore view prefs + deep link ---------- */
try {
  const p = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
  if (p && p.filter) {
    state.filter = p.filter;
    document.querySelectorAll("#sigFilter button").forEach(b => b.classList.toggle("on", b.dataset.f === p.filter));
  }
  if (p && p.sort) { state.sort = p.sort; $("sigSort").value = p.sort; }
} catch {}
const _renderSignals = renderSignals;
renderSignals = function () { _renderSignals(); try { savePrefs(); } catch (e) {} };

(function deepLink() {
  const sym = new URLSearchParams(location.search).get("coin");
  const start = () => {
    if (sym && state.markets.some(m => m.symbol === sym.toUpperCase())) {
      selectSymbol(sym.toUpperCase(), null);
      $("chartSym").scrollIntoView({ behavior: "smooth", block: "center" });
    } else renderSignals();
  };
  setTimeout(start, sym ? 900 : 400);
})();

window.__radar = { state, candles, historyCandles, coinSignals, toPair, analyze, settle, scanSlice, loadUniverse, saveCache, runRounds, refreshPrices, renderSignals, drawings };

(async function boot() {
  initChart();
  initDrawing();
  state.watch = loadWatch();
  tickCountdown();
  try {
    await loadUniverse(false);
  } catch (e) {
    paintStatus("Connection error", "warn");
    setProgress(0, "Could not reach Gate.io — try Refresh.");
  }
  if (state.done) {
    paintStatus("Saved", "live");
    setProgress(1, `All ${state.total} markets checked · ${state.signals.length} signals saved`);
    saveCache();
  } else {
    setProgress(state.scanned / Math.max(1, state.total), `Resuming · ${state.scanned} of ${state.total} markets`);
    runRounds();
  }
  state.lastIds = new Set(state.signals.map(x => x.id));
  setTimeout(refreshPrices, 6000);
  setInterval(refreshPrices, 60_000);
  setInterval(tickCountdown, 30_000);
  setInterval(() => { renderSignals(); }, 45_000);
})();
