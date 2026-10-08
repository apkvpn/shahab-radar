import type { NextRequest } from "next/server";
import { isTimeframe } from "@/lib/shared";
import { boot, json } from "@/server/api";
import { buildStatus, marketRows } from "@/server/views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const err = await boot();
  if (err) return err;
  const tf = req.nextUrl.searchParams.get("timeframe");
  let items = marketRows();
  if (tf && isTimeframe(tf)) {
    items = items.map((r) => ({ ...r, states: r.states.filter((s) => s.timeframe === tf) }));
  }
  if (req.nextUrl.searchParams.get("long") === "1") {
    items = items.filter((r) => r.states.some((s) => s.signal === "LONG"));
  }
  return json({ items, status: buildStatus() });
}
