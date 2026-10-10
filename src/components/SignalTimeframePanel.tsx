"use client";
import { useEffect, useMemo, useState } from "react";
import type { ChartTradeFocus, PublicSignal, Snapshot } from "@/lib/shared";

type LiveTrade = ChartTradeFocus & { rank: number };
const price = (value: number) => new Intl.NumberFormat("en-US", { maximumSignificantDigits: 8 }).format(value);
const outcomeText = { TAKE_PROFIT_25: "TP شد", STOP_LOSS_25: "استاپ شد", OPEN: "در حال معامله", AMBIGUOUS: "مبهم" } as const;
const outcomeClass = (outcome: LiveTrade["exitReason"]) => outcome === "TAKE_PROFIT_25" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : outcome === "STOP_LOSS_25" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-700";

export default function SignalTimeframePanel({ liveSignals, snapshot, onOpenTrade }: { liveSignals: PublicSignal[]; snapshot: Snapshot | null; onOpenTrade: (trade: ChartTradeFocus) => void }) {
  const [storedSignals, setStoredSignals] = useState<PublicSignal[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/signals?limit=100&order=desc", { cache: "no-store" })
      .then((r) => r.ok ? r.json() as Promise<{ items?: PublicSignal[] }> : Promise.reject(new Error(String(r.status))))
      .then((data) => { if (!cancelled) setStoredSignals(data.items ?? []); })
      .catch(() => { if (!cancelled) setStoredSignals([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const signals = useMemo(() => {
    const map = new Map<string, PublicSignal>();
    for (const signal of [...storedSignals, ...liveSignals]) map.set(signal.id, signal);
    return [...map.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
  }, [storedSignals, liveSignals]);
  const now = Date.now();
  const items: LiveTrade[] = signals.map((signal) => {
    const takeProfit = signal.midline > signal.price ? signal.midline : signal.price * 1.25;
    const stopLoss = signal.price * 0.75;
    const current = snapshot?.ticks[signal.symbol]?.[0] ?? signal.price;
    const exitReason = current >= takeProfit ? "TAKE_PROFIT_25" : current <= stopLoss ? "STOP_LOSS_25" : "OPEN";
    return { id: signal.id, symbol: signal.symbol, rank: signal.rank, entryTime: signal.signalTime, entryPrice: signal.price, takeProfit, stopLoss, exitTime: exitReason === "OPEN" ? null : now, exitPrice: exitReason === "OPEN" ? null : current, exitReason };
  });
  return (
    <section aria-label="اسکن زنده سیگنال‌های ۱۰۰ ارز" className="border-b border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-[13px] font-extrabold">اسکن لحظه‌ای سیگنال‌های ۱۰۰ ارز</h2><span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-bold text-cyan-700">استریم زنده · 1D</span><span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">سیگنال‌ها به‌ترتیب تکمیل اسکن اضافه می‌شوند</span><span className="num ms-auto text-[10px] text-slate-500">{loading ? "در حال دریافت سیگنال‌ها…" : `${items.length} سیگنال`}</span></div>
      <div className="thin-scroll mt-2 flex min-h-[54px] gap-2 overflow-x-auto pb-1">
        {items.length === 0 && <p className="py-2 text-[12px] text-slate-500">در حال دریافت فهرست سیگنال‌ها از دیتابیس و اسکن زنده…</p>}
        {items.map((item) => <button key={item.id} type="button" onClick={() => onOpenTrade(item)} className="min-w-[230px] shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-start shadow-[0_2px_8px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-cyan-300 hover:bg-cyan-50"><div className="flex items-center justify-between gap-2"><span className="num text-[14px] font-extrabold">{item.symbol}</span><span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${outcomeClass(item.exitReason)}`}>{outcomeText[item.exitReason]}</span></div><div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-500"><span>ورود {price(item.entryPrice)}</span><span>رتبه #{item.rank}</span></div><div className="num mt-1 grid grid-cols-2 gap-1 text-[10px]"><span className="text-sky-700">TP {price(item.takeProfit)}</span><span className="text-rose-700">SL {price(item.stopLoss)}</span></div></button>)}
      </div>
    </section>
  );
}
