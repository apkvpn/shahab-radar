"use client";

import { useCallback, useEffect, useState } from "react";
import { TIMEFRAMES, type PublicSignal } from "@/lib/shared";
import { fmtDateTime, fmtPrice } from "@/lib/format";
import { Btn, Modal } from "./ui";

const PAGE = 40;
const field = "w-full rounded-lg border border-line bg-white px-2 py-1.5 text-[12px]";

export default function HistoryPanel({
  symbols,
  onOpen,
  onClose,
}: {
  symbols: string[];
  onOpen: (s: PublicSignal) => void;
  onClose: () => void;
}) {
  const [symbol, setSymbol] = useState("");
  const [tf, setTf] = useState("");
  const [date, setDate] = useState("");
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [items, setItems] = useState<PublicSignal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError(false);
      const p = new URLSearchParams({ order, limit: String(PAGE), offset: String(offset) });
      if (symbol) p.set("symbol", symbol);
      if (tf) p.set("timeframe", tf);
      if (date) {
        const [y, m, d] = date.split("-").map(Number);
        p.set("from", String(new Date(y, m - 1, d, 0, 0, 0).getTime()));
        p.set("to", String(new Date(y, m - 1, d, 23, 59, 59, 999).getTime()));
      }
      try {
        const r = await fetch(`/api/signals?${p.toString()}`, { cache: "no-store" });
        if (!r.ok) throw new Error();
        const d = (await r.json()) as { items: PublicSignal[]; total: number };
        setItems((prev) => (offset === 0 ? d.items : [...prev, ...d.items]));
        setTotal(d.total);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [symbol, tf, date, order],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  return (
    <Modal title="تاریخچه سیگنال‌ها" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-[11px] text-gray-500">
          ارز
          <select className={field} value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            <option value="">همه</option>
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-gray-500">
          تایم‌فریم
          <select className={field} value={tf} onChange={(e) => setTf(e.target.value)}>
            <option value="">همه</option>
            {TIMEFRAMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-gray-500">
          تاریخ
          <input type="date" className={`${field} num`} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-[11px] text-gray-500">
          مرتب‌سازی
          <select className={field} value={order} onChange={(e) => setOrder(e.target.value as "asc" | "desc")}>
            <option value="desc">جدیدترین</option>
            <option value="asc">قدیمی‌ترین</option>
          </select>
        </label>
      </div>

      <div className="mt-3 divide-y divide-line rounded-xl border border-line">
        {items.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              onOpen(s);
              onClose();
            }}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start hover:bg-gray-50"
          >
            <span className="flex items-center gap-2">
              <span className="num text-[14px] font-bold">{s.symbol}</span>
              <span className="num rounded bg-lime-400 px-1.5 text-[10px] font-extrabold text-black">LONG</span>
              <span className="num rounded bg-gray-100 px-1 text-[10px] text-gray-600">{s.timeframe}</span>
            </span>
            <span className="flex flex-col items-end">
              <span className="num text-[13px] font-semibold">{fmtPrice(s.price)}</span>
              <span className="num text-[11px] text-gray-500">{fmtDateTime(s.signalTime)}</span>
            </span>
          </button>
        ))}
        {!loading && !error && items.length === 0 && <p className="p-5 text-center text-[12px] text-gray-500">سیگنالی یافت نشد</p>}
        {error && <p className="p-5 text-center text-[12px] text-red-600">خطا در دریافت تاریخچه</p>}
        {loading && <p className="p-3 text-center text-[12px] text-gray-500">در حال بارگذاری…</p>}
      </div>
      {items.length < total && !loading && (
        <Btn onClick={() => void load(items.length)} className="mt-3 w-full">
          نمایش بیشتر ({total - items.length})
        </Btn>
      )}
    </Modal>
  );
}
