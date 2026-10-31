import { describe, expect, it } from "vitest";
import type { Asset, Quote, TrendPoint } from "../types";
import {
  calculateTradingStats,
  defaultTradingLedger,
  evaluateTradingAgent,
  evaluateSmaCross,
  matchPendingTradingOrders,
  riskExitForPosition,
  runSmaBacktest,
  sanitizeTradingLedger,
  submitTradingOrder,
} from "./trading";

const asset: Asset = {
  symbol: "sh600519",
  code: "600519",
  name: "贵州茅台",
  kind: "stock",
  market: "sh",
  typeLabel: "A股",
  addedAt: 1,
};

function quote(patch: Partial<Quote> = {}): Quote {
  return {
    symbol: asset.symbol,
    code: asset.code,
    name: asset.name,
    price: 10,
    previousClose: 9.8,
    change: 0.2,
    changePct: 2.04,
    open: 9.9,
    high: 10.2,
    low: 9.7,
    volume: 1_000_000,
    amount: 10_000_000,
    updatedAt: "2026-10-23T06:30:00",
    navDate: null,
    state: "live",
    source: "测试",
    ...patch,
  };
}

describe("paper trading execution", () => {
  it("fills market buys with slippage and commission", () => {
    const ledger = defaultTradingLedger(1, asset.symbol);
    const result = submitTradingOrder(
      ledger,
      { symbol: asset.symbol, side: "buy", type: "market", quantity: 1000 },
      asset,
      quote(),
      2,
    );
    expect(result.error).toBeNull();
    expect(result.fill?.quantity).toBe(1000);
    expect(result.fill?.price).toBeCloseTo(10.005);
    expect(result.fill?.fee).toBeCloseTo(5.0025);
    expect(ledger.positions[0].quantity).toBe(1000);
    expect(ledger.cash).toBeCloseTo(1_000_000 - 10_005 - 5.0025);
  });

  it("keeps limit orders pending until the quote reaches the limit", () => {
    const ledger = defaultTradingLedger(1, asset.symbol);
    const result = submitTradingOrder(
      ledger,
      { symbol: asset.symbol, side: "buy", type: "limit", quantity: 1000, limitPrice: 9.5 },
      asset,
      quote(),
      2,
    );
    expect(result.order?.status).toBe("pending");
    expect(result.fill).toBeNull();

    const fills = matchPendingTradingOrders(
      ledger,
      { [asset.symbol]: quote({ price: 9.4 }) },
      () => asset,
      3,
    );
    expect(fills).toHaveLength(1);
    expect(ledger.positions[0].quantity).toBe(1000);
  });

  it("realizes net profit after fees when a position is sold", () => {
    const ledger = defaultTradingLedger(1, asset.symbol);
    submitTradingOrder(
      ledger,
      { symbol: asset.symbol, side: "buy", type: "market", quantity: 1000 },
      asset,
      quote(),
      2,
    );
    const sell = submitTradingOrder(
      ledger,
      { symbol: asset.symbol, side: "sell", type: "market", quantity: 1000 },
      asset,
      quote({ price: 11 }),
      3,
    );
    expect(sell.fill?.side).toBe("sell");
    expect(ledger.realizedPnl).toBeGreaterThan(0);
    expect(ledger.positions).toHaveLength(0);
  });
});

describe("trading analytics and signals", () => {
  it("calculates drawdown from the equity curve", () => {
    const ledger = defaultTradingLedger(1, asset.symbol);
    ledger.cash = 1_100_000;
    ledger.equityCurve = [
      { at: 1, equity: 1_000_000, cash: 1_000_000, marketValue: 0 },
      { at: 2, equity: 900_000, cash: 900_000, marketValue: 0 },
      { at: 3, equity: 1_100_000, cash: 1_100_000, marketValue: 0 },
    ];
    const stats = calculateTradingStats(ledger, {});
    expect(stats.maxDrawdown).toBeCloseTo(10);
    expect(stats.totalReturn).toBeCloseTo(10);
  });

  it("detects a short-over-long moving-average cross", () => {
    const points: TrendPoint[] = [10, 10, 10, 10, 4, 20].map((value, index) => ({
      label: String(index),
      value,
    }));
    const evaluation = evaluateSmaCross(points, 3, 5, null, quote());
    expect(evaluation?.action).toBe("buy");
    expect(evaluation?.cross).toBe("above");
  });

  it("runs a close-price backtest and records an equity curve", () => {
    const ledger = defaultTradingLedger(1, asset.symbol);
    ledger.strategy.shortWindow = 3;
    ledger.strategy.longWindow = 5;
    const values = [10, 10, 10, 10, 4, 20, 24, 20, 16, 12, 10, 8];
    const result = runSmaBacktest(
      values.map((value, index) => ({ label: String(index), value })),
      ledger.strategy,
      asset,
      ledger.risk,
      100_000,
    );
    expect(result.equityCurve).toHaveLength(values.length);
    expect(result.tradeCount).toBeGreaterThan(0);
    expect(result.finalEquity).toBeGreaterThan(0);
  });

  it("preserves saved backtest versions when restoring the ledger", () => {
    const ledger = defaultTradingLedger(1, asset.symbol);
    const result = runSmaBacktest(
      [10, 10, 11, 12, 11, 13, 14].map((value, index) => ({
        label: String(index),
        value,
      })),
      ledger.strategy,
      asset,
      ledger.risk,
      100_000,
    );
    ledger.backtest = result;
    ledger.backtestHistory = [result];

    const restored = sanitizeTradingLedger(ledger, asset.symbol);
    expect(restored.backtest?.id).toBe(result.id);
    expect(restored.backtestHistory).toHaveLength(1);
    expect(restored.backtestHistory[0].equityCurve).toEqual(result.equityCurve);
  });

  it("blocks automated execution before a backtest exists", () => {
    const ledger = defaultTradingLedger(1, asset.symbol);
    const signal = {
      id: "signal_1",
      symbol: asset.symbol,
      action: "buy" as const,
      reason: "测试交叉",
      price: 10,
      shortMa: 10,
      longMa: 9,
      at: 2,
      orderId: null,
    };
    const decision = evaluateTradingAgent(
      ledger,
      signal,
      quote(),
      100,
      calculateTradingStats(ledger, { [asset.symbol]: quote() }),
      3,
    );
    expect(decision.action).toBe("block");
    expect(decision.riskFlags).toContain("尚未完成回测");
  });

  it("raises a stop-loss exit after the configured loss threshold", () => {
    const ledger = defaultTradingLedger(1, asset.symbol);
    const exit = riskExitForPosition(
      {
        symbol: asset.symbol,
        quantity: 100,
        averageCost: 100,
        realizedPnl: 0,
        openedAt: 1,
        updatedAt: 1,
      },
      quote({ price: 90 }),
      ledger.risk,
    );
    expect(exit?.reason).toBe("触发止损");
  });
});
