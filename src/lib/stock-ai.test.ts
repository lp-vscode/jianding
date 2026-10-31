import { describe, expect, it } from "vitest";
import type { Asset, Quote, TrendPoint } from "../types";
import { industryForStock, rankStockCandidates, scoreNewsSentiment } from "./stock-ai";

const asset = (code: string, name: string): Asset => ({
  symbol: `sh${code}`,
  code,
  name,
  kind: "stock",
  market: "sh",
  typeLabel: "A股",
  addedAt: 1,
});

const quote = (amount: number): Quote => ({
  symbol: "sh600519",
  code: "600519",
  name: "贵州茅台",
  price: 100,
  previousClose: 99,
  change: 1,
  changePct: 1,
  open: 99,
  high: 101,
  low: 98,
  volume: 100_000,
  amount,
  updatedAt: null,
  navDate: null,
  state: "live",
  source: "test",
});

function trend(multiplier: number, wave = 0): TrendPoint[] {
  return Array.from({ length: 90 }, (_, index) => ({
    label: String(index),
    value: 100 + index * multiplier + Math.sin(index / 4) * wave,
  }));
}

describe("AI stock screening", () => {
  it("classifies common industries and falls back to a general bucket", () => {
    expect(industryForStock(asset("600519", "贵州茅台"))).toBe("白酒消费");
    expect(industryForStock(asset("600000", "示例芯片"))).toBe("科技");
    expect(industryForStock(asset("600001", "未知标的"))).toBe("综合");
  });

  it("ranks stronger trend and risk profiles above weaker candidates", () => {
    const strong = asset("600519", "贵州茅台");
    const weak = asset("000858", "五粮液");
    const report = rankStockCandidates(
      [
        { asset: strong, quote: quote(2_000_000_000), trend: trend(0.9, 0.4) },
        { asset: weak, quote: quote(30_000_000), trend: trend(-0.8, 0.8) },
      ],
      "balanced",
    );

    expect(report.availableCount).toBe(2);
    expect(report.topPick?.symbol).toBe(strong.symbol);
    expect(report.candidates[0].score).toBeGreaterThan(report.candidates[1].score);
    expect(report.industries[0].name).toBe("白酒消费");
  });

  it("keeps short-history candidates visible but out of the ranked decision", () => {
    const short = asset("600519", "贵州茅台");
    const report = rankStockCandidates(
      [{ asset: short, quote: quote(500_000_000), trend: trend(0.1).slice(0, 10) }],
      "steady",
    );

    expect(report.topPick).toBeNull();
    expect(report.candidates[0].rating).toBe("数据不足");
    expect(report.candidates[0].warnings).toContain("历史样本偏短");
  });

  it("incorporates financial quality and news sentiment", () => {
    const strong = asset("600519", "贵州茅台");
    const report = rankStockCandidates(
      [{
        asset: strong,
        quote: quote(2_000_000_000),
        trend: trend(0.8, 0.3),
        fundamentals: {
          reportDate: "2026-09-30",
          periodLabel: "2026年三季报",
          revenue: 100_000_000_000,
          revenueGrowth: 12,
          netProfit: 30_000_000_000,
          profitGrowth: 15,
          roe: 24,
          grossMargin: 88,
          eps: 20,
          industry: "白酒Ⅱ",
        },
        news: [{
          id: "n1",
          title: "公司业绩增长并宣布分红",
          summary: "盈利超预期",
          source: "测试",
          publishedAt: "2026-10-31 10:00:00",
          url: "https://example.com",
        }],
      }],
      "balanced",
    );

    expect(report.topPick?.industry).toBe("白酒消费");
    expect(report.topPick?.factors.fundamentals).toBeGreaterThan(70);
    expect(report.topPick?.newsSentiment).toBeGreaterThan(0);
    expect(report.topPick?.reasons).toContain("近期新闻情绪偏正面");
  });

  it("scores negative news snippets below neutral", () => {
    expect(scoreNewsSentiment([{
      id: "n2",
      title: "公司遭立案调查并被减持",
      summary: "业绩下滑且存在商誉风险",
      source: "测试",
      publishedAt: "",
      url: "",
    }])).toBeLessThan(0);
  });
});
