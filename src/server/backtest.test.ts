import assert from "node:assert/strict";
import { summarizeTrades, type TradeResult } from "./backtest";

const trade = (id: string, entryTime: number, win: boolean): TradeResult => ({
  id,
  symbol: "TEST",
  entryTime,
  entryPrice: 100,
  takeProfit: 125,
  stopLoss: 75,
  exitTime: entryTime + 86_400_000,
  exitPrice: win ? 125 : 75,
  exitReason: win ? "TAKE_PROFIT_25" : "STOP_LOSS_25",
  grossPct: win ? 25 : -25,
  slippagePct: 0,
  feesPct: 0,
  netPct: win ? 25 : -25,
});

const trades = [
  ...Array.from({ length: 88 }, (_, i) => trade(`win-${i}`, i * 2, true)),
  ...Array.from({ length: 7 }, (_, i) => trade(`loss-${i}`, (176 + i) * 2, false)),
];
const result = summarizeTrades(trades, 100, 1 / 95);

assert.equal(result.tradeCount, 95);
assert.equal(result.closed, 95);
assert.equal(result.takeProfits, 88);
assert.equal(result.stopLosses, 7);
assert.equal(result.open, 0);
assert.equal(result.unknown, 0);
assert.equal(result.grossProfitPct, 2200);
assert.equal(result.grossLossPct, -175);
assert.equal(result.grossPnlPct, 2025);
assert.equal(result.simpleNetPnlPct, 2025);
assert.ok(Math.abs((result.averageTradeReturnPct ?? 0) - 21.31578947368421) < 1e-12);
assert.equal(result.totalFeesPct, 0);
assert.equal(result.totalSlippagePct, 0);
assert.ok(Number.isFinite(result.finalCapital));
assert.ok(result.accountReturnPct > 0);

const overlap = summarizeTrades([trade("a", 1, true), trade("b", 2, false)], 100, 1);
assert.equal(overlap.finalCapital, 93.75);

console.log(JSON.stringify({
  passed: true,
  grossProfitPct: result.grossProfitPct,
  grossLossPct: result.grossLossPct,
  simpleNetPnlPct: result.simpleNetPnlPct,
  averageTradeReturnPct: result.averageTradeReturnPct,
  accountReturnPct: result.accountReturnPct,
}));
