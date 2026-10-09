"use client";

import { useState } from "react";
import { Modal, Btn } from "./ui";

type Trade = {
  id: string;
  entryTime: number;
  entryPrice: number;
  takeProfit: number;
  stopLoss: number;
  exitTime: number | null;
  exitPrice: number | null;
  exitReason: string;
  grossPct: number | null;
  slippagePct: number;
  feesPct: number;
  netPct: number | null;
};
type Metrics = {
  grossProfitPct: number;
  grossLossPct: number;
  grossPnlPct: number;
  totalSlippagePct: number;
  totalFeesPct: number;
  simpleNetPnlPct: number;
  averageTradeReturnPct: number | null;
  initialCapital: number;
  finalCapital: number;
  accountReturnPct: number;
  tradeCount: number;
  closed: number;
  takeProfits: number;
  stopLosses: number;
  open: number;
  unknown: number;
  maxDrawdownPct: number;
};
type Asset = Metrics & { symbol: string; name: string; rank: number; start: number | null; end: number | null; netPnlPct: number; winRate: number | null; trades: Trade[] };
type Report = { generatedAt: number; assumptions: Record<string, number | string>; assets: Asset[]; portfolio: Metrics };

const pct = (n: number | null) => n == null ? "—" : `${n.toFixed(2)}%`;
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const date = (n: number | null) => n == null ? "—" : new Date(n).toLocaleDateString("fa-IR");
const outcome = (reason: string) => reason === "TAKE_PROFIT_25" ? "تارگت ۲۵٪" : reason === "STOP_LOSS_25" ? "استاپ ۲۵٪" : reason === "UNKNOWN" ? "نامشخص" : "باز";

function Metric({ label, value, tone = "dark" }: { label: string; value: string; tone?: "dark" | "green" | "red" | "amber" }) {
  const colors = { dark: "bg-slate-900 text-white", green: "bg-emerald-50 text-emerald-800", red: "bg-rose-50 text-rose-800", amber: "bg-amber-50 text-amber-800" };
  return <div className={`rounded-xl p-3 ${colors[tone]}`}><div className="text-[10px] opacity-70">{label}</div><div className="num mt-1 text-lg font-bold">{value}</div></div>;
}

export default function StatsReportPanel({ symbols, onClose }: { symbols: string[]; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [scope, setScope] = useState("all");
  const [report, setReport] = useState<Report | null>(null);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/backtest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password, scope }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error === "unauthorized" ? "رمز گزارش صحیح نیست" : d.error === "market_not_ready" ? "ابتدا فهرست بازارها آماده شود" : "اجرای بک‌تست ممکن نشد");
      setReport(d);
    } catch (e) { setError(e instanceof Error ? e.message : "خطا"); }
    finally { setBusy(false); }
  };

  return <Modal title="گزارش آماری سیگنال‌ها" onClose={onClose}>
    {!report ? <div className="space-y-3">
      <p className="rounded-lg bg-slate-50 p-3 text-[12px] leading-6 text-slate-600">موتور واحد بک‌تست Daily و LONG، حد سود و ضرر ۲۵٪، قیمت ورود و خروج واقعی، کارمزد، لغزش، بازده ساده معاملات و بازده مرکب حساب را جداگانه محاسبه می‌کند.</p>
      <label className="block text-[12px] font-semibold">رمز دسترسی<input type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2" placeholder="رمز گزارش" /></label>
      <label className="block text-[12px] font-semibold">دامنه بررسی<select value={scope} onChange={e => setScope(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2"><option value="all">همه ۵۰ ارز</option>{symbols.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
      <Btn variant="black" disabled={busy || !password} onClick={() => void run()} className="w-full">{busy ? "در حال دریافت داده و اجرای بک‌تست…" : "اجرای بک‌تست واقعی"}</Btn>
      {error && <p className="rounded-lg bg-red-50 p-2 text-[12px] text-red-700">{error}</p>}
    </div> : <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="سرمایه اولیه" value={num(report.portfolio.initialCapital)} />
        <Metric label="سرمایه نهایی مرکب" value={num(report.portfolio.finalCapital)} tone="green" />
        <Metric label="بازده کل حساب" value={pct(report.portfolio.accountReturnPct)} tone="green" />
        <Metric label="بازده ساده خالص معاملات" value={pct(report.portfolio.simpleNetPnlPct)} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="سود ناخالص بردها" value={pct(report.portfolio.grossProfitPct)} tone="green" />
        <Metric label="زیان ناخالص باخت‌ها" value={pct(report.portfolio.grossLossPct)} tone="red" />
        <Metric label="هزینه لغزش" value={pct(report.portfolio.totalSlippagePct)} tone="amber" />
        <Metric label="هزینه کارمزد" value={pct(report.portfolio.totalFeesPct)} tone="amber" />
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-5"><div>میانگین هر معامله: <b className="num">{pct(report.portfolio.averageTradeReturnPct)}</b></div><div>برد: <b className="num text-emerald-700">{report.portfolio.takeProfits}</b></div><div>باخت: <b className="num text-rose-700">{report.portfolio.stopLosses}</b></div><div>باز: <b className="num">{report.portfolio.open}</b></div><div>نامشخص: <b className="num">{report.portfolio.unknown}</b></div></div>
      <p className="rounded-lg bg-slate-50 p-3 text-[11px] leading-6 text-slate-600">بازده ساده برای کنترل فرمول از جمع درصد معاملات بسته‌شده به‌دست می‌آید. بازده کل حساب جداگانه با سرمایه اولیه ۱۰۰، تخصیص مساوی بین ارزهای موجود، ترتیب زمانی معاملات و سرمایه‌گذاری مجدد سود محاسبه می‌شود. معاملات باز و نامشخص در سود تحقق‌یافته وارد نشده‌اند.</p>
      <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full min-w-[1060px] text-[11px]"><thead className="bg-slate-50"><tr>{["نماد/رتبه", "بازه", "کل/بسته", "برد", "باخت", "باز/نامشخص", "سود ناخالص", "زیان ناخالص", "هزینه‌ها", "خالص حساب", "میانگین"].map(x => <th key={x} className="p-2 text-start">{x}</th>)}</tr></thead><tbody>{report.assets.map(a => <tr key={a.symbol} onClick={() => setSelected(a)} className="cursor-pointer border-t border-line hover:bg-lime-50"><td className="num p-2 font-bold">{a.symbol} <span className="text-slate-400">#{a.rank}</span></td><td className="num p-2">{date(a.start)} — {date(a.end)}</td><td className="num p-2">{a.tradeCount} / {a.closed}</td><td className="num p-2 text-emerald-700">{a.takeProfits}</td><td className="num p-2 text-rose-700">{a.stopLosses}</td><td className="num p-2">{a.open} / {a.unknown}</td><td className="num p-2 text-emerald-700">{pct(a.grossProfitPct)}</td><td className="num p-2 text-rose-700">{pct(a.grossLossPct)}</td><td className="num p-2 text-amber-700">{pct(a.totalFeesPct + a.totalSlippagePct)}</td><td className="num p-2 font-bold">{pct(a.accountReturnPct)}</td><td className="num p-2">{pct(a.averageTradeReturnPct)}</td></tr>)}</tbody></table></div>
      {selected && <div className="rounded-xl border border-lime-200 bg-lime-50/40 p-3"><div className="flex items-center justify-between"><h3 className="font-bold">جزئیات معاملات {selected.symbol}</h3><button onClick={() => setSelected(null)} className="text-lg">×</button></div><div className="mt-2 max-h-56 overflow-auto">{selected.trades.map(t => <div key={t.id} className="flex flex-wrap justify-between gap-2 border-t border-lime-100 py-2 text-[11px]"><span className="num">ورود {date(t.entryTime)} · خروج {date(t.exitTime)}</span><span>{outcome(t.exitReason)}</span><span className="num">ناخالص {pct(t.grossPct)} · لغزش {pct(t.slippagePct)} · کارمزد {pct(t.feesPct)} · خالص {pct(t.netPct)}</span></div>)}</div></div>}
      <Btn onClick={() => setReport(null)} className="w-full">اجرای گزارش دیگر</Btn>
    </div>}
  </Modal>;
}
