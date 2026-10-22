import { describe, expect, it } from "vitest";
import { dataDelayLimitMs, isDataDelayed } from "./market";

describe("market data freshness", () => {
  it("uses a short delay window during trading", () => {
    const trading = new Date("2026-10-23T02:00:00.000Z");
    expect(dataDelayLimitMs(15, trading)).toBe(45_000);
    expect(isDataDelayed(trading.getTime() - 30_000, 15, trading)).toBe(false);
    expect(isDataDelayed(trading.getTime() - 46_000, 15, trading)).toBe(true);
  });

  it("allows for the reduced refresh cadence while the market is closed", () => {
    const closed = new Date("2026-10-24T02:00:00.000Z");
    expect(dataDelayLimitMs(15, closed)).toBe(90_000);
    expect(isDataDelayed(closed.getTime() - 80_000, 15, closed)).toBe(false);
    expect(isDataDelayed(closed.getTime() - 91_000, 15, closed)).toBe(true);
  });
});
