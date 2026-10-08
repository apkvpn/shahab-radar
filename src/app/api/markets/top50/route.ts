import { boot, json } from "@/server/api";
import { getState } from "@/server/core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const err = await boot();
  if (err) return err;
  const st = getState();
  return json({
    version: st.universeVersion,
    updatedAt: st.universeUpdatedAt,
    source: st.universeSource,
    excludedStable: st.excludedStable,
    unavailable: st.unavailable,
    items: st.universe.map((m) => ({ rank: m.rank, symbol: m.symbol, name: m.name, marketCap: m.marketCap })),
  });
}
