"use client";
import type { ChartTradeFocus, PublicSignal } from "@/lib/shared";

type LiveTrade = ChartTradeFocus & { rank: number; signalTime: number };
const price = (value: number) => new Intl.NumberFormat("en-US", { maximumSignificantDigits: 8 }).format(value);

export default function SignalTimeframePanel({ liveSignals, onOpenTrade }: { liveSignals: PublicSignal[]; onOpenTrade: (trade: ChartTradeFocus) => void }) {
  const items: LiveTrade[] = liveSignals.slice(0, 100).map((signal) => ({
    id: signal.id,
    symbol: signal.symbol,
    rank: signal.rank,
    signalTime: signal.signalTime,
    entryTime: signal.signalTime,
    entryPrice: signal.price,
    takeProfit: signal.price * 1.25,
    stopLoss: signal.price * 0.75,
    exitTime: null,
    exitPrice: null,
    exitReason: "OPEN",
  }));
  return (
    <section aria-label="اسکن زنده سیگنال‌های ۱۰۰ ارز" className="border-b border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-extrabold">اسکن لحظه‌ای سیگنال‌های ۱۰۰ ارز</h2>
        <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-bold text-cyan-700">استریم زنده · 1D</span>
        <span className="rounded-full border border-lime-200 bg-lime-50 px-2 py-0.5 text-[10px] font-bold text-lime-700">هر سیگنال بلافاصله نمایش داده می‌شود</span>
        <span className="num ms-auto text-[10px] text-slate-500">{items.length} سیگنال جدید</span>
      </div>
      <div className="thin-scroll mt-2 flex min-h-[54px] gap-2 overflow-x-auto pb-1">
        {items.length === 0 && <p className="py-2 text-[12px] text-slate-500">سیگنال‌های ۱۰۰ ارز به‌صورت یکی‌یکی از استریم روزانه دریافت می‌شوند…</p>}
        {items.map((item) => (
          <button key={item.id} type="button" onClick={() => onOpenTrade(item)} className="min-w-[220px] shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-start shadow-[0_2px_8px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-cyan-300 hover:bg-cyan-50">
            <div className="flex items-center justify-between gap-2"><span className="num text-[14px] font-extrabold">{item.symbol}</span><span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">باز</span></div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-500"><span>ورود {price(item.entryPrice)}</span><span>رتبه #{item.rank}</span></div>
            <div className="num mt-1 grid grid-cols-2 gap-1 text-[10px]"><span className="text-sky-700">TP {price(item.takeProfit)}</span><span className="text-rose-700">SL {price(item.stopLoss)}</span></div>
          </button>
        ))}
      </div>
    </section>
  );
}
