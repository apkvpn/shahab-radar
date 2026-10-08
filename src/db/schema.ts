import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Every confirmed LONG signal. The primary key is the unique Signal ID
 * (SYMBOL-timeframe-candleOpenTimeMs) which makes duplicates impossible.
 * The *_at columns track per-channel delivery (NULL = not delivered yet).
 */
export const signals = pgTable(
  "signals",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    pair: text("pair").notNull(),
    timeframe: text("timeframe").notNull(),
    price: doublePrecision("price").notNull(),
    signalTime: timestamp("signal_time", { withTimezone: true }).notNull(),
    candleTime: timestamp("candle_time", { withTimezone: true }).notNull(),
    support: doublePrecision("support").notNull(),
    midline: doublePrecision("midline").notNull(),
    resistance: doublePrecision("resistance").notNull(),
    marketCapRank: integer("market_cap_rank").notNull(),
    dataSource: text("data_source").notNull(),
    confirmation: text("confirmation").notNull().default("confirmed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    pushAt: timestamp("push_at", { withTimezone: true }),
    pushCount: integer("push_count").notNull().default(0),
    desktopAt: timestamp("desktop_at", { withTimezone: true }),
    soundAt: timestamp("sound_at", { withTimezone: true }),
    telegramAt: timestamp("telegram_at", { withTimezone: true }),
    emailAt: timestamp("email_at", { withTimezone: true }),
  },
  (t) => [
    index("signals_time_idx").on(t.signalTime),
    index("signals_sym_tf_idx").on(t.symbol, t.timeframe, t.candleTime),
  ],
);

export const pushSubscriptions = pgTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  failures: integer("failures").notNull().default(0),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
