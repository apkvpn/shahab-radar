import type { PublicSignal } from "./shared";
import { fmtPrice, fmtTime } from "./format";

export type Perm = NotificationPermission | "unsupported";

export function permission(): Perm {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

async function readyReg(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    await registerSW();
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

function b64ToU8(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const s = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Registers this browser for server push (idempotent). */
export async function subscribePush(): Promise<boolean> {
  if (typeof window === "undefined" || !("PushManager" in window)) return false;
  const reg = await readyReg();
  if (!reg) return false;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const cfg = await fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null);
    const key: string | undefined = cfg?.config?.vapidPublicKey ?? undefined;
    if (!key) return false;
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
    } catch {
      return false;
    }
  }
  const res = await fetch("/api/notifications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  }).catch(() => null);
  return !!res?.ok;
}

export async function hasPushSubscription(): Promise<boolean> {
  if (typeof window === "undefined" || !("PushManager" in window)) return false;
  const reg = await readyReg();
  if (!reg) return false;
  return !!(await reg.pushManager.getSubscription());
}

/**
 * Asks for permission at most once: after a denial (or while "default" was dismissed)
 * the browser prompt is never shown again – the UI explains how to re-enable it instead.
 */
export async function enableNotifications(): Promise<{ permission: Perm; pushed: boolean }> {
  const cur = permission();
  if (cur === "unsupported") return { permission: cur, pushed: false };
  let perm: Perm = cur;
  if (cur === "default") perm = await Notification.requestPermission();
  if (perm !== "granted") return { permission: perm, pushed: false };
  const pushed = await subscribePush();
  return { permission: perm, pushed };
}

function baseOptions(tag: string, body: string, url: string): NotificationOptions {
  return {
    body,
    tag,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url },
    dir: "rtl",
    lang: "fa",
    renotify: true,
  } as NotificationOptions;
}

async function show(title: string, opts: NotificationOptions): Promise<boolean> {
  if (permission() !== "granted") return false;
  const reg = await readyReg();
  try {
    if (reg) {
      await reg.showNotification(title, opts);
      return true;
    }
    new Notification(title, opts);
    return true;
  } catch {
    return false;
  }
}

/** Desktop notification – same tag as the server push, so the browser never shows two. */
export function showSignalNotification(sig: PublicSignal): Promise<boolean> {
  const body = `LONG — ${sig.symbol}\n${fmtPrice(sig.price)}\n${sig.timeframe}\n${fmtTime(sig.signalTime)}`;
  return show("Shahab Radar - سیگنال ترید", baseOptions(sig.id, body, `/?signal=${encodeURIComponent(sig.id)}`));
}

export function showLocalTest(): Promise<boolean> {
  return show("Shahab Radar - سیگنال ترید", baseOptions("shahab-test", `اعلان آزمایشی\n${fmtTime(Date.now())}`, "/"));
}
