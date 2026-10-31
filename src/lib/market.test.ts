import { describe, expect, it } from "vitest";
import type { Quote } from "../types";
import { dataDelayLimitMs, intradaySignal, isDataDelayed } from "./market";
import { parseTencentQuotes } from "./web-market";

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

  it("derives restrained intraday signals from available quote fields", () => {
    const quote: Quote = {
      symbol: "sh600519",
      code: "600519",
      name: "贵州茅台",
      price: 1300,
      previousClose: 1280,
      change: 20,
      changePct: 2.5,
      open: 1285,
      high: 1301,
      low: 1278,
      volume: 3_000_000,
      amount: 4_000_000_000,
      updatedAt: "2026-10-23T06:30:00",
      navDate: null,
      state: "live",
      source: "测试",
    };
    expect(intradaySignal(quote)?.key).toBe("nearHigh");
    expect(intradaySignal({ ...quote, changePct: 6 })?.key).toBe("surge");
    expect(intradaySignal({ ...quote, symbol: "jj012414", changePct: 6 })).toBeNull();
  });

  it("anchors Tencent fields on the security code when a legacy name adds a delimiter", () => {
    const fields = [
      "1",
      "沪深300ETF~华泰柏瑞",
      "510300",
      "4.065",
      "4.111",
      "4.059",
      "21130014",
      "12952931",
      "8177083",
      "4.065",
      "7784",
      "4.064",
      "984",
      "4.063",
      "4602",
      "4.062",
      "19066",
      "4.061",
      "62772",
      "4.066",
      "2572",
      "4.067",
      "865",
      "4.068",
      "1808",
      "4.069",
      "2356",
      "4.070",
      "11608",
      "",
      "20261030161447",
      "-0.046",
      "-1.12",
      "4.126",
      "4.046",
      "4.065/21130014/8613930896",
      "21130014",
      "861393",
    ];
    const [quote] = parseTencentQuotes(`v_sh510300="${fields.join("~")}";`);
    expect(quote).toMatchObject({
      symbol: "sh510300",
      price: 4.065,
      previousClose: 4.111,
      changePct: -1.12,
      high: 4.126,
      low: 4.046,
      updatedAt: "2026-10-30T16:14:47",
    });
  });

  it("parses 航天彩虹 when it is returned inside a mixed quote batch", () => {
    const fields = [
      "51",
      "航天彩虹",
      "002389",
      "16.09",
      "16.71",
      "16.39",
      "171227",
      "71491",
      "99736",
      "16.09",
      "253",
      "16.08",
      "565",
      "16.07",
      "62",
      "16.06",
      "363",
      "16.05",
      "144",
      "16.10",
      "344",
      "16.11",
      "287",
      "16.12",
      "251",
      "16.13",
      "18",
      "16.14",
      "3",
      "",
      "20261030161445",
      "-0.62",
      "-3.71",
      "16.72",
      "16.09",
      "16.09/171227/280354869",
      "171227",
      "28035",
    ];
    const [quote] = parseTencentQuotes(
      `v_sh600519="1~贵州茅台~600519~1392.05~1354~1363";v_sz002389="${fields.join("~")}";`,
    );

    expect(quote).toMatchObject({
      symbol: "sz002389",
      code: "002389",
      name: "航天彩虹",
      price: 16.09,
      previousClose: 16.71,
      change: -0.62,
      changePct: -3.71,
      high: 16.72,
      low: 16.09,
      amount: 280_354_869,
      updatedAt: "2026-10-30T16:14:45",
      state: "live",
    });
  });
});
