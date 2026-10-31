import { describe, expect, it } from "vitest";
import type { AlertRule, Asset, Quote } from "../types";
import { defaultTradingLedger } from "./trading";
import { buildAlertAutomationIntent } from "./alert-automation";

const asset: Asset = {
  symbol: "sh600519",
  code: "600519",
  name: "贵州茅台",
  kind: "stock",
  market: "sh",
  typeLabel: "A股",
  addedAt: 1,
};

const quote: Quote = {
  symbol: asset.symbol,
  code: asset.code,
  name: asset.name,
  price: 100,
  previousClose: 99,
  change: 1,
  changePct: 1.01,
  open: 99,
  high: 101,
  low: 98,
  volume: 1_000_000,
  amount: 100_000_000,
  updatedAt: "2026-10-30T15:00:00",
  navDate: null,
  state: "live",
  source: "test",
};

const rule: AlertRule = {
  id: "alert_1",
  symbol: asset.symbol,
  type: "priceAbove",
  threshold: 103,
  enabled: true,
  createdAt: 1,
  lastTriggeredAt: null,
  autoTrade: { enabled: true, side: "buy", notional: 50_000 },
};

function withBacktest() {
  const ledger = defaultTradingLedger(1, asset.symbol);
  ledger.backtest = {
    id: "backtest_1",
    symbol: asset.symbol,
    ranAt: 1,
    shortWindow: 5,
    longWindow: 20,
    initialCapital: 1_000_000,
    finalEquity: 1_100_000,
    totalReturn: 10,
    maxDrawdown: 3,
    winRate: 60,
    profitFactor: 1.8,
    tradeCount: 5,
    equityCurve: [],
    riskPassed: true,
  };
  return ledger;
}

describe("alert automation", () => {
  it("returns nothing when the rule does not opt in", () => {
    expect(
      buildAlertAutomationIntent({ ...rule, autoTrade: null }, asset, quote, withBacktest()),
    ).toBeNull();
  });

  it("blocks automation until backtest risk has passed", () => {
    const ledger = defaultTradingLedger(1, asset.symbol);
    expect(buildAlertAutomationIntent(rule, asset, quote, ledger)).toMatchObject({
      quantity: 0,
      blockedReason: "尚未完成回测",
    });
  });

  it("converts notional to valid board lots after risk checks pass", () => {
    expect(buildAlertAutomationIntent(rule, asset, quote, withBacktest())).toMatchObject({
      side: "buy",
      quantity: 500,
      blockedReason: null,
    });
  });

  it("requires an existing position for automated sells", () => {
    const ledger = withBacktest();
    const sellRule: AlertRule = {
      ...rule,
      autoTrade: { enabled: true, side: "sell", notional: 50_000 },
    };
    expect(buildAlertAutomationIntent(sellRule, asset, quote, ledger)).toMatchObject({
      quantity: 0,
      blockedReason: "没有可卖持仓",
    });
  });
});
