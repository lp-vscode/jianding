import { describe, expect, it } from "vitest";
import type { AlertRule, Quote, TrendPoint } from "../types";
import { alertRuleSummary, isConditionTriggered, isTriggered } from "./alerts";

function quote(patch: Partial<Quote> = {}): Quote {
  return {
    symbol: "sh600519",
    code: "600519",
    name: "贵州茅台",
    price: 1300,
    previousClose: 1280,
    change: 20,
    changePct: 1.56,
    open: 1285,
    high: 1310,
    low: 1278,
    volume: 3_000_000,
    amount: 4_000_000_000,
    updatedAt: "2026-10-23T06:30:00",
    navDate: null,
    state: "live",
    source: "测试",
    ...patch,
  };
}

function rule(patch: Partial<AlertRule> = {}): AlertRule {
  return {
    id: "alert_1",
    symbol: "sh600519",
    type: "priceAbove",
    threshold: 1290,
    enabled: true,
    createdAt: 1,
    lastTriggeredAt: null,
    ...patch,
  };
}

describe("alert conditions", () => {
  it("keeps legacy single-condition rules compatible", () => {
    expect(isTriggered(rule(), quote())).toBe(true);
  });

  it("requires every condition in all mode", () => {
    const composite = rule({
      conditions: [
        { type: "priceAbove", threshold: 1290 },
        { type: "amountAbove", threshold: 50 },
      ],
      logic: "all",
    });
    expect(isTriggered(composite, quote({ amount: 4_000_000_000 }))).toBe(false);
    expect(isTriggered(composite, quote({ amount: 6_000_000_000 }))).toBe(true);
  });

  it("accepts either direction in any mode", () => {
    const composite = rule({
      conditions: [
        { type: "pctAbove", threshold: 5 },
        { type: "pctBelow", threshold: 5 },
      ],
      logic: "any",
    });
    expect(isTriggered(composite, quote({ changePct: -6 }))).toBe(true);
    expect(isTriggered(composite, quote({ changePct: 2 }))).toBe(false);
  });

  it("summarizes composite conditions with the configured logic", () => {
    const composite = rule({
      conditions: [
        { type: "priceAbove", threshold: 1350 },
        { type: "amountAbove", threshold: 10 },
      ],
      logic: "all",
    });
    expect(alertRuleSummary(composite)).toBe("涨破 1,350.00 且 成交额 10.00 亿");
  });

  it("evaluates technical and holdings-aware conditions", () => {
    const rising: TrendPoint[] = [1, 2, 3, 4].map((value, index) => ({ label: String(index), value }));
    expect(isConditionTriggered({ type: "rsiAbove", threshold: 70, period: 2 }, quote(), { trend: rising })).toBe(true);
    expect(
      isConditionTriggered({ type: "gapUp", threshold: 0.5 }, quote({ open: 1290, previousClose: 1280 })),
    ).toBe(true);
    expect(
      isConditionTriggered({ type: "pnlAbove", threshold: 10 }, quote({ price: 1160 }), { holdingCost: 1000 }),
    ).toBe(true);
  });

  it("detects a moving-average golden cross", () => {
    const points: TrendPoint[] = [10, 10, 10, 10, 4, 20].map((value, index) => ({
      label: String(index),
      value,
    }));
    expect(
      isConditionTriggered(
        { type: "smaGolden", threshold: 1, period: 3, secondaryPeriod: 5 },
        quote(),
        { trend: points },
      ),
    ).toBe(true);
  });
});
