import webpush from "web-push";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { PublicConfig } from "@/lib/shared";
import { fmtPrice } from "@/lib/format";
import { backoffMs, fetchJson, getState, log, sleep } from "./core";
import {
  claimChannel,
  countSubscriptions,
  deleteSubscription,
  getSetting,
  listSubscriptions,
  releaseChannel,
  setPushCount,
  setSetting,
  touchSubscription,
  type Channel,
  type SignalRow,
} from "./repo";

// ---------------------------------------------------------------------------------
// Server-side settings (channel switches only – never secrets)
// ---------------------------------------------------------------------------------
export interface Settings {
  channels: { push: boolean; telegram: boolean; email: boolean };
}
const DEFAULTS: Settings = { channels: { push: true, telegram: true, email: true } };
let settingsCache: { at: number; v: Settings } | null = null;

export async function getSettings(): Promise<Settings> {
  if (settingsCache && Date.now() - settingsCache.at < 5000) return settingsCache.v;
  let stored: Partial<Settings> | null = null;
  try {
    stored = await getSetting<Partial<Settings>>("settings");
  } catch {
    if (settingsCache) return settingsCache.v;
  }
  const v: Settings = { channels: { ...DEFAULTS.channels, ...(stored?.channels ?? {}) } };
  settingsCache = { at: Date.now(), v };
  return v;
}

export async function saveSettings(patch: Partial<Settings["channels"]>): Promise<Settings> {
  const cur = await getSettings();
  const next: Settings = { channels: { ...cur.channels } };
  for (const k of ["push", "telegram", "email"] as const) {
    if (typeof patch[k] === "boolean") next.channels[k] = patch[k] as boolean;
  }
  await setSetting("settings", next);
  settingsCache = { at: Date.now(), v: next };
  return next;
}

// ---------------------------------------------------------------------------------
// Channel configuration (credentials are read from the server environment only)
// ---------------------------------------------------------------------------------
export const telegramConfigured = () => !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
export const emailConfigured = () => !!(process.env.SMTP_HOST && process.env.EMAIL_TO);

export async function getPublicConfig(): Promise<PublicConfig> {
  const s = await getSettings();
  let subs = 0;
  let key: string | null = null;
  try {
    subs = await countSubscriptions();
    key = (await getVapid()).publicKey;
  } catch {
    /* db unavailable */
  }
  return {
    push: { configured: !!key, enabled: s.channels.push, subscribers: subs },
    telegram: { configured: telegramConfigured(), enabled: s.channels.telegram },
    email: { configured: emailConfigured(), enabled: s.channels.email },
    vapidPublicKey: key,
  };
}

// ---------------------------------------------------------------------------------
// Web push
// ---------------------------------------------------------------------------------
let vapidPromise: Promise<{ publicKey: string; privateKey: string }> | null = null;

export function getVapid(): Promise<{ publicKey: string; privateKey: string }> {
  if (!vapidPromise) {
    vapidPromise = (async () => {
      const pub = process.env.VAPID_PUBLIC_KEY;
      const priv = process.env.VAPID_PRIVATE_KEY;
      if (pub && priv) return { publicKey: pub, privateKey: priv };
      const stored = await getSetting<{ publicKey: string; privateKey: string }>("vapid");
      if (stored?.publicKey && stored.privateKey) return stored;
      const keys = webpush.generateVAPIDKeys();
      await setSetting("vapid", keys);
      return keys;
    })().catch((e) => {
      vapidPromise = null;
      throw e;
    });
  }
  return vapidPromise;
}

async function pushToAll(payload: Record<string, unknown>): Promise<{ total: number; sent: number }> {
  const v = await getVapid();
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:radar@shahab-radar.app", v.publicKey, v.privateKey);
  const subs = await listSubscriptions();
  const body = JSON.stringify(payload);
  let sent = 0;
  for (let i = 0; i < subs.length; i += 25) {
    await Promise.all(
      subs.slice(i, i + 25).map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
            TTL: 300,
            urgency: "high",
          });
          sent++;
          await touchSubscription(s.endpoint, true);
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await deleteSubscription(s.endpoint);
          else await touchSubscription(s.endpoint, false);
        }
      }),
    );
  }
  return { total: subs.length, sent };
}

// ---------------------------------------------------------------------------------
// Telegram / Email
// ---------------------------------------------------------------------------------
async function sendTelegram(html: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error("telegram_not_configured");
  await fetchJson(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
    retries: 2,
    timeoutMs: 10_000,
  });
}

function getMailer(): Transporter {
  const g = globalThis as typeof globalThis & { __radarMailer?: Transporter };
  if (!g.__radarMailer) {
    const port = Number(process.env.SMTP_PORT || 587);
    g.__radarMailer = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return g.__radarMailer;
}

async function sendEmail(subject: string, text: string, html: string) {
  if (!emailConfigured()) throw new Error("email_not_configured");
  await getMailer().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER || "radar@localhost",
    to: process.env.EMAIL_TO,
    subject,
    text,
    html,
  });
}

function timeText(ms: number): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: process.env.NOTIFY_TIMEZONE || "Asia/Tehran",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(11, 16);
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function lines(sig: SignalRow): string[] {
  return [`LONG — ${sig.symbol}`, fmtPrice(sig.price), sig.timeframe, timeText(sig.signalTime.getTime())];
}

// ---------------------------------------------------------------------------------
// Dispatcher – one signal = one notification per channel
// ---------------------------------------------------------------------------------
async function deliver(sig: SignalRow, ch: Channel, fn: () => Promise<boolean>) {
  // Atomic claim: only one caller can ever flip the delivery marker for this signal.
  if (!(await claimChannel(sig.id, ch))) return;
  let ok = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      ok = await fn();
      break;
    } catch (e) {
      if (attempt < 2) await sleep(backoffMs(attempt, 800, 4000));
      else log(`${ch} delivery failed for ${sig.id}:`, e instanceof Error ? e.message : "error");
    }
  }
  if (!ok) await releaseChannel(sig.id, ch).catch(() => {});
}

export async function dispatchSignal(sig: SignalRow): Promise<void> {
  const s = await getSettings();
  const l = lines(sig);
  const tasks: Promise<unknown>[] = [];

  if (s.channels.push) {
    tasks.push(
      deliver(sig, "push", async () => {
        const r = await pushToAll({
          type: "signal",
          id: sig.id,
          symbol: sig.symbol,
          timeframe: sig.timeframe,
          price: sig.price,
          signalTime: sig.signalTime.getTime(),
          url: `/?signal=${encodeURIComponent(sig.id)}`,
        });
        if (r.sent > 0) await setPushCount(sig.id, r.sent);
        return r.sent > 0;
      }),
    );
  }
  if (s.channels.telegram && telegramConfigured()) {
    tasks.push(
      deliver(sig, "telegram", async () => {
        await sendTelegram(`<b>Shahab Radar</b>\n${l.map(esc).join("\n")}`);
        return true;
      }),
    );
  }
  if (s.channels.email && emailConfigured()) {
    tasks.push(
      deliver(sig, "email", async () => {
        const text = `Shahab Radar\n${l.join("\n")}`;
        const html = `<div style="font-family:Arial,sans-serif"><h3 style="margin:0 0 8px">Shahab Radar</h3>${l
          .map((x, i) => `<div style="${i === 0 ? "font-weight:700;color:#3f6212;font-size:18px" : ""}">${esc(x)}</div>`)
          .join("")}</div>`;
        await sendEmail(`Shahab Radar — LONG ${sig.symbol} ${sig.timeframe}`, text, html);
        return true;
      }),
    );
  }
  await Promise.allSettled(tasks);
}

/** Client acknowledgements for browser-side channels (sound / desktop), counted once per signal. */
export async function ackClientChannel(id: string, ch: "sound" | "desktop"): Promise<boolean> {
  return claimChannel(id, ch);
}

// ---------------------------------------------------------------------------------
// Test sends (rate-limited, never leak credentials)
// ---------------------------------------------------------------------------------
export async function sendTest(
  channel: "push" | "telegram" | "email",
): Promise<{ ok: boolean; detail: string; sent?: number; total?: number }> {
  const st = getState();
  const last = st.testLimiter.get(channel) ?? 0;
  if (Date.now() - last < 4000) return { ok: false, detail: "rate_limited" };
  st.testLimiter.set(channel, Date.now());
  const stamp = timeText(Date.now());
  try {
    if (channel === "push") {
      const r = await pushToAll({
        type: "test",
        title: "Shahab Radar",
        body: `اعلان آزمایشی\n${stamp}`,
        url: "/",
      });
      return { ok: r.sent > 0, detail: r.total === 0 ? "no_subscribers" : r.sent > 0 ? "sent" : "failed", ...r };
    }
    if (channel === "telegram") {
      if (!telegramConfigured()) return { ok: false, detail: "not_configured" };
      await sendTelegram(`<b>Shahab Radar</b>\nپیام آزمایشی\n${stamp}`);
      return { ok: true, detail: "sent" };
    }
    if (!emailConfigured()) return { ok: false, detail: "not_configured" };
    await sendEmail(
      "Shahab Radar — ایمیل آزمایشی",
      `Shahab Radar\nایمیل آزمایشی\n${stamp}`,
      `<div style="font-family:Arial,sans-serif"><h3>Shahab Radar</h3><div>ایمیل آزمایشی</div><div>${stamp}</div></div>`,
    );
    return { ok: true, detail: "sent" };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message.slice(0, 60) : "failed" };
  }
}
