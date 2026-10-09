import { fetchKlines } from "./binance";
import { analyze, type Candle } from "./engine";
import { getState, type UniverseItem } from "./core";
import { pool } from "@/db";

export const TAKE_PROFIT = 0.25;
export const STOP_LOSS = 0.25;
export const FEE_RATE = 0.001;
export const SLIPPAGE_RATE = 0.0005;
const MAX_BARS = 5000;

export type ExitReason = "TAKE_PROFIT_25" | "STOP_LOSS_25" | "OPEN" | "UNKNOWN";

export type TradeResult = {
  id: string;
  symbol: string;
  entryTime: number;
  /** Actual executed buy price, including entry slippage. */
  entryPrice: number;
  takeProfit: number;
  stopLoss: number;
  exitTime: number | null;
  /** Actual executed sell price, including exit slippage. */
  exitPrice: number | null;
  exitReason: ExitReason;
  /** Ideal strategy return before fees and execution slippage. */
  grossPct: number | null;
  /** Positive cost percentage caused by entry and exit slippage. */
  slippagePct: number;
  /** Positive round-trip fee percentage. */
  feesPct: number;
  /** Signed realized return after slippage and fees. */
  netPct: number | null;
};

export type PerformanceMetrics = {
  grossProfitPct: number;
  grossLossPct: number;
  grossPnlPct: number;
  totalSlippagePct: number;
  totalFeesPct: number;
  simpleNetPnlPct: number;
  averageTradeReturnPct: number | null;
  initialCapital: number;
  finalCapital: number;
  accountReturnPct: number;
  tradeCount: number;
  closed: number;
  takeProfits: number;
  stopLosses: number;
  open: number;
  unknown: number;
  maxDrawdownPct: number;
};

export type AssetReport = PerformanceMetrics & {
  symbol: string;
  name: string;
  rank: number;
  start: number | null;
  end: number | null;
  /** Compatibility field: account return after compounding the asset's closed trades. */
  netPnlPct: number;
  winRate: number | null;
  tradesDetail: TradeResult[];
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

/**
 * One source of truth for report math.
 * allocationPct is the fraction of current equity allocated to each realized trade;
 * 1 means full compounding, while 1/N models equal-weight N-asset allocation.
 * OPEN and UNKNOWN trades are counted but do not change realized equity.
 */
export function summarizeTrades(trades: TradeResult[], initialCapital = 100, allocationPct = 1): PerformanceMetrics {
  const closed = trades.filter((t) => t.exitPrice != null && t.netPct != null);
  const winners = closed.filter((t) => t.exitReason === "TAKE_PROFIT_25");
  const losers = closed.filter((t) => t.exitReason === "STOP_LOSS_25");
  const grossProfitPct = winners.reduce((sum, t) => sum + (t.grossPct ?? 0), 0);
  const grossLossPct = losers.reduce((sum, t) => sum + (t.grossPct ?? 0), 0);
  const grossPnlPct = closed.reduce((sum, t) => sum + (t.grossPct ?? 0), 0);
  const totalSlippagePct = closed.reduce((sum, t) => sum + t.slippagePct, 0);
  const totalFeesPct = closed.reduce((sum, t) => sum + t.feesPct, 0);
  const simpleNetPnlPct = closed.reduce((sum, t) => sum + (t.netPct ?? 0), 0);

  let equity = initialCapital;
  let peak = initialCapital;
  let maxDrawdownPct = 0;
  const ordered = [...closed].sort((a, b) => a.entryTime - b.entryTime || a.id.localeCompare(b.id));
  for (const trade of ordered) {
    const allocated = equity * Math.min(1, Math.max(0, allocationPct));
    equity += allocated * ((trade.netPct ?? 0) / 100);
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
  }

  return {
    grossProfitPct,
    grossLossPct,
    grossPnlPct,
    totalSlippagePct,
    totalFeesPct,
    simpleNetPnlPct,
    averageTradeReturnPct: closed.length ? simpleNetPnlPct / closed.length : null,
    initialCapital,
    finalCapital: equity,
    accountReturnPct: initialCapital ? ((equity / initialCapital) - 1) * 100 : 0,
    tradeCount: trades.length,
    closed: closed.length,
    takeProfits: winners.length,
    stopLosses: losers.length,
    open: trades.filter((t) => t.exitReason === "OPEN").length,
    unknown: trades.filter((t) => t.exitReason === "UNKNOWN").length,
    maxDrawdownPct,
  };
}

export function backtestCandles(symbol: string, name: string, rank: number, candles: Candle[]): AssetReport {
  const { signals } = analyze(candles);
  const trades: TradeResult[] = [];
  for (const s of signals) {
    // The strategy entry is the signal close. Execution prices are stored separately.
    const idealEntry = s.price;
    const entry = idealEntry * (1 + SLIPPAGE_RATE);
    const tp = idealEntry * (1 + TAKE_PROFIT);
    const sl = idealEntry * (1 - STOP_LOSS);
    let exitPrice: number | null = null;
    let exitTime: number | null = null;
    let reason: ExitReason = "OPEN";
    let idealExit: number | null = null;
    for (let i = s.index + 1; i < candles.length; i++) {
      const c = candles[i];
      const hitTp = c.h >= tp;
      const hitSl = c.l <= sl;
      if (hitTp || hitSl) {
        // Daily OHLC cannot establish order when both are touched; conservative SL first.
        reason = hitSl ? "STOP_LOSS_25" : "TAKE_PROFIT_25";
        idealExit = hitSl ? sl : tp;
        exitPrice = idealExit * (1 - SLIPPAGE_RATE);
        exitTime = c.t;
        break;
      }
    }

    const grossPct = idealExit == null ? null : ((idealExit - idealEntry) / idealEntry) * 100;
    const executionPct = exitPrice == null ? null : ((exitPrice - entry) / entry) * 100;
    const slippagePct = grossPct == null || executionPct == null ? 0 : Math.max(0, grossPct - executionPct);
    const feesPct = exitPrice == null ? 0 : FEE_RATE * 2 * 100;
    const netPct = executionPct == null ? null : executionPct - feesPct;
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
      slippagePct,
      feesPct,
      netPct,
    });
  }

  const metrics = summarizeTrades(trades, 100, 1);
  return {
    ...metrics,
    symbol,
    name,
    rank,
    start: candles[0]?.t ?? null,
    end: candles[candles.length - 1]?.t ?? null,
    netPnlPct: metrics.accountReturnPct,
    winRate: metrics.closed ? (metrics.takeProfits / metrics.closed) * 100 : null,
    tradesDetail: trades,
    trades,
  };
}

export async function runBacktest(scope: "all" | string): Promise<{
  generatedAt: number;
  assumptions: Record<string, number | string>;
  assets: AssetReport[];
  portfolio: PerformanceMetrics;
}> {
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

  const portfolioTrades = assets.flatMap((asset) => asset.trades).sort((a, b) => a.entryTime - b.entryTime || a.id.localeCompare(b.id));
  const portfolio = summarizeTrades(portfolioTrades, 100, assets.length ? 1 / assets.length : 0);
  const report = {
    generatedAt: Date.now(),
    assumptions: {
      takeProfitPct: 25,
      stopLossPct: 25,
      feePctPerSide: FEE_RATE * 100,
      slippagePctPerSide: SLIPPAGE_RATE * 100,
      allocation: "equal-weight across available assets; realized returns compound chronologically",
      openTradeTreatment: "OPEN and UNKNOWN are counted but excluded from realized account equity",
      ambiguity: "daily candle touching both levels is conservatively STOP LOSS first",
    },
    assets,
    portfolio,
  };
  await pool.query(`CREATE TABLE IF NOT EXISTS backtest_reports (id bigserial primary key, scope text not null, generated_at timestamptz not null default now(), payload jsonb not null)`);
  await pool.query(`INSERT INTO backtest_reports(scope, payload) VALUES ($1, $2)`, [scope, report]);
  return report;
}
