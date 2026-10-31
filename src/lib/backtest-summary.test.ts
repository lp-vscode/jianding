import { describe, expect, it } from "vitest";
import type { TradingBacktestResult } from "../types";
import { buildBacktestSummary } from "./backtest-summary";

function version(patch: Partial<TradingBacktestResult>): TradingBacktestResult {
  return {
    id: "bt",
    symbol: "sh600519",
    ranAt: Date.parse("2026-10-31T08:00:00Z"),
    shortWindow: 5,
    longWindow: 20,
    initialCapital: 1_000_000,
    finalEquity: 1_050_000,
    totalReturn: 5,
    maxDrawdown: 4,
    winRate: 60,
    profitFactor: 1.8,
    tradeCount: 8,
    equityCurve: [],
    riskPassed: true,
    ...patch,
  };
}

describe("backtest summary", () => {
  it("creates a copyable comparison with the leading version", () => {
    const text = buildBacktestSummary(
      [
        version({ id: "a", shortWindow: 5, longWindow: 20, totalReturn: 5 }),
        version({ id: "b", shortWindow: 10, longWindow: 30, totalReturn: 9, riskPassed: false }),
      ],
      "贵州茅台",
      "sh600519",
    );

    expect(text).toContain("标的：贵州茅台（sh600519）");
    expect(text).toContain("SMA 5/20");
    expect(text).toContain("SMA 10/30");
    expect(text).toContain("样本内收益最高：SMA 10/30，+9.00%");
    expect(text).toContain("不代表未来表现");
  });
});
