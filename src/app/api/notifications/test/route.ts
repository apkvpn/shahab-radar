import { boot, json } from "@/server/api";
import { sendTest } from "@/server/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const err = await boot();
  if (err) return err;
  const body = (await req.json().catch(() => ({}))) as { channel?: string };
  const ch = body.channel;
  if (ch !== "push" && ch !== "telegram" && ch !== "email") return json({ error: "invalid_channel" }, 400);
  const r = await sendTest(ch);
  return json(r, r.ok || r.detail === "not_configured" || r.detail === "no_subscribers" ? 200 : r.detail === "rate_limited" ? 429 : 502);
}
