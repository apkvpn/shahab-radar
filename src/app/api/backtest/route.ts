import { boot, json } from "@/server/api";
import { runBacktest } from "@/server/backtest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The password is read only on the server and is never shipped to the browser bundle.
const REPORT_PASSWORD = process.env.REPORT_PASSWORD ?? "1213";
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { password?: unknown; scope?: unknown };
  if (typeof body.password !== "string" || body.password !== REPORT_PASSWORD) return json({ error: "unauthorized" }, 401);
  const err = await boot();
  if (err) return err;
  const scope = body.scope === "all" ? "all" : typeof body.scope === "string" ? body.scope : "all";
  try {
    return json(await runBacktest(scope));
  } catch (e) {
    const message = e instanceof Error && e.message === "market_not_ready" ? e.message : "backtest_unavailable";
    return json({ error: message }, message === "market_not_ready" ? 409 : 503);
  }
}
