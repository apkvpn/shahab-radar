"use client";
import { useState } from "react";
import { Modal, Btn } from "./ui";

type Trade = { id: string; entryTime: number; entryPrice: number; takeProfit: number; stopLoss: number; exitTime: number | null; exitPrice: number | null; exitReason: string; netPct: number | null };
type Asset = { symbol: string; name: string; rank: number; start: number | null; end: number | null; signals: number; closed: number; takeProfits: number; stopLosses: number; open: number; unknown: number; netPnlPct: number; winRate: number | null; maxDrawdownPct: number; trades: Trade[] };
type Report = { generatedAt: number; assumptions: Record<string, number | string>; assets: Asset[]; portfolio: { initialCapital: number; finalCapital: number; netPnlPct: number; trades: number; takeProfits: number; stopLosses: number; maxDrawdownPct: number } };
const pct = (n: number | null) => n == null ? "—" : `${n.toFixed(2)}%`;
const date = (n: number | null) => n == null ? "—" : new Date(n).toLocaleDateString("fa-IR");
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
      <p className="rounded-lg bg-slate-50 p-3 text-[12px] leading-6 text-slate-600">این بخش فقط با رمز سمت سرور باز می‌شود. بک‌تست فقط Daily و فقط LONG است و TP/SL ثابت ۲۵٪، کارمزد و لغزش را اعمال می‌کند.</p>
      <label className="block text-[12px] font-semibold">رمز دسترسی<input type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2" placeholder="رمز گزارش" /></label>
      <label className="block text-[12px] font-semibold">دامنه بررسی<select value={scope} onChange={e => setScope(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2"><option value="all">همه ۵۰ ارز</option>{symbols.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
      <Btn variant="black" disabled={busy || !password} onClick={() => void run()} className="w-full">{busy ? "در حال دریافت داده و اجرای بک‌تست…" : "اجرای بک‌تست واقعی"}</Btn>
      {error && <p className="rounded-lg bg-red-50 p-2 text-[12px] text-red-700">{error}</p>}
    </div> : <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["سرمایه نهایی", report.portfolio.finalCapital.toFixed(2)], ["بازده خالص", pct(report.portfolio.netPnlPct)], ["تعداد معاملات", report.portfolio.trades], ["افت سرمایه", pct(report.portfolio.maxDrawdownPct)]].map(([k,v]) => <div key={String(k)} className="rounded-xl bg-slate-900 p-3 text-white"><div className="text-[10px] text-slate-300">{k}</div><div className="num mt-1 text-lg font-bold">{v}</div></div>)}</div>
      <p className="text-[11px] text-slate-500">سرمایه اولیه ۱۰۰ واحد، تخصیص مساوی بین ارزها؛ نتیجه بر پایه قیمت ورود واقعی هر سیگنال و داده قابل دریافت از صرافی است.</p>
      <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full min-w-[760px] text-[11px]"><thead className="bg-slate-50"><tr>{["نماد/رتبه","شروع تا پایان","سیگنال/بسته","TP ۲۵٪","SL ۲۵٪","باز","خالص","برد","افت سرمایه"].map(x => <th key={x} className="p-2 text-start">{x}</th>)}</tr></thead><tbody>{report.assets.map(a => <tr key={a.symbol} onClick={() => setSelected(a)} className="cursor-pointer border-t border-line hover:bg-lime-50"><td className="num p-2 font-bold">{a.symbol} <span className="text-slate-400">#{a.rank}</span></td><td className="num p-2">{date(a.start)} — {date(a.end)}</td><td className="num p-2">{a.signals} / {a.closed}</td><td className="num p-2 text-emerald-700">{a.takeProfits}</td><td className="num p-2 text-rose-700">{a.stopLosses}</td><td className="num p-2">{a.open + a.unknown}</td><td className="num p-2">{pct(a.netPnlPct)}</td><td className="num p-2">{pct(a.winRate)}</td><td className="num p-2">{pct(a.maxDrawdownPct)}</td></tr>)}</tbody></table></div>
      {selected && <div className="rounded-xl border border-lime-200 bg-lime-50/40 p-3"><div className="flex items-center justify-between"><h3 className="font-bold">معاملات {selected.symbol}</h3><button onClick={() => setSelected(null)} className="text-lg">×</button></div><div className="mt-2 max-h-48 overflow-auto">{selected.trades.map(t => <div key={t.id} className="flex flex-wrap justify-between gap-2 border-t border-lime-100 py-2 text-[11px]"><span className="num">ورود {date(t.entryTime)} · {t.entryPrice.toPrecision(8)}</span><span className="num">TP {t.takeProfit.toPrecision(8)} · SL {t.stopLoss.toPrecision(8)}</span><span>{t.exitReason === "TAKE_PROFIT_25" ? "حد سود ۲۵٪" : t.exitReason === "STOP_LOSS_25" ? "حد ضرر ۲۵٪" : "باز"}</span><span className="num">{pct(t.netPct)}</span></div>)}</div></div>}
      <Btn onClick={() => setReport(null)} className="w-full">اجرای گزارش دیگر</Btn>
    </div>}
  </Modal>;
}
