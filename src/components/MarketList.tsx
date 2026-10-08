"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { TIMEFRAMES, activeWindowMs, type MarketMetaPublic, type Snapshot, type Timeframe } from "@/lib/shared";
import { fmtDateTime, fmtPct, fmtPrice, fmtTime } from "@/lib/format";

const ROW_H = 74;

interface Row {
  m: MarketMetaPublic;
  price: number | null;
  change: number | null;
  last: [number, number, number] | null;
  long: boolean;
  longTfs: Set<Timeframe>;
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

const Item = memo(function Item({
  row,
  tf,
  selected,
  top,
  stale,
  now,
  onSelect,
}: {
  row: Row;
  tf: Timeframe;
  selected: boolean;
  top: number;
  stale: boolean;
  now: number;
  onSelect: (symbol: string, tf?: Timeframe) => void;
}) {
  const { m, price, change, last, long, longTfs } = row;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(m.symbol)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(m.symbol)}
      className={`absolute inset-x-0 flex cursor-pointer flex-col justify-center gap-1 border-b border-line px-3 text-start ${
        selected ? "bg-lime-50 shadow-[inset_3px_0_0_#84cc16]" : "hover:bg-gray-50"
      }`}
      style={{ top, height: ROW_H }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="num w-5 shrink-0 text-[10px] text-gray-400">{m.rank}</span>
          <span className="num text-[14px] font-bold text-[#0b0b0c]">{m.symbol}</span>
          <span className="truncate text-[11px] text-gray-500">{m.name}</span>
        </div>
        <span className={`num text-[13px] font-semibold ${stale ? "text-gray-400" : "text-[#1f2328]"}`}>{fmtPrice(price)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="num rounded bg-gray-100 px-1 text-[10px] text-gray-600">{tf}</span>
          {long ? (
            <span className="num rounded bg-lime-400 px-1.5 text-[10px] font-extrabold text-black">LONG</span>
          ) : (
            <span className="num text-[10px] font-medium text-gray-400">WAIT</span>
          )}
          {last ? (
            <span className="text-[10px] text-gray-500" title={`سیگنال در ${fmtPrice(last[1])}`}>
              آخرین: <span className="num">{sameDay(last[0], now) ? fmtTime(last[0]) : fmtDateTime(last[0])}</span>
            </span>
          ) : (
            <span className="text-[10px] text-gray-300">بدون سیگنال</span>
          )}
        </div>
        <span className={`num text-[11px] font-medium ${change == null ? "text-gray-400" : change >= 0 ? "text-emerald-600" : "text-red-500"}`}>
          {fmtPct(change)}
        </span>
      </div>
      <div className="flex gap-1">
        {TIMEFRAMES.map((t) => (
          <span
            key={t}
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(m.symbol, t);
            }}
            className={`num rounded px-1 text-[9px] ${
              longTfs.has(t) ? "bg-lime-400 font-bold text-black" : t === tf ? "bg-gray-200 text-gray-700" : "bg-gray-100 text-gray-400"
            }`}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
});

export default function MarketList({
  markets,
  snapshot,
  tf,
  selected,
  search,
  onlyLong,
  now,
  onSelect,
}: {
  markets: MarketMetaPublic[];
  snapshot: Snapshot | null;
  tf: Timeframe;
  selected: string;
  search: string;
  onlyLong: boolean;
  now: number;
  onSelect: (symbol: string, tf?: Timeframe) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(480);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out: Row[] = [];
    for (const m of markets) {
      if (q && !m.symbol.toLowerCase().includes(q) && !m.name.toLowerCase().includes(q)) continue;
      const tick = snapshot?.ticks[m.symbol];
      const lastAll = snapshot?.last[m.symbol] ?? {};
      const longTfs = new Set<Timeframe>();
      for (const t of TIMEFRAMES) {
        const l = lastAll[t];
        if (l && now - l[0] <= activeWindowMs(t)) longTfs.add(t);
      }
      const last = lastAll[tf] ?? null;
      const long = longTfs.has(tf);
      if (onlyLong && !long) continue;
      out.push({ m, price: tick?.[0] ?? null, change: tick?.[1] ?? null, last, long, longTfs });
    }
    return out;
  }, [markets, snapshot, tf, search, onlyLong, now]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // keep the selected market visible when it changes from outside (signal click)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const i = rows.findIndex((r) => r.m.symbol === selected);
    if (i < 0) return;
    const top = i * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 3);
  const end = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + 3);
  const stale = snapshot?.status.stale ?? true;

  return (
    <div ref={box} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} className="thin-scroll relative h-full overflow-y-auto">
      {rows.length === 0 ? (
        <p className="p-6 text-center text-[12px] text-gray-500">
          {markets.length === 0 ? "در حال دریافت فهرست بازارها…" : "موردی یافت نشد"}
        </p>
      ) : (
        <div style={{ height: rows.length * ROW_H, position: "relative" }}>
          {rows.slice(start, end).map((r, i) => (
            <Item
              key={r.m.symbol}
              row={r}
              tf={tf}
              selected={r.m.symbol === selected}
              top={(start + i) * ROW_H}
              stale={stale}
              now={now}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
