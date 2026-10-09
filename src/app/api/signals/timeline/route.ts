import { runBacktest, type TradeResult } from "@/server/backtest";
import { boot, json, num } from "@/server/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let cached: { at: number; generatedAt: number; items: Array<TradeResult & { rank: number; name: string; outcome: TradeResult["exitReason"] }> } | null = null;

export async function GET(req: Request) {
  const err = await boot();
  if (err) return err;
  const limit = num(new URL(req.url).searchParams.get("limit"), 120, 1, 300);
  try {
    if (!cached || Date.now() - cached.at > 10 * 60_000) {
      const report = await runBacktest("all");
      const items = report.assets.flatMap((asset) => asset.trades.map((trade) => ({ ...trade, rank: asset.rank, name: asset.name, outcome: trade.exitReason })));
      items.sort((a, b) => b.entryTime - a.entryTime);
      cached = { at: Date.now(), generatedAt: report.generatedAt, items };
    }
    return json({ generatedAt: cached.generatedAt, from: new Date("2015-01-01T00:00:00.000Z").getTime(), markets: 50, items: cached.items.slice(0, limit) });
  } catch {
    return json({ error: "historical_signals_unavailable" }, 503);
  }
}
