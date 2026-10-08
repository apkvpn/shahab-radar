import { db } from "@/db";
import { sql } from "drizzle-orm";
import { ensureStarted } from "@/server/bootstrap";
import { getState } from "@/server/core";
import { buildStatus } from "@/server/views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  // make sure the background scanner is running (non-blocking)
  ensureStarted().catch(() => {});
  try {
    await db.execute(sql`select 1`);
  } catch {
    return Response.json({ ok: false, db: false }, { status: 500 });
  }
  const s = buildStatus();
  return Response.json(
    {
      ok: true,
      db: true,
      system: s.system,
      scanner: { running: getState().started, lastScanAt: s.lastScanAt, scans: s.scanCount, intervalSec: s.scanIntervalSec },
      feed: s.feed,
      stale: s.stale,
      markets: s.markets,
      combos: s.combos,
      synced: s.synced,
      uptimeSec: Math.round((Date.now() - getState().startedAt) / 1000),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
