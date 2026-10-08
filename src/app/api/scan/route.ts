import { boot, json } from "@/server/api";
import { scanNow } from "@/server/scanner";
import { buildStatus } from "@/server/views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST = immediate scan ("اسکن فوری"). GET = current status. */
export async function POST() {
  const err = await boot();
  if (err) return err;
  const ran = await scanNow();
  return json({ ok: true, ran, status: buildStatus() });
}

export async function GET() {
  const err = await boot();
  if (err) return err;
  return json({ status: buildStatus() });
}
