"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { activeWindowMs, type MarketMetaPublic, type PublicSignal, type Timeframe } from "@/lib/shared";
import { audioRunning, playAlert, unlockAudio } from "@/lib/audio";
import {
  enableNotifications,
  permission,
  registerSW,
  showSignalNotification,
  subscribePush,
  type Perm,
} from "@/lib/client-notify";
import { usePrefs, useRadarStream } from "@/lib/use-radar";
import SignalStrip from "./SignalStrip";
import SignalTimeframePanel from "./SignalTimeframePanel";
import MarketList from "./MarketList";
import ChartPanel, { type ChartHeader } from "./ChartPanel";
import StatusBar from "./StatusBar";
import ControlsPanel from "./ControlsPanel";
import HistoryPanel from "./HistoryPanel";
import { Btn } from "./ui";

const TITLE = "Shahab Radar - سیگنال ترید";

function flashTitle(text: string) {
  document.title = text;
  const reset = () => {
    document.title = TITLE;
  };
  window.addEventListener("focus", reset, { once: true });
  setTimeout(reset, 30_000);
}

function ack(signalId: string, channel: "sound" | "desktop") {
  fetch("/api/notifications", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signalId, channel }),
    keepalive: true,
  }).catch(() => {});
}

interface Selection {
  symbol: string;
  tf: Timeframe;
  signal: PublicSignal | null;
  nonce: number;
}

export default function Radar() {
  const [prefs, setPrefs] = usePrefs();
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  const [markets, setMarkets] = useState<MarketMetaPublic[]>([]);
  const [sel, setSel] = useState<Selection>({ symbol: "BTC", tf: "15m", signal: null, nonce: 0 });
  const [search, setSearch] = useState("");
  const [onlyLong, setOnlyLong] = useState(false);
  const [panel, setPanel] = useState<null | "controls" | "history">(null);
  const [audioOk, setAudioOk] = useState(false);
  const [perm, setPerm] = useState<Perm | null>(null);
  const [scanning, setScanning] = useState(false);
  const [now, setNow] = useState(0);
  const chartAnchor = useRef<HTMLElement>(null);

  // ---- immediate alert: sound + desktop notification + title flash ---------------------
  const handleAlert = useCallback((s: PublicSignal) => {
    const p = prefsRef.current;
    if (p.soundOn && playAlert(p.soundId, p.volume)) ack(s.id, "sound");
    if (p.desktopOn && permission() === "granted") {
      void showSignalNotification(s).then((ok) => ok && ack(s.id, "desktop"));
    }
    flashTitle(`● LONG ${s.symbol} ${s.timeframe}`);
  }, []);

  const { snapshot, signals, online } = useRadarStream(handleAlert);

  // clock for relative states (LONG window / NEW badge)
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (snapshot) setNow(Date.now());
  }, [snapshot]);

  // ---- monitored universe (re-fetched when the Top-50 changes) ---------------------------
  const version = snapshot?.version ?? 0;
  useEffect(() => {
    let stop = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const r = await fetch("/api/markets/top50", { cache: "no-store" });
        if (r.ok) {
          const d = (await r.json()) as { items: MarketMetaPublic[] };
          if (!stop && d.items?.length) {
            setMarkets(d.items);
            return;
          }
        }
      } catch {
        /* retry */
      }
      if (!stop) t = setTimeout(run, 3000);
    };
    void run();
    return () => {
      stop = true;
      if (t) clearTimeout(t);
    };
  }, [version]);

  useEffect(() => {
    if (markets.length && !sel.signal && !markets.some((m) => m.symbol === sel.symbol)) {
      setSel((s) => ({ ...s, symbol: markets[0].symbol }));
    }
  }, [markets, sel.signal, sel.symbol]);

  // ---- audio: unlock on the first meaningful interaction -------------------------------
  useEffect(() => {
    setAudioOk(audioRunning());
    const events = ["pointerup", "touchend", "click", "keydown"] as const;
    const remove = () => events.forEach((e) => window.removeEventListener(e, handler, true));
    const handler = () => {
      void unlockAudio().then((ok) => {
        setAudioOk(ok);
        if (ok) remove();
      });
    };
    events.forEach((e) => window.addEventListener(e, handler, { capture: true, passive: true }));
    return remove;
  }, []);

  // ---- notifications: service worker + silent re-subscribe if already granted -----------
  useEffect(() => {
    const p = permission();
    setPerm(p);
    void registerSW();
    if (p === "granted") void subscribePush();
  }, []);

  const unlock = useCallback(async () => {
    const ok = await unlockAudio();
    setAudioOk(ok);
    return ok;
  }, []);

  const enableNotif = useCallback(async () => {
    const r = await enableNotifications();
    setPerm(r.permission);
  }, []);

  // ---- selection --------------------------------------------------------------------------
  const scrollToChart = () => {
    if (window.innerWidth < 1024) chartAnchor.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openSignal = useCallback((s: PublicSignal) => {
    setSel((p) => ({ symbol: s.symbol, tf: s.timeframe, signal: s, nonce: p.nonce + 1 }));
    if (window.innerWidth < 1024) chartAnchor.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const selectMarket = useCallback((symbol: string, tf?: Timeframe) => {
    setSel((p) => ({ symbol, tf: tf ?? p.tf, signal: null, nonce: p.nonce }));
    if (window.innerWidth < 1024) chartAnchor.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // open a signal from a push notification (?signal=ID or service-worker message)
  useEffect(() => {
    const open = async (id: string) => {
      try {
        const r = await fetch(`/api/signals/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (r.ok) openSignal((await r.json()) as PublicSignal);
      } catch {
        /* ignore */
      }
    };
    const id = new URLSearchParams(window.location.search).get("signal");
    if (id) {
      void open(id);
      window.history.replaceState(null, "", "/");
    }
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "open-signal" && e.data.id) void open(String(e.data.id));
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, [openSignal]);

  const scanNow = async () => {
    setScanning(true);
    try {
      await fetch("/api/scan", { method: "POST" });
    } catch {
      /* ignore */
    } finally {
      setTimeout(() => setScanning(false), 700);
    }
  };

  // ---- derived header for the chart -------------------------------------------------------
  const meta = markets.find((m) => m.symbol === sel.symbol);
  const tick = snapshot?.ticks[sel.symbol];
  const last = snapshot?.last[sel.symbol]?.[sel.tf];
  const header: ChartHeader = {
    symbol: sel.symbol,
    name: meta?.name ?? sel.signal?.name ?? "",
    price: tick?.[0] ?? null,
    change: tick?.[1] ?? null,
    state: last && now - last[0] <= activeWindowMs(sel.tf) ? "LONG" : "WAIT",
    stale: snapshot?.status.stale ?? true,
  };
  const symbols = markets.map((m) => m.symbol);
  const live = online && snapshot?.status.feed === "connected" && !snapshot.status.stale;

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <header className="flex items-center gap-2 border-b border-line bg-white px-3 py-2">
        <div className="flex items-center gap-2" dir="ltr">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#111214]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="#a3e635" strokeWidth="1.6" opacity="0.55" />
              <circle cx="12" cy="12" r="4.5" stroke="#a3e635" strokeWidth="1.6" opacity="0.8" />
              <path d="M12 12 L19 6" stroke="#a3e635" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="12" r="1.6" fill="#a3e635" />
            </svg>
          </span>
          <span className="font-tech whitespace-nowrap text-[17px] font-bold tracking-tight text-[#0b0b0c]">
            Shahab <span className="text-lime-600">Radar</span>
          </span>
        </div>
        <span
          className={`ms-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            live ? "bg-cyan-50 text-cyan-700" : "bg-amber-50 text-amber-700"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-cyan-500" : "bg-amber-500"}`} />
          {live ? "زنده" : online ? "داده کهنه" : "قطع"}
        </span>
        <div className="ms-auto flex items-center gap-1.5">
          {!audioOk && (
            <Btn variant="lime" onClick={() => void unlock().then((ok) => ok && playAlert(prefs.soundId, prefs.volume))}>
              <span className="hidden sm:inline">فعال‌سازی صدای هشدار</span>
              <span className="sm:hidden">صدا</span>
            </Btn>
          )}
          {perm === "default" && (
            <Btn variant="black" onClick={() => void enableNotif()}>
              <span className="hidden sm:inline">فعال‌سازی اعلان‌ها</span>
              <span className="sm:hidden">اعلان</span>
            </Btn>
          )}
          <Btn onClick={() => setPanel("controls")} title="صدا و اعلان‌ها">
            <span className={`h-2 w-2 rounded-full ${audioOk && prefs.soundOn ? "bg-lime-500" : "bg-gray-300"}`} />
            <span className="hidden sm:inline">صدا و اعلان‌ها</span>
            <span className="sm:hidden">تنظیم</span>
          </Btn>
          <Btn onClick={() => setPanel("history")}>تاریخچه</Btn>
        </div>
      </header>

      <SignalTimeframePanel onOpen={openSignal} />
      <SignalStrip signals={signals} selectedId={sel.signal?.id ?? null} now={now} onOpen={openSignal} />

      <main className="flex min-h-0 flex-1 flex-col gap-2.5 p-2.5">
        <aside className="order-2 flex h-[380px] w-full shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
          <div className="space-y-2.5 border-b border-line bg-[#fbfcfd] p-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-extrabold text-[#1f2328]">جستجو و انتخاب ارز</h2>
              <span className="num text-[11px] text-gray-400">{markets.length} بازار</span>
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جستجوی ارز…"
              className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-[14px] outline-none transition-shadow placeholder:text-gray-400 focus:border-lime-500 focus:ring-2 focus:ring-lime-100"
              aria-label="جستجو"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOnlyLong((v) => !v)}
                aria-pressed={onlyLong}
                className={`num h-9 rounded-lg border px-3 text-[13px] font-semibold transition-colors ${
                  onlyLong ? "border-lime-400 bg-lime-400 text-black" : "border-line bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                فقط LONG
              </button>
              <Btn variant="black" onClick={() => void scanNow()} disabled={scanning} className="h-9 flex-1">
                {scanning ? "در حال اسکن…" : "اسکن فوری"}
              </Btn>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <MarketList
              markets={markets}
              snapshot={snapshot}
              tf={sel.tf}
              selected={sel.symbol}
              search={search}
              onlyLong={onlyLong}
              now={now}
              onSelect={selectMarket}
            />
          </div>
        </aside>

        <section
          ref={chartAnchor}
          className="order-1 h-[68dvh] min-h-[420px] w-full scroll-mt-2"
        >
          <ChartPanel
            header={header}
            symbols={symbols}
            tf={sel.tf}
            signal={sel.signal}
            nonce={sel.nonce}
            liveSignals={signals}
            onTf={(tf) => {
              setSel((p) => ({ ...p, tf, signal: p.signal && p.signal.timeframe === tf ? p.signal : null }));
              scrollToChart();
            }}
            onSymbol={(s) => selectMarket(s)}
          />
        </section>
      </main>

      <StatusBar status={snapshot?.status ?? null} online={online} />

      {panel === "controls" && (
        <ControlsPanel
          prefs={prefs}
          setPrefs={setPrefs}
          audioOk={audioOk}
          onUnlockAudio={unlock}
          perm={perm}
          onEnableNotifications={enableNotif}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "history" && <HistoryPanel symbols={symbols} onOpen={openSignal} onClose={() => setPanel(null)} />}
    </div>
  );
}
