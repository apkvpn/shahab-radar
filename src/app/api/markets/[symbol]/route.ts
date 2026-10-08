import { SYMBOL_RE, boot, json } from "@/server/api";
import { marketRow } from "@/server/views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const err = await boot();
  if (err) return err;
  const symbol = (await ctx.params).symbol.toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return json({ error: "invalid_symbol" }, 400);
  const row = marketRow(symbol);
  if (!row) return json({ error: "not_monitored" }, 404);
  return json(row);
}
