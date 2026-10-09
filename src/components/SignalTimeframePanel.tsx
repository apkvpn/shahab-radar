"use client";

import { useCallback, useEffect, useState } from "react";

type NewsItem = {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: number;
  translated: boolean;
};

const date = (value: number) => new Date(value).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" });

export default function SignalTimeframePanel() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [selected, setSelected] = useState<NewsItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const r = await fetch("/api/news/market?page=1", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as { items?: NewsItem[] };
      setItems(data.items ?? []);
    } catch {
      setError(true);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 180_000);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <>
      <section aria-label="جدیدترین اخبار بازار" className="border-b border-slate-200 bg-gradient-to-l from-white via-sky-50 to-emerald-50 px-3 py-2 text-slate-900 shadow-[0_2px_10px_rgba(15,23,42,0.08)]">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-extrabold">جدیدترین اخبار بازار</h2>
          <span className="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">ترجمه فارسی</span>
          <span className="num ms-auto text-[10px] text-slate-500">{loading ? "در حال دریافت…" : `${items.length} خبر`}</span>
        </div>
        <div className="thin-scroll mt-2 flex gap-2 overflow-x-auto pb-1">
          {error && <button onClick={() => void load()} className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[12px] text-rose-200">دریافت اخبار ناموفق بود؛ تلاش دوباره</button>}
          {!loading && !error && items.length === 0 && <p className="py-2 text-[12px] text-slate-400">خبر تازه‌ای پیدا نشد.</p>}
          {items.map((item) => (
            <button key={item.id} type="button" onClick={() => setSelected(item)} className="min-w-[250px] max-w-[360px] shrink-0 rounded-xl border border-sky-200 bg-white px-3 py-2 text-start shadow-[0_2px_8px_rgba(14,116,144,0.08)] transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md">
              <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500"><span>{item.source}</span><span className="num">{date(item.publishedAt)}</span></div>
              <h3 className="mt-1 line-clamp-2 text-[12px] font-bold leading-5 text-slate-900">{item.title}</h3>
              <span className="mt-1 inline-block text-[10px] font-semibold text-emerald-700">مشاهده متن فارسی خبر ←</span>
            </button>
          ))}
        </div>
      </section>
      {selected && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/45 p-4 backdrop-blur-sm" dir="rtl" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
          <article className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-sky-200 bg-white text-slate-900 shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-sky-100 bg-gradient-to-l from-sky-50 to-emerald-50 px-5 py-4"><div><div className="mb-1 flex items-center gap-2 text-[11px] text-emerald-700"><span>{selected.source}</span><span>·</span><span className="num">{date(selected.publishedAt)}</span></div><h2 className="text-[17px] font-extrabold leading-7">{selected.title}</h2></div><button type="button" onClick={() => setSelected(null)} className="rounded-lg px-2 text-2xl leading-none text-slate-500 hover:bg-slate-100" aria-label="بستن">×</button></header>
            <div className="thin-scroll overflow-y-auto px-5 py-5"><p className="whitespace-pre-line text-[14px] leading-8 text-slate-700">{selected.summary || "متن کامل فارسی از منبع خبر دریافت نشد."}</p><p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] leading-6 text-amber-800">ترجمه و خلاصه فارسی خبر بر اساس متن قابل‌دریافت از خوراک خبری تهیه شده است. برای مشاهده منبع اصلی، لینک زیر را باز کنید.</p><a href={selected.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-lg bg-emerald-600 px-4 py-2 text-[12px] font-bold text-white hover:bg-emerald-700">مشاهده منبع اصلی خبر</a></div>
          </article>
        </div>
      )}
    </>
  );
}
