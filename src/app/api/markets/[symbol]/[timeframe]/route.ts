import type { NextRequest } from "next/server";
import { isTimeframe } from "@/lib/shared";
import { SYMBOL_RE, boot, json } from "@/server/api";
import { getChart } from "@/server/views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string; timeframe: string }> }) {
  const err = await boot();
  if (err) return err;
  const p = await ctx.params;
  const symbol = p.symbol.toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return json({ error: "invalid_symbol" }, 400);
  if (!isTimeframe(p.timeframe)) return json({ error: "invalid_timeframe" }, 400);
  const sp = req.nextUrl.searchParams;
  const focusRaw = Number(sp.get("focus"));
  const focus = Number.isFinite(focusRaw) && focusRaw > 0 ? focusRaw : 0;
  try {
    const data = await getChart(symbol, p.timeframe, { focus, live: sp.get("live") === "1" });
    if (!data) return json({ error: "data_unavailable" }, 503);
    return json(data);
  } catch {
    return json({ error: "data_unavailable" }, 502);
  }
}
