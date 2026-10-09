import { fetchKlines } from "./binance";
import { analyze, type Candle } from "./engine";
import { getState, type UniverseItem } from "./core";
import { pool } from "@/db";

export const TAKE_PROFIT = 0.25;
export const STOP_LOSS = 0.25;
export const FEE_RATE = 0.001;
export const SLIPPAGE_RATE = 0.0005;
const MAX_BARS = 5000;

export type TradeResult = {
  id: string;
  symbol: string;
  entryTime: number;
  entryPrice: number;
  takeProfit: number;
  stopLoss: number;
  exitTime: number | null;
  exitPrice: number | null;
  exitReason: "TAKE_PROFIT_25" | "STOP_LOSS_25" | "OPEN" | "UNKNOWN";
  grossPct: number | null;
  netPct: number | null;
  feesPct: number;
  slippagePct: number;
};
export type AssetReport = {
  symbol: string;
  name: string;
  rank: number;
  start: number | null;
  end: number | null;
  signals: number;
  closed: number;
  takeProfits: number;
  stopLosses: number;
  open: number;
  unknown: number;
  netPnlPct: number;
  winRate: number | null;
  maxDrawdownPct: number;
  trades: TradeResult[];
};

async function fetchHistory(pair: string): Promise<Candle[]> {
  const all: Candle[] = [];
  let endTime: number | undefined;
  for (let page = 0; page < 8 && all.length < MAX_BARS; page++) {
    const batch = await fetchKlines(pair, "1d", 1000, undefined, endTime);
    if (!batch.length) break;
    const filtered = endTime ? batch.filter((x) => x.t < endTime!) : batch;
    if (!filtered.length) break;
    all.unshift(...filtered);
    const oldest = filtered[0].t;
    endTime = oldest - 1;
    if (filtered.length < 1000) break;
  }
  const dedup = new Map<number, Candle>();
  for (const c of all) dedup.set(c.t, c);
  return [...dedup.values()].sort((a, b) => a.t - b.t).slice(-MAX_BARS);
}

export function backtestCandles(symbol: string, name: string, rank: number, candles: Candle[]): AssetReport {
  const { signals } = analyze(candles);
  const trades: TradeResult[] = [];
  for (const s of signals) {
    const entry = s.price * (1 + SLIPPAGE_RATE);
    const tp = entry * (1 + TAKE_PROFIT);
    const sl = entry * (1 - STOP_LOSS);
    let exitPrice: number | null = null;
    let exitTime: number | null = null;
    let reason: TradeResult["exitReason"] = "OPEN";
    for (let i = s.index + 1; i < candles.length; i++) {
      const c = candles[i];
      const hitTp = c.h >= tp;
      const hitSl = c.l <= sl;
      if (hitTp || hitSl) {
        // Daily OHLC cannot establish order when both are touched; conservative SL first.
        reason = hitSl ? "STOP_LOSS_25" : "TAKE_PROFIT_25";
        exitPrice = (hitSl ? sl : tp) * (1 - SLIPPAGE_RATE);
        exitTime = c.t;
        break;
      }
    }
    const grossPct = exitPrice == null ? null : ((exitPrice - entry) / entry) * 100;
    const netPct = grossPct == null ? null : grossPct - FEE_RATE * 2 * 100;
    trades.push({
      id: `${symbol}-1d-${s.t}`,
      symbol,
      entryTime: s.t,
      entryPrice: entry,
      takeProfit: tp,
      stopLoss: sl,
      exitTime,
      exitPrice,
      exitReason: reason,
      grossPct,
      netPct,
      feesPct: FEE_RATE * 2 * 100,
      slippagePct: SLIPPAGE_RATE * 2 * 100,
    });
  }
  let equity = 100;
  let peak = 100;
  let maxDrawdown = 0;
  for (const t of trades) {
    if (t.netPct != null) equity *= 1 + t.netPct / 100;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, ((peak - equity) / peak) * 100);
  }
  const closed = trades.filter((t) => t.exitPrice != null);
  const wins = closed.filter((t) => t.exitReason === "TAKE_PROFIT_25").length;
  return {
    symbol, name, rank,
    start: candles[0]?.t ?? null,
    end: candles[candles.length - 1]?.t ?? null,
    signals: trades.length,
    closed: closed.length,
    takeProfits: wins,
    stopLosses: closed.filter((t) => t.exitReason === "STOP_LOSS_25").length,
    open: trades.filter((t) => t.exitReason === "OPEN").length,
    unknown: trades.filter((t) => t.exitReason === "UNKNOWN").length,
    netPnlPct: equity - 100,
    winRate: closed.length ? (wins / closed.length) * 100 : null,
    maxDrawdownPct: maxDrawdown,
    trades,
  };
}

export async function runBacktest(scope: "all" | string): Promise<{ generatedAt: number; assumptions: Record<string, number | string>; assets: AssetReport[]; portfolio: Record<string, number> }> {
  const st = getState();
  const selected: UniverseItem[] = scope === "all" ? st.universe : st.universe.filter((x) => x.symbol === scope.toUpperCase());
  if (!selected.length) throw new Error("market_not_ready");
  const assets: AssetReport[] = [];
  for (const m of selected.slice(0, 50)) {
    try {
      const candles = await fetchHistory(m.pair);
      if (candles.length >= 120) assets.push(backtestCandles(m.symbol, m.name, m.rank, candles));
    } catch { /* unavailable markets remain explicitly absent, never fabricated */ }
  }
  const capitalPerAsset = assets.length ? 100 / assets.length : 0;
  let portfolio = 100;
  let peak = 100;
  let drawdown = 0;
  let trades = 0, tp = 0, sl = 0;
  for (const a of assets) {
    portfolio += capitalPerAsset * (a.netPnlPct / 100);
    trades += a.closed; tp += a.takeProfits; sl += a.stopLosses;
    peak = Math.max(peak, portfolio); drawdown = Math.max(drawdown, ((peak - portfolio) / peak) * 100);
  }
  const report = { generatedAt: Date.now(), assumptions: { takeProfitPct: 25, stopLossPct: 25, feePctPerSide: FEE_RATE * 100, slippagePctPerSide: SLIPPAGE_RATE * 100, allocation: "equal-weight, non-reinvested per asset", ambiguity: "daily candle touching both levels is conservatively STOP LOSS first" }, assets, portfolio: { initialCapital: 100, finalCapital: portfolio, netPnlPct: portfolio - 100, trades, takeProfits: tp, stopLosses: sl, maxDrawdownPct: drawdown } };
  await pool.query(`CREATE TABLE IF NOT EXISTS backtest_reports (id bigserial primary key, scope text not null, generated_at timestamptz not null default now(), payload jsonb not null)`);
  await pool.query(`INSERT INTO backtest_reports(scope, payload) VALUES ($1, $2)`, [scope, report]);
  return report;
}
