"use client";

import { memo } from "react";
import type { PublicSignal, Timeframe } from "@/lib/shared";
import { fmtPrice, fmtTime } from "@/lib/format";

// one controlled accent per timeframe
const ACCENT: Record<Timeframe, string> = {
  "15m": "#06b6d4", // cyan
  "1h": "#8b5cf6", // violet
  "4h": "#f59e0b", // amber
  "1d": "#3b82f6", // blue
};

const Card = memo(function Card({
  s,
  selected,
  isNew,
  onOpen,
}: {
  s: PublicSignal;
  selected: boolean;
  isNew: boolean;
  onOpen: (s: PublicSignal) => void;
}) {
  const accent = ACCENT[s.timeframe] ?? "#84cc16";
  return (
    <button
      onClick={() => onOpen(s)}
      className={`relative flex w-[150px] shrink-0 flex-col items-center overflow-hidden rounded-xl border bg-white pb-2.5 pt-3 shadow-[0_1px_2px_rgba(16,24,40,0.06)] transition hover:shadow-md sm:w-[172px] ${
        selected ? "border-[#111214]" : "border-line"
      } ${isNew ? "ring-2 ring-lime-400" : ""}`}
    >
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} />
      {isNew && (
        <span className="absolute start-2 top-2 rounded bg-[#111214] px-1.5 py-px text-[9px] font-bold text-lime-300">جدید</span>
      )}
      <span className="num text-[24px] font-bold leading-none tracking-tight text-[#0b0b0c] sm:text-[28px]">{s.symbol}</span>
      <span className="num mt-1.5 inline-flex items-center gap-1 rounded-md bg-lime-400 px-2.5 py-0.5 text-[12px] font-extrabold tracking-wider text-black">
        <span aria-hidden>▲</span>LONG
      </span>
      <span className="num mt-2 text-[18px] font-semibold leading-none text-[#1f2328] sm:text-[20px]">{fmtPrice(s.price)}</span>
      <span className="num mt-1.5 flex items-center gap-1.5 text-[12px] text-gray-600">
        <span className="rounded px-1 font-semibold text-black" style={{ background: `${accent}33` }}>
          {s.timeframe}
        </span>
        {fmtTime(s.signalTime)}
      </span>
    </button>
  );
});

export default function SignalStrip({
  signals,
  selectedId,
  now,
  onOpen,
}: {
  signals: PublicSignal[];
  selectedId: string | null;
  now: number;
  onOpen: (s: PublicSignal) => void;
}) {
  return (
    <section aria-label="سیگنال‌های LONG اخیر" className="border-b border-line bg-white">
      <div className="flex items-center justify-between px-3 pt-2">
        <h2 className="text-[12px] font-bold text-[#1f2328]">
          سیگنال‌های <span className="num">LONG</span> اخیر
        </h2>
        <span className="num text-[11px] text-gray-400">{signals.length}</span>
      </div>
      {signals.length === 0 ? (
        <p className="px-3 pb-2.5 pt-1 text-[12px] text-gray-500">در انتظار اولین سیگنال LONG…</p>
      ) : (
        <div className="thin-scroll flex gap-2.5 overflow-x-auto px-3 pb-2.5 pt-1.5">
          {signals.map((s) => (
            <Card key={s.id} s={s} selected={s.id === selectedId} isNew={now - s.createdAt < 45_000} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}
