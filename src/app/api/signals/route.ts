import type { NextRequest } from "next/server";
import { isTimeframe } from "@/lib/shared";
import { SYMBOL_RE, boot, json, num } from "@/server/api";
import { listSignals, toPublic } from "@/server/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const err = await boot();
  if (err) return err;
  const sp = req.nextUrl.searchParams;
  const symbol = sp.get("symbol")?.toUpperCase();
  const tf = sp.get("timeframe");
  if (symbol && !SYMBOL_RE.test(symbol)) return json({ error: "invalid_symbol" }, 400);
  if (tf && !isTimeframe(tf)) return json({ error: "invalid_timeframe" }, 400);
  const from = Number(sp.get("from"));
  const to = Number(sp.get("to"));
  const limit = num(sp.get("limit"), 50, 1, 1000);
  const offset = num(sp.get("offset"), 0, 0, 100_000);
  try {
    const { items, total } = await listSignals({
      symbol: symbol || undefined,
      timeframe: tf || undefined,
      from: Number.isFinite(from) && from > 0 ? from : undefined,
      to: Number.isFinite(to) && to > 0 ? to : undefined,
      order: sp.get("order") === "asc" ? "asc" : "desc",
      limit,
      offset,
    });
    return json({ items: items.map(toPublic), total, limit, offset });
  } catch {
    return json({ error: "database_unavailable" }, 503);
  }
}
