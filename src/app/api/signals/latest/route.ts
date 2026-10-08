import type { NextRequest } from "next/server";
import { boot, json, num } from "@/server/api";
import { latestSignals, toPublic } from "@/server/repo";
import { isTimeframe } from "@/lib/shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const err = await boot();
  if (err) return err;
  const limit = num(req.nextUrl.searchParams.get("limit"), 15, 1, 100);
  const timeframe = req.nextUrl.searchParams.get("timeframe") ?? undefined;
  if (timeframe && !isTimeframe(timeframe)) return json({ error: "invalid_timeframe" }, 400);
  try {
    const rows = await latestSignals(limit, timeframe);
    return json({ items: rows.map(toPublic) });
  } catch {
    return json({ error: "database_unavailable" }, 503);
  }
}
