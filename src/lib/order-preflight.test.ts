import { describe, expect, it } from "vitest";
import type { Asset, Quote } from "../types";
import { defaultTradingLedger, calculateTradingStats } from "./trading";
import { buildOrderPreflight } from "./order-preflight";

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

describe("order preflight", () => {
  it("estimates fees, cash and post-trade exposure", () => {
    const ledger = defaultTradingLedger(1, asset.symbol);
    const stats = calculateTradingStats(ledger, { [asset.symbol]: quote });
    const preview = buildOrderPreflight({
      asset,
      quote,
      side: "buy",
      type: "market",
      quantity: 1000,
      ledger,
      stats,
    });

    expect(preview.canSubmit).toBe(true);
    expect(preview.normalizedQuantity).toBe(1000);
    expect(preview.fee).toBeGreaterThan(0);
    expect(preview.positionAfter).toBe(1000);
    expect(preview.projectedExposurePct).toBeCloseTo(10.01);
  });

  it("blocks a stock order below one lot", () => {
    const ledger = defaultTradingLedger(1, asset.symbol);
    const stats = calculateTradingStats(ledger, { [asset.symbol]: quote });
    const preview = buildOrderPreflight({
      asset,
      quote,
      side: "buy",
      type: "market",
      quantity: 50,
      ledger,
      stats,
    });

    expect(preview.canSubmit).toBe(false);
    expect(preview.notes.some((note) => note.tone === "error")).toBe(true);
  });

  it("blocks a sell when the position is insufficient", () => {
    const ledger = defaultTradingLedger(1, asset.symbol);
    const stats = calculateTradingStats(ledger, { [asset.symbol]: quote });
    const preview = buildOrderPreflight({
      asset,
      quote,
      side: "sell",
      type: "market",
      quantity: 100,
      ledger,
      stats,
    });

    expect(preview.canSubmit).toBe(false);
    expect(preview.notes.some((note) => note.message.includes("可卖持仓不足"))).toBe(true);
  });

  it("warns when a buy would exceed the configured position cap", () => {
    const ledger = defaultTradingLedger(1, asset.symbol);
    ledger.cash = 60_000;
    const stats = calculateTradingStats(ledger, { [asset.symbol]: quote });
    const preview = buildOrderPreflight({
      asset,
      quote,
      side: "buy",
      type: "market",
      quantity: 500,
      ledger,
      stats,
    });

    expect(preview.canSubmit).toBe(true);
    expect(preview.notes.some((note) => note.message.includes("超过 40% 上限"))).toBe(true);
  });
});
