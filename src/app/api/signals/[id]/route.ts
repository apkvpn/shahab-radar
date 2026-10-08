import { boot, json } from "@/server/api";
import { getSignal, toPublic } from "@/server/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const err = await boot();
  if (err) return err;
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9.\-_]{3,80}$/.test(id)) return json({ error: "invalid_id" }, 400);
  try {
    const row = await getSignal(id);
    if (!row) return json({ error: "not_found" }, 404);
    return json({
      ...toPublic(row),
      delivery: {
        created: true,
        push: !!row.pushAt,
        pushCount: row.pushCount,
        desktop: !!row.desktopAt,
        sound: !!row.soundAt,
        telegram: !!row.telegramAt,
        email: !!row.emailAt,
      },
    });
  } catch {
    return json({ error: "database_unavailable" }, 503);
  }
}
