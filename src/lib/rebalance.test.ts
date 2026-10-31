import { describe, expect, it } from "vitest";
import { buildEqualWeightRebalancePlan } from "./rebalance";

describe("buildEqualWeightRebalancePlan", () => {
  it("requires at least two positions", () => {
    expect(
      buildEqualWeightRebalancePlan([
        { symbol: "600519", name: "贵州茅台", value: 100000, weight: 100 },
      ]),
    ).toMatchObject({
      canRebalance: false,
      needsAdjustment: false,
      actions: [],
    });
  });

  it("suggests reducing the overweight and adding to the underweight position", () => {
    const plan = buildEqualWeightRebalancePlan([
      { symbol: "600519", name: "贵州茅台", value: 80000, weight: 80 },
      { symbol: "510300", name: "沪深300ETF", value: 20000, weight: 20 },
    ]);

    expect(plan).toMatchObject({
      canRebalance: true,
      needsAdjustment: true,
      targetWeight: 50,
      maxDeviation: 30,
    });
    expect(plan.actions).toEqual([
      {
        symbol: "600519",
        name: "贵州茅台",
        side: "sell",
        currentWeight: 80,
        targetWeight: 50,
        deviation: 30,
        amount: 30000,
      },
      {
        symbol: "510300",
        name: "沪深300ETF",
        side: "buy",
        currentWeight: 20,
        targetWeight: 50,
        deviation: -30,
        amount: 30000,
      },
    ]);
  });

  it("stays quiet inside the tolerance band", () => {
    const plan = buildEqualWeightRebalancePlan([
      { symbol: "A", name: "标的 A", value: 52000, weight: 52 },
      { symbol: "B", name: "标的 B", value: 48000, weight: 48 },
    ]);

    expect(plan.needsAdjustment).toBe(false);
    expect(plan.actions).toEqual([]);
    expect(plan.maxDeviation).toBe(2);
  });
});
