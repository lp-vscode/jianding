import { describe, expect, it } from "vitest";
import { calculateTrendPerformance } from "./comparison";

describe("calculateTrendPerformance", () => {
  it("normalizes a series to its first valid value", () => {
    const result = calculateTrendPerformance([
      { label: "Day 1", value: 100 },
      { label: "Day 2", value: 110 },
      { label: "Day 3", value: 99 },
    ]);

    expect(result.points[0]?.value).toBe(0);
    expect(result.points[1]?.value).toBeCloseTo(10);
    expect(result.points[2]?.value).toBeCloseTo(-1);
    expect(result.totalReturn).toBeCloseTo(-1);
    expect(result.maxDrawdown).toBeCloseTo(-10);
    expect(result.startValue).toBe(100);
    expect(result.endValue).toBe(99);
  });

  it("handles a flat series and blank values", () => {
    const result = calculateTrendPerformance([
      { label: "Day 1", value: 0 },
      { label: "Day 2", value: 25 },
      { label: "Day 3", value: 25 },
    ]);

    expect(result.points).toEqual([
      { label: "Day 2", value: 0 },
      { label: "Day 3", value: 0 },
    ]);
    expect(result.totalReturn).toBe(0);
    expect(result.maxDrawdown).toBe(0);
  });

  it("returns a safe empty result without usable prices", () => {
    expect(calculateTrendPerformance([])).toEqual({
      points: [],
      totalReturn: 0,
      maxDrawdown: 0,
      startValue: null,
      endValue: null,
    });
  });
});
