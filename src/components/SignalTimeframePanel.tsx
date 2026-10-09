"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChartTradeFocus } from "@/lib/shared";

type Outcome = ChartTradeFocus["exitReason"];
type HistoricalSignal = {
  id: string;
  symbol: string;
  name: string;
  rank: number;
  entryTime: number;
  entryPrice: number;
  takeProfit: number;
  stopLoss: number;
  exitTime: number | null;
  exitPrice: number | null;
  outcome: Outcome;
  netPct: number | null;
};

const date = (value: number) => new Date(value).toLocaleDateString("fa-IR", { year: "numeric", month: "short", day: "numeric" });
const price = (value: number) => new Intl.NumberFormat("en-US", { maximumSignificantDigits: 8 }).format(value);
const outcomeText: Record<Outcome, string> = {
  TAKE_PROFIT_25: "تارگت شد",
  STOP_LOSS_25: "استاپ شد",
  OPEN: "باز",
  AMBIGUOUS: "مبهم",
};

function outcomeClass(outcome: Outcome) {
  if (outcome === "TAKE_PROFIT_25") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (outcome === "STOP_LOSS_25") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export default function SignalTimeframePanel({ onOpenTrade }: { onOpenTrade: (trade: ChartTradeFocus) => void }) {
  const [items, setItems] = useState<HistoricalSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const r = await fetch("/api/signals/timeline?limit=120", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as { items?: HistoricalSignal[]; generatedAt?: number };
      setItems(data.items ?? []);
      setUpdatedAt(data.generatedAt ?? Date.now());
    } catch {
      setError(true);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 600_000);
    return () => window.clearInterval(id);
  }, [load]);

  const counts = useMemo(() => ({
    tp: items.filter((x) => x.outcome === "TAKE_PROFIT_25").length,
    sl: items.filter((x) => x.outcome === "STOP_LOSS_25").length,
    ambiguous: items.filter((x) => x.outcome === "AMBIGUOUS").length,
  }), [items]);

  return (
    <section aria-label="آخرین سیگنال‌های تاریخی" className="border-b border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-extrabold">آخرین سیگنال‌های ۱۰۰ ارز</h2>
        <span className="rounded-full border border-lime-200 bg-lime-50 px-2 py-0.5 text-[10px] font-bold text-lime-700">از امروز تا ۲۰۱۵</span>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">تارگت: {counts.tp}</span>
        <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">استاپ: {counts.sl}</span>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">مبهم: {counts.ambiguous}</span>
        <span className="num ms-auto text-[10px] text-slate-500">{loading ? "در حال محاسبه از دیتای بازار…" : updatedAt ? `به‌روزرسانی ${date(updatedAt)}` : ""}</span>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg border border-line bg-white px-2 py-1 text-[11px] font-semibold hover:bg-slate-50 disabled:opacity-50">بروزرسانی</button>
      </div>
      <div className="thin-scroll mt-2 flex gap-2 overflow-x-auto pb-1">
        {error && <button type="button" onClick={() => void load()} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">دریافت تاریخچه ناموفق بود؛ تلاش دوباره</button>}
        {loading && !error && <p className="py-2 text-[12px] text-slate-500">سیگنال‌های ۱۰۰ ارز در حال استخراج از کندل‌های روزانه هستند…</p>}
        {!loading && !error && items.length === 0 && <p className="py-2 text-[12px] text-slate-500">سیگنالی در بازه انتخاب‌شده پیدا نشد.</p>}
        {items.map((item) => (
          <button key={item.id} type="button" onClick={() => onOpenTrade({ id: item.id, symbol: item.symbol, entryTime: item.entryTime, entryPrice: item.entryPrice, takeProfit: item.takeProfit, stopLoss: item.stopLoss, exitTime: item.exitTime, exitPrice: item.exitPrice, exitReason: item.outcome })} className="min-w-[205px] shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-start shadow-[0_2px_8px_rgba(15,23,42,0.05)] hover:border-sky-300 hover:bg-sky-50">
            <div className="flex items-center justify-between gap-2"><span className="num text-[14px] font-extrabold">{item.symbol}</span><span className="num text-[10px] text-slate-500">#{item.rank}</span></div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-500"><span>{date(item.entryTime)}</span><span className={`rounded-full border px-1.5 py-0.5 font-bold ${outcomeClass(item.outcome)}`}>{outcomeText[item.outcome]}</span></div>
            <div className="num mt-1 grid grid-cols-2 gap-1 text-[10px] text-slate-600"><span>ورود {price(item.entryPrice)}</span><span>خروج {item.exitPrice ? price(item.exitPrice) : "—"}</span></div>
          </button>
        ))}
      </div>
    </section>
  );
}
