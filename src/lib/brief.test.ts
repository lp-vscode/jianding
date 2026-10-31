import { describe, expect, it } from "vitest";
import type { Asset, IndexQuote, Quote } from "../types";
import { buildMarketBrief } from "./brief";

function asset(symbol: string, name: string): Asset {
  return {
    symbol,
    name,
    code: symbol.slice(2),
    kind: "stock",
    market: symbol.startsWith("sh") ? "sh" : "sz",
    typeLabel: "A股",
    addedAt: 1,
  };
}

function quote(base: Asset, changePct: number): Quote {
  return {
    symbol: base.symbol,
    code: base.code,
    name: base.name,
    price: 10,
    previousClose: 10,
    change: 0,
    changePct,
    open: 10,
    high: 10,
    low: 10,
    volume: 100,
    amount: 1000,
    updatedAt: "2026-10-31T10:00:00",
    navDate: null,
    state: "live",
    source: "测试",
  };
}

describe("market brief", () => {
  it("summarizes breadth, extremes, and the benchmark comparison", () => {
    const assets = [asset("sh600519", "贵州茅台"), asset("sz300750", "宁德时代")];
    const quotes = {
      sh600519: quote(assets[0], 2.4),
      sz300750: quote(assets[1], -1.6),
    };
    const indices: IndexQuote[] = [
      { symbol: "sh000300", name: "沪深300", price: 4000, change: -20, changePct: -0.5 },
    ];

    const brief = buildMarketBrief(assets, quotes, [], indices, false);

    expect(brief.upCount).toBe(1);
    expect(brief.downCount).toBe(1);
    expect(brief.averageChange).toBeCloseTo(0.4);
    expect(brief.strongest?.asset.name).toBe("贵州茅台");
    expect(brief.weakest?.asset.name).toBe("宁德时代");
    expect(brief.spread).toBeCloseTo(4);
    expect(brief.relativeChange).toBeCloseTo(0.9);
    expect(brief.headline).toBe("贵州茅台领涨，宁德时代承压");
  });

  it("prioritizes data freshness when the snapshot is stale", () => {
    const stock = asset("sh600519", "贵州茅台");
    const brief = buildMarketBrief(
      [stock],
      { sh600519: quote(stock, 2.4) },
      [],
      [],
      true,
    );

    expect(brief.stale).toBe(true);
    expect(brief.headline).toBe("先确认行情，再读变化");
    expect(brief.detail).toContain("快照");
  });

  it("keeps a split-market headline concise with theme names", () => {
    const assets = [
      asset("sh012414", "招商中证白酒指数C"),
      asset("sh510300", "沪深300ETF华泰柏瑞"),
    ];
    const brief = buildMarketBrief(
      assets,
      {
        sh012414: quote(assets[0], 5.61),
        sh510300: quote(assets[1], -1.12),
      },
      [],
      [],
      false,
    );

    expect(brief.headline).toBe("白酒领涨，沪深300承压");
  });

  it("handles an empty or still-loading watchlist", () => {
    const empty = buildMarketBrief([], {}, [], [], false);
    expect(empty.headline).toBe("行情正在汇入");
    expect(empty.detail).toContain("没有标的");

    const stock = asset("sh600519", "贵州茅台");
    const loading = buildMarketBrief([stock], {}, [], [], false);
    expect(loading.headline).toBe("行情正在汇入");
    expect(loading.observedCount).toBe(0);
  });
});
