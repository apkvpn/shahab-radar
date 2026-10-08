import { boot, json } from "@/server/api";
import { ackClientChannel, getPublicConfig } from "@/server/notify";
import { deleteSubscription, latestSignals, upsertSubscription } from "@/server/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public notification configuration + per-signal delivery log (no secrets). */
export async function GET() {
  const err = await boot();
  if (err) return err;
  try {
    const [config, rows] = await Promise.all([getPublicConfig(), latestSignals(30)]);
    return json({
      config,
      recent: rows.map((r) => ({
        id: r.id,
        symbol: r.symbol,
        timeframe: r.timeframe,
        signalTime: r.signalTime.getTime(),
        created: true,
        push: !!r.pushAt,
        pushCount: r.pushCount,
        desktop: !!r.desktopAt,
        sound: !!r.soundAt,
        telegram: !!r.telegramAt,
        email: !!r.emailAt,
      })),
    });
  } catch {
    return json({ error: "database_unavailable" }, 503);
  }
}

interface SubBody {
  subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
}

/** Register a browser push subscription. */
export async function POST(req: Request) {
  const err = await boot();
  if (err) return err;
  const body = (await req.json().catch(() => ({}))) as SubBody;
  const s = body.subscription;
  if (!s?.endpoint || !s.keys?.p256dh || !s.keys?.auth) return json({ error: "invalid_subscription" }, 400);
  if (!/^https:\/\//.test(s.endpoint) || s.endpoint.length > 1000) return json({ error: "invalid_endpoint" }, 400);
  await upsertSubscription({
    endpoint: s.endpoint,
    p256dh: s.keys.p256dh,
    auth: s.keys.auth,
    userAgent: req.headers.get("user-agent")?.slice(0, 200) ?? null,
  });
  return json({ ok: true });
}

export async function DELETE(req: Request) {
  const err = await boot();
  if (err) return err;
  const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (!body.endpoint) return json({ error: "invalid_endpoint" }, 400);
  await deleteSubscription(body.endpoint);
  return json({ ok: true });
}

/** Browser acknowledgement that the sound / desktop notification fired (counted once per signal). */
export async function PATCH(req: Request) {
  const err = await boot();
  if (err) return err;
  const body = (await req.json().catch(() => ({}))) as { signalId?: string; channel?: string };
  if (!body.signalId || !/^[A-Za-z0-9.\-_]{3,80}$/.test(body.signalId)) return json({ error: "invalid_id" }, 400);
  if (body.channel !== "sound" && body.channel !== "desktop") return json({ error: "invalid_channel" }, 400);
  const first = await ackClientChannel(body.signalId, body.channel).catch(() => false);
  return json({ ok: true, first });
}
