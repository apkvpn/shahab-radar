import assert from "node:assert/strict";
import { findFirstTouch, summarizeTrades, tradeLevels, type TradeResult } from "./backtest";

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

const levels = tradeLevels(100);
assert.equal(levels.takeProfit, 125);
assert.equal(levels.stopLoss, 75);
const candle = (t: number, h: number, l: number) => ({ t, h, l, o: 100, c: 100, v: 1, x: true });
assert.equal(findFirstTouch([candle(1, 110, 90)], 125, 75), null);
assert.equal(findFirstTouch([candle(1, 115, 80)], 125, 75), null);
assert.equal(findFirstTouch([candle(1, 110, 75)], 125, 75)?.reason, "STOP_LOSS_25");
assert.equal(findFirstTouch([candle(1, 125, 90)], 125, 75)?.reason, "TAKE_PROFIT_25");
assert.equal(findFirstTouch([candle(1, 130, 70)], 125, 75)?.reason, "AMBIGUOUS");
assert.equal(findFirstTouch([candle(2, 110, 90), candle(3, 125, 80)], 125, 75)?.reason, "TAKE_PROFIT_25");

const ambiguousTrade: TradeResult = {
  ...trade("ambiguous", 300, true),
  exitTime: null,
  exitPrice: null,
  exitReason: "AMBIGUOUS",
  grossPct: null,
  netPct: null,
};
const mixed = summarizeTrades([trade("won", 400, true), trade("lost", 500, false), ambiguousTrade]);
assert.equal(mixed.takeProfits, 1);
assert.equal(mixed.stopLosses, 1);
assert.equal(mixed.ambiguous, 1);
assert.equal(mixed.winRate, 50);
const result = summarizeTrades(trades, 100, 1 / 95);

assert.equal(result.tradeCount, 95);
assert.equal(result.closed, 95);
assert.equal(result.takeProfits, 88);
assert.equal(result.stopLosses, 7);
assert.equal(result.winRate, (88 / 95) * 100);
assert.equal(result.open, 0);
assert.equal(result.ambiguous, 0);
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
