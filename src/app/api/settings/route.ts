import { SCAN_INTERVAL_SEC, TIMEFRAMES, TOP_N } from "@/lib/shared";
import { boot, json } from "@/server/api";
import { getPublicConfig, getSettings, saveSettings } from "@/server/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function payload() {
  const [settings, config] = await Promise.all([getSettings(), getPublicConfig()]);
  return {
    channels: settings.channels,
    config,
    scanIntervalSec: SCAN_INTERVAL_SEC,
    timeframes: TIMEFRAMES,
    topN: TOP_N,
  };
}

export async function GET() {
  const err = await boot();
  if (err) return err;
  try {
    return json(await payload());
  } catch {
    return json({ error: "database_unavailable" }, 503);
  }
}

/** Only notification channel switches are writable; everything else is fixed. */
export async function PUT(req: Request) {
  const err = await boot();
  if (err) return err;
  const body = (await req.json().catch(() => ({}))) as { channels?: Record<string, unknown> };
  const c = body.channels ?? {};
  try {
    await saveSettings({
      push: typeof c.push === "boolean" ? c.push : undefined,
      telegram: typeof c.telegram === "boolean" ? c.telegram : undefined,
      email: typeof c.email === "boolean" ? c.email : undefined,
    });
    return json(await payload());
  } catch {
    return json({ error: "database_unavailable" }, 503);
  }
}
