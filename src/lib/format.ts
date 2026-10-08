export function fmtPrice(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const a = Math.abs(p);
  let min = 2;
  let max = 2;
  if (a < 1000 && a >= 1) max = 4;
  else if (a < 1 && a >= 0.01) {
    min = 4;
    max = 5;
  } else if (a < 0.01 && a >= 0.0001) {
    min = 6;
    max = 6;
  } else if (a < 0.0001) {
    min = 8;
    max = 8;
  }
  return "$" + p.toLocaleString("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });
}

export function fmtNum(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return fmtPrice(p).replace("$", "");
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export function fmtTime(ms: number, withSeconds = false): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hour12: false,
  });
}

export function fmtDateTime(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" });
  return `${date} ${fmtTime(ms)}`;
}

export function fmtCap(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return v.toFixed(0);
}

export function relTime(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} ثانیه پیش`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} دقیقه پیش`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} ساعت پیش`;
  return `${Math.round(h / 24)} روز پیش`;
}
