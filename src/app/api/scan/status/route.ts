import { boot, json } from "@/server/api";
import { getState } from "@/server/core";
import { buildStatus } from "@/server/views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const err = await boot();
  if (err) return err;
  const st = getState();
  return json({
    status: buildStatus(),
    scan: { running: st.scan.running, lastAt: st.scan.lastAt, durationMs: st.scan.durationMs, count: st.scan.count, evaluated: st.scan.evaluated },
    pendingWrites: st.pending.length,
  });
}
