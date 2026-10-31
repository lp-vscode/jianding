import { describe, expect, it } from "vitest";
import type { TradingBacktestResult } from "../types";
import { runMonteCarloBacktest } from "./monte-carlo";

function resultWithCurve(values: number[]): TradingBacktestResult {
  return {
    id: "mc",
    symbol: "sh600519",
    ranAt: 1,
    shortWindow: 5,
    longWindow: 20,
    initialCapital: 100_000,
    finalEquity: values.at(-1) ?? 100_000,
    totalReturn: 8,
    maxDrawdown: 6,
    winRate: 60,
    profitFactor: 1.8,
    tradeCount: 8,
    equityCurve: values.map((value, index) => ({
      label: String(index),
      value,
    })),
    riskPassed: true,
  };
}

describe("monte carlo robustness", () => {
  const values = Array.from(
    { length: 91 },
    (_, index) => 100_000 + index * 170 + Math.sin(index / 3) * 1_800,
  );

  it("returns deterministic percentile bands for the same seed", () => {
    const first = runMonteCarloBacktest(resultWithCurve(values), {
      simulations: 300,
      seed: 42,
      riskDrawdownPct: 12,
    });
    const second = runMonteCarloBacktest(resultWithCurve(values), {
      simulations: 300,
      seed: 42,
      riskDrawdownPct: 12,
    });

    expect(first).toEqual(second);
    expect(first?.bands).toHaveLength(21);
    expect(first?.bands[0].median).toBe(0);
    expect(first?.probabilityPositive).toBeGreaterThanOrEqual(0);
    expect(first?.probabilityPositive).toBeLessThanOrEqual(1);
    expect(first?.probabilityWithinRisk).toBeGreaterThanOrEqual(0);
    expect(first?.probabilityWithinRisk).toBeLessThanOrEqual(1);
  });

  it("keeps return percentiles ordered", () => {
    const result = runMonteCarloBacktest(resultWithCurve(values), {
      simulations: 500,
      seed: 7,
    });

    expect(result?.p05Return).toBeLessThanOrEqual(result?.medianReturn ?? 0);
    expect(result?.medianReturn).toBeLessThanOrEqual(result?.p95Return ?? 0);
    expect(result?.worstReturn).toBeLessThanOrEqual(result?.bestReturn ?? 0);
    expect(result?.p95MaxDrawdown).toBeGreaterThanOrEqual(result?.medianMaxDrawdown ?? 0);
  });

  it("refuses to score a curve with too few observations", () => {
    expect(runMonteCarloBacktest(resultWithCurve([100_000, 101_000, 99_000]))).toBeNull();
  });
});
