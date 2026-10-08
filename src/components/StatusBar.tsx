"use client";

import type { SystemStatus } from "@/lib/shared";
import { fmtTime } from "@/lib/format";

function Item({ k, v, tone }: { k: string; v: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? "text-cyan-700" : tone === "warn" ? "text-amber-700" : tone === "bad" ? "text-red-600" : "text-[#1f2328]";
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <span className="text-gray-500">{k}:</span>
      <span className={`num font-semibold ${color}`}>{v}</span>
    </span>
  );
}

export default function StatusBar({ status, online }: { status: SystemStatus | null; online: boolean }) {
  let sys = "در حال راه‌اندازی";
  let sysTone: "ok" | "warn" | "bad" = "warn";
  let conn = "قطع";
  let connTone: "ok" | "warn" | "bad" = "bad";

  if (status) {
    if (status.system === "active") {
      sys = "فعال";
      sysTone = "ok";
    } else if (status.system === "degraded") {
      sys = "محدود";
      sysTone = "warn";
    }
    if (!online) {
      conn = "قطع";
      connTone = "bad";
    } else if (status.feed === "connected" && !status.stale) {
      conn = "متصل";
      connTone = "ok";
    } else if (status.feed === "connecting") {
      conn = "در حال اتصال";
      connTone = "warn";
    } else {
      conn = status.feed === "connected" ? "داده کهنه" : "قطع / تلاش مجدد";
      connTone = status.feed === "connected" ? "warn" : "bad";
    }
  }

  return (
    <footer className="border-t border-line bg-white px-3 py-1.5 text-[11px]">
      <div className="thin-scroll flex items-center gap-x-4 overflow-x-auto whitespace-nowrap">
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${sysTone === "ok" ? "bg-cyan-500" : sysTone === "warn" ? "bg-amber-500" : "bg-red-500"}`} />
          <span className="text-gray-500">سیستم:</span>
          <span className="font-semibold">{sys}</span>
        </span>
        <Item k="بازارها" v={String(status?.markets ?? 0)} />
        <Item k="تایم‌فریم‌ها" v={String(status?.timeframes ?? 6)} />
        <Item k="ترکیب‌ها" v={String(status?.combos ?? 0)} />
        <Item k="اسکن" v={`هر ${status?.scanIntervalSec ?? 5} ثانیه`} />
        <Item k="آخرین اسکن" v={status?.lastScanAt ? fmtTime(status.lastScanAt, true) : "—"} />
        {status && status.synced < status.combos && <Item k="همگام‌سازی" v={`${status.synced}/${status.combos}`} tone="warn" />}
        <Item k="اتصال داده" v={conn} tone={connTone} />
      </div>
    </footer>
  );
}
