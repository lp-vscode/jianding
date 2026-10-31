import { describe, expect, it } from "vitest";
import type { TradingBacktestResult } from "../types";
import { backtestReportFilename, buildFullBacktestReport } from "./backtest-report";

const version: TradingBacktestResult = {
  id: "bt",
  symbol: "sh600519",
  ranAt: Date.parse("2026-10-31T08:00:00Z"),
  shortWindow: 10,
  longWindow: 30,
  initialCapital: 1_000_000,
  finalEquity: 1_090_000,
  totalReturn: 9,
  maxDrawdown: 4.2,
  winRate: 60,
  profitFactor: 1.8,
  tradeCount: 8,
  equityCurve: [
    { label: "2026-01-02", value: 1_000_000 },
    { label: "2026-01-05", value: 1_090_000 },
  ],
  riskPassed: true,
};

describe("full backtest report", () => {
  it("includes strategy, risk, result and equity curve evidence", () => {
    const report = buildFullBacktestReport({
      assetName: "贵州茅台",
      symbol: "sh600519",
      versions: [version],
      risk: {
        maxPositionPct: 40,
        maxDrawdownPct: 12,
        dailyLossLimitPct: 3,
        stopLossPct: 6,
        takeProfitPct: 15,
      },
      generatedAt: Date.parse("2026-10-31T09:00:00Z"),
    });

    expect(report).toContain("# 简盯 · 完整策略回测报告");
    expect(report).toContain("SMA 10/30");
    expect(report).toContain("最大回撤 | 12.0%");
    expect(report).toContain("| 2026-01-05 | ¥1,090,000.00 |");
    expect(report).toContain("按当前风控阈值通过：1 / 1 个版本");
    expect(report).toContain("历史结果不代表未来表现");
  });

  it("re-evaluates each version against the current risk threshold", () => {
    const report = buildFullBacktestReport({
      assetName: "贵州茅台",
      symbol: "sh600519",
      versions: [version],
      risk: {
        maxPositionPct: 40,
        maxDrawdownPct: 3,
        dailyLossLimitPct: 3,
        stopLossPct: 6,
        takeProfitPct: 15,
      },
    });

    expect(report).toContain("按当前风控阈值通过：0 / 1 个版本");
    expect(report).toContain("当前风控结论：未通过");
  });

  it("creates a stable Shanghai-date filename", () => {
    expect(
      backtestReportFilename("sh600519", Date.parse("2026-10-30T17:30:00Z")),
    ).toBe("简盯_策略回测_sh600519_20261031.md");
  });
});
