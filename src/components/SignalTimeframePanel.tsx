"use client";

import { useCallback, useEffect, useState } from "react";
import { TIMEFRAMES, type PublicSignal, type Timeframe } from "@/lib/shared";
import { fmtDateTime, fmtPrice } from "@/lib/format";

export default function SignalTimeframePanel({ onOpen }: { onOpen: (s: PublicSignal) => void }) {
  const [tf, setTf] = useState<Timeframe>("1d");
  const [items, setItems] = useState<PublicSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async (timeframe: Timeframe) => {
    setLoading(true);
    setError(false);
    try {
      const r = await fetch(`/api/signals?timeframe=${timeframe}&limit=1000&order=desc`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as { items: PublicSignal[] };
      setItems(data.items ?? []);
    } catch {
      setError(true);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tf);
  }, [load, tf]);

  return (
    <section aria-label="همه سیگنال‌های تایم‌فریم" className="border-b border-line bg-[#fbfcfd] px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="me-1 text-[12px] font-bold text-[#1f2328]">همه سیگنال‌های</h2>
        {TIMEFRAMES.map((timeframe) => (
          <button
            key={timeframe}
            type="button"
            onClick={() => setTf(timeframe)}
            className={`num rounded-lg border px-3 py-1 text-[12px] font-bold transition-colors ${
              tf === timeframe ? "border-[#111214] bg-[#111214] text-white" : "border-line bg-white text-gray-600 hover:bg-gray-100"
            }`}
            aria-pressed={tf === timeframe}
          >
            {timeframe}
          </button>
        ))}
        <span className="num ms-auto text-[11px] text-gray-400">{loading ? "در حال بارگذاری…" : `${items.length} سیگنال`}</span>
      </div>
      <div className="thin-scroll mt-2 flex max-h-[116px] gap-2 overflow-x-auto overflow-y-hidden pb-1">
        {error && <p className="py-3 text-[12px] text-red-600">خطا در دریافت سیگنال‌ها</p>}
        {!loading && !error && items.length === 0 && <p className="py-3 text-[12px] text-gray-500">برای این تایم‌فریم سیگنالی ثبت نشده است</p>}
        {items.map((signal) => (
          <button
            key={signal.id}
            type="button"
            onClick={() => onOpen(signal)}
            className="flex min-w-[180px] shrink-0 flex-col justify-center rounded-lg border border-line bg-white px-3 py-2 text-start shadow-[0_1px_2px_rgba(16,24,40,0.05)] hover:border-lime-400"
          >
            <span className="flex items-center gap-2">
              <span className="num text-[15px] font-bold text-[#0b0b0c]">{signal.symbol}</span>
              <span className="num rounded bg-lime-400 px-1.5 py-px text-[10px] font-extrabold text-black">LONG</span>
            </span>
            <span className="num mt-1 text-[13px] font-semibold">{fmtPrice(signal.price)}</span>
            <span className="num mt-1 text-[10px] text-gray-500">{fmtDateTime(signal.signalTime)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
