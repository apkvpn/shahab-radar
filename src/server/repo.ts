import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { appSettings, pushSubscriptions, signals } from "@/db/schema";
import { TIMEFRAMES, type PublicSignal, type Timeframe } from "@/lib/shared";

export type SignalRow = typeof signals.$inferSelect;
export type NewSignal = typeof signals.$inferInsert;

const DDL = `
CREATE TABLE IF NOT EXISTS signals (
  id text PRIMARY KEY,
  symbol text NOT NULL,
  name text NOT NULL,
  pair text NOT NULL,
  timeframe text NOT NULL,
  price double precision NOT NULL,
  signal_time timestamptz NOT NULL,
  candle_time timestamptz NOT NULL,
  support double precision NOT NULL,
  midline double precision NOT NULL,
  resistance double precision NOT NULL,
  market_cap_rank integer NOT NULL,
  data_source text NOT NULL,
  confirmation text NOT NULL DEFAULT 'confirmed',
  created_at timestamptz NOT NULL DEFAULT now(),
  push_at timestamptz,
  push_count integer NOT NULL DEFAULT 0,
  desktop_at timestamptz,
  sound_at timestamptz,
  telegram_at timestamptz,
  email_at timestamptz
);
CREATE INDEX IF NOT EXISTS signals_time_idx ON signals (signal_time);
CREATE INDEX IF NOT EXISTS signals_sym_tf_idx ON signals (symbol, timeframe, candle_time);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint text PRIMARY KEY,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failures integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

/** Idempotent – lets the app boot against a fresh database. */
export async function ensureSchema() {
  await pool.query(DDL);
}

export function toPublic(r: SignalRow): PublicSignal {
  return {
    id: r.id,
    symbol: r.symbol,
    name: r.name,
    timeframe: r.timeframe as Timeframe,
    price: r.price,
    signalTime: r.signalTime.getTime(),
    candleTime: r.candleTime.getTime(),
    support: r.support,
    midline: r.midline,
    resistance: r.resistance,
    rank: r.marketCapRank,
    source: r.dataSource,
    confirmation: r.confirmation,
    createdAt: r.createdAt.getTime(),
  };
}

/** Returns the row only if it was newly inserted (duplicate => null). */
export async function insertSignal(row: NewSignal): Promise<SignalRow | null> {
  const r = await db.insert(signals).values(row).onConflictDoNothing().returning();
  return r[0] ?? null;
}

export async function getSignal(id: string): Promise<SignalRow | null> {
  const r = await db.select().from(signals).where(eq(signals.id, id)).limit(1);
  return r[0] ?? null;
}

export async function latestSignals(limit: number, timeframe?: string): Promise<SignalRow[]> {
  const where = timeframe
    ? and(eq(signals.confirmation, "confirmed"), inArray(signals.timeframe, TIMEFRAMES), eq(signals.timeframe, timeframe))
    : and(eq(signals.confirmation, "confirmed"), inArray(signals.timeframe, TIMEFRAMES));
  return db
    .select()
    .from(signals)
    .where(where)
    .orderBy(desc(signals.createdAt))
    .limit(limit);
}

export async function listSignals(f: {
  symbol?: string;
  timeframe?: string;
  from?: number;
  to?: number;
  order: "asc" | "desc";
  limit: number;
  offset: number;
}): Promise<{ items: SignalRow[]; total: number }> {
  const conds = [];
  if (f.symbol) conds.push(eq(signals.symbol, f.symbol));
  if (f.timeframe) conds.push(eq(signals.timeframe, f.timeframe));
  if (f.from) conds.push(gte(signals.signalTime, new Date(f.from)));
  if (f.to) conds.push(lte(signals.signalTime, new Date(f.to)));
  conds.push(inArray(signals.timeframe, TIMEFRAMES));
  const where = and(...conds);
  const items = await db
    .select()
    .from(signals)
    .where(where)
    .orderBy(f.order === "asc" ? asc(signals.signalTime) : desc(signals.signalTime), desc(signals.id))
    .limit(f.limit)
    .offset(f.offset);
  const [c] = await db.select({ count: sql<number>`count(*)::int` }).from(signals).where(where);
  return { items, total: c?.count ?? 0 };
}

export async function signalsForCombo(
  symbol: string,
  tf: string,
  fromMs: number,
  toMs: number,
): Promise<SignalRow[]> {
  return db
    .select()
    .from(signals)
    .where(
      and(
        eq(signals.symbol, symbol),
        eq(signals.timeframe, tf),
        gte(signals.candleTime, new Date(fromMs)),
        lte(signals.candleTime, new Date(toMs)),
      ),
    )
    .orderBy(asc(signals.candleTime))
    .limit(1000);
}

export async function lastSignalPerCombo(): Promise<
  { symbol: string; timeframe: string; id: string; price: number; signalTime: number; candleTime: number }[]
> {
  const r = await pool.query(
    `SELECT DISTINCT ON (symbol, timeframe) id, symbol, timeframe, price, signal_time, candle_time
     FROM signals ORDER BY symbol, timeframe, signal_time DESC`,
  );
  return r.rows.map((x) => ({
    id: x.id as string,
    symbol: x.symbol as string,
    timeframe: x.timeframe as string,
    price: x.price as number,
    signalTime: new Date(x.signal_time).getTime(),
    candleTime: new Date(x.candle_time).getTime(),
  }));
}

// ---- per-channel delivery tracking (one signal = one notification per channel) -------
export type Channel = "push" | "desktop" | "sound" | "telegram" | "email";
const CH_COL: Record<Channel, string> = {
  push: "push_at",
  desktop: "desktop_at",
  sound: "sound_at",
  telegram: "telegram_at",
  email: "email_at",
};

/** Atomic claim: true only for the single caller that flips NULL -> now(). */
export async function claimChannel(id: string, ch: Channel): Promise<boolean> {
  const col = CH_COL[ch];
  const r = await pool.query(`UPDATE signals SET ${col} = now() WHERE id = $1 AND ${col} IS NULL RETURNING id`, [id]);
  return (r.rowCount ?? 0) > 0;
}

export async function releaseChannel(id: string, ch: Channel): Promise<void> {
  const col = CH_COL[ch];
  await pool.query(`UPDATE signals SET ${col} = NULL WHERE id = $1`, [id]);
}

export async function setPushCount(id: string, n: number): Promise<void> {
  await pool.query(`UPDATE signals SET push_count = $2 WHERE id = $1`, [id, n]);
}

// ---- settings ----------------------------------------------------------------------
export async function getSetting<T>(key: string): Promise<T | null> {
  const r = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return (r[0]?.value as T | undefined) ?? null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

// ---- push subscriptions ------------------------------------------------------------
export async function upsertSubscription(s: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}) {
  await db
    .insert(pushSubscriptions)
    .values({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, userAgent: s.userAgent ?? null })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: s.p256dh, auth: s.auth, userAgent: s.userAgent ?? null, failures: 0 },
    });
}

export async function deleteSubscription(endpoint: string) {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function listSubscriptions() {
  return db.select().from(pushSubscriptions);
}

export async function countSubscriptions(): Promise<number> {
  const [c] = await db.select({ count: sql<number>`count(*)::int` }).from(pushSubscriptions);
  return c?.count ?? 0;
}

export async function touchSubscription(endpoint: string, ok: boolean) {
  if (ok) {
    await pool.query(`UPDATE push_subscriptions SET last_success_at = now(), failures = 0 WHERE endpoint = $1`, [endpoint]);
  } else {
    await pool.query(
      `UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = $1`,
      [endpoint],
    );
    await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1 AND failures >= 8`, [endpoint]);
  }
}
