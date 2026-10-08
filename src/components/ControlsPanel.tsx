"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicConfig } from "@/lib/shared";
import { SOUND_LABELS, playAlert } from "@/lib/audio";
import { showLocalTest, type Perm } from "@/lib/client-notify";
import type { Prefs } from "@/lib/use-radar";
import { Btn, Modal, Toggle } from "./ui";

type Channel = "push" | "telegram" | "email";

const DETAIL_FA: Record<string, string> = {
  sent: "ارسال شد",
  not_configured: "روی سرور پیکربندی نشده است",
  no_subscribers: "ابتدا اعلان مرورگر را فعال کنید",
  rate_limited: "کمی صبر کنید و دوباره تلاش کنید",
  failed: "ارسال ناموفق بود",
};

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">{label}</div>
        {hint && <div className="text-[11px] text-gray-500">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export default function ControlsPanel({
  prefs,
  setPrefs,
  audioOk,
  onUnlockAudio,
  perm,
  onEnableNotifications,
  onClose,
}: {
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  audioOk: boolean;
  onUnlockAudio: () => Promise<boolean>;
  perm: Perm | null;
  onEnableNotifications: () => Promise<void>;
  onClose: () => void;
}) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/settings", { cache: "no-store" });
      if (r.ok) setConfig(((await r.json()) as { config: PublicConfig }).config);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const preview = async (id: number) => {
    await onUnlockAudio();
    playAlert(id, prefs.volume);
  };

  const toggleChannel = async (ch: Channel, v: boolean) => {
    setConfig((c) => (c ? { ...c, [ch]: { ...c[ch], enabled: v } } : c));
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channels: { [ch]: v } }),
    }).catch(() => {});
    void load();
  };

  const test = async (ch: Channel) => {
    setBusy(ch);
    setMsg(null);
    try {
      const r = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel: ch }),
      });
      const d = (await r.json()) as { ok: boolean; detail: string };
      let text = DETAIL_FA[d.detail] ?? DETAIL_FA.failed;
      let ok = d.ok;
      if (ch === "push" && !d.ok && perm === "granted") {
        // no server subscription yet – still prove that this browser can show notifications
        const shown = await showLocalTest();
        if (shown) {
          ok = true;
          text = "اعلان آزمایشی نمایش داده شد";
        }
      }
      setMsg({ text, ok });
    } catch {
      setMsg({ text: DETAIL_FA.failed, ok: false });
    } finally {
      setBusy(null);
      void load();
    }
  };

  const enableAudio = async () => {
    const ok = await onUnlockAudio();
    if (ok) {
      setPrefs({ soundOn: true });
      playAlert(prefs.soundId, prefs.volume);
    }
  };

  return (
    <Modal title="صدا و اعلان‌ها" onClose={onClose}>
      <section>
        <h3 className="mb-1 text-[12px] font-bold text-gray-500">صدای هشدار</h3>
        {!audioOk && (
          <Btn variant="lime" onClick={enableAudio} className="mb-2 w-full">
            فعال‌سازی صدای هشدار
          </Btn>
        )}
        <Row label="صدا" hint="پخش آنی هنگام سیگنال جدید">
          <Toggle on={prefs.soundOn} onChange={(v) => setPrefs({ soundOn: v })} label="روشن/خاموش" />
        </Row>
        <div className="grid grid-cols-2 gap-1.5 py-1 sm:grid-cols-3">
          {SOUND_LABELS.map((l, i) => (
            <button
              key={l}
              onClick={() => {
                setPrefs({ soundId: i + 1 });
                void preview(i + 1);
              }}
              className={`rounded-lg border px-2 py-1.5 text-[12px] font-semibold ${
                prefs.soundId === i + 1 ? "border-[#111214] bg-[#111214] text-white" : "border-line bg-white hover:bg-gray-50"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 py-2">
          <span className="text-[13px] font-semibold">بلندی صدا</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={prefs.volume}
            onChange={(e) => setPrefs({ volume: Number(e.target.value) })}
            className="h-1.5 flex-1 accent-lime-500"
            aria-label="بلندی صدا"
            dir="ltr"
          />
          <span className="num w-9 text-end text-[12px] text-gray-500">{Math.round(prefs.volume * 100)}%</span>
        </div>
        <Btn onClick={() => void preview(prefs.soundId)} className="w-full">
          تست صدای هشدار
        </Btn>
      </section>

      <section className="mt-4 border-t border-line pt-3">
        <h3 className="mb-1 text-[12px] font-bold text-gray-500">اعلان‌ها</h3>
        {perm === "unsupported" && <p className="py-1 text-[12px] text-gray-500">این مرورگر از اعلان پشتیبانی نمی‌کند.</p>}
        {perm === "denied" && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">
            اعلان‌ها در مرورگر مسدود شده‌اند. برای فعال‌سازی، از تنظیمات سایت در مرورگر اجازه‌ی اعلان را بدهید.
          </p>
        )}
        {perm === "default" && (
          <Btn variant="black" onClick={() => void onEnableNotifications()} className="mb-1 w-full">
            فعال‌سازی اعلان‌ها
          </Btn>
        )}
        <Row label="اعلان دسکتاپ" hint={perm === "granted" ? "مجوز مرورگر فعال است" : "نیازمند مجوز مرورگر"}>
          <Toggle on={prefs.desktopOn} onChange={(v) => setPrefs({ desktopOn: v })} label="اعلان دسکتاپ" />
        </Row>
        <Row label="Push مرورگر" hint={config ? `${config.push.subscribers} دستگاه ثبت‌شده` : undefined}>
          <Toggle on={config?.push.enabled ?? true} onChange={(v) => void toggleChannel("push", v)} label="Push" />
        </Row>
        <Row label="تلگرام" hint={config?.telegram.configured ? "پیکربندی شده" : "پیکربندی نشده (متغیرهای سرور)"}>
          <Toggle on={config?.telegram.enabled ?? true} onChange={(v) => void toggleChannel("telegram", v)} label="تلگرام" />
        </Row>
        <Row label="ایمیل" hint={config?.email.configured ? "پیکربندی شده" : "پیکربندی نشده (متغیرهای سرور)"}>
          <Toggle on={config?.email.enabled ?? true} onChange={(v) => void toggleChannel("email", v)} label="ایمیل" />
        </Row>
        <div className="mt-2 grid gap-1.5">
          <Btn onClick={() => void test("push")} disabled={busy === "push"}>
            ارسال اعلان آزمایشی
          </Btn>
          <Btn onClick={() => void test("telegram")} disabled={busy === "telegram"}>
            ارسال پیام تلگرام آزمایشی
          </Btn>
          <Btn onClick={() => void test("email")} disabled={busy === "email"}>
            ارسال ایمیل آزمایشی
          </Btn>
        </div>
        {msg && (
          <p className={`mt-2 rounded-lg px-3 py-2 text-[12px] ${msg.ok ? "bg-lime-50 text-lime-800" : "bg-red-50 text-red-700"}`}>
            {msg.text}
          </p>
        )}
      </section>
    </Modal>
  );
}
