import { describe, expect, it } from "vitest";
import {
  parseSinaMarketRows,
  parseStockFundamentals,
  parseStockNews,
  preScreenMarketStocks,
} from "./market-research";

describe("market research adapters", () => {
  it("parses and filters the full-market quote payload", () => {
    const stocks = parseSinaMarketRows([
      {
        symbol: "sh600519",
        code: "600519",
        name: "贵州茅台",
        trade: "1392.05",
        changepercent: 2.81,
        amount: 8_257_000_000,
        per: 22.5,
        pb: 8.2,
        mktcap: 1_748_700_000,
        turnoverratio: 0.62,
      },
      { symbol: "bj920001", code: "920001", name: "北交所样本" },
    ]);

    expect(stocks).toHaveLength(1);
    expect(stocks[0].symbol).toBe("sh600519");
    expect(stocks[0].industry).toBe("白酒消费");
    expect(stocks[0].marketCap).toBe(17_487_000_000_000);
  });

  it("pre-screens liquid non-ST stocks", () => {
    const stocks = parseSinaMarketRows([
      {
        symbol: "sh600519",
        code: "600519",
        name: "贵州茅台",
        trade: "1392.05",
        changepercent: 2.81,
        amount: 8_257_000_000,
        per: 22.5,
        pb: 8.2,
        mktcap: 1_748_700_000,
        turnoverratio: 0.62,
      },
      {
        symbol: "sh688066",
        code: "688066",
        name: "*ST航图",
        trade: "5.57",
        changepercent: 20,
        amount: 9_000_000_000,
        per: -2,
        pb: -1,
        mktcap: 170_900,
        turnoverratio: 20,
      },
    ]);

    const selected = preScreenMarketStocks(stocks, 10);
    expect(selected.map((stock) => stock.code)).toEqual(["600519"]);
  });

  it("parses financial reports and news snippets", () => {
    const fundamentals = parseStockFundamentals({
      success: true,
      result: {
        data: [{
          REPORTDATE: "2026-09-30 00:00:00",
          DATATYPE: "2026年 三季报",
          TOTAL_OPERATE_INCOME: 133_283_652_508.95,
          YSTZ: 1.8179,
          PARENT_NETPROFIT: 64_467_425_981.95,
          SJLTZ: -0.25,
          WEIGHTAVG_ROE: 24.47,
          XSMLL: 89.58,
          BASIC_EPS: 51.53,
          PUBLISHNAME: "白酒Ⅱ",
        }],
      },
    });
    const news = parseStockNews({
      result: {
        cmsArticleWebOld: [{
          code: "1",
          title: "贵州茅台发布三季报",
          content: "营收保持增长",
          mediaName: "证券时报",
          date: "2026-10-30 21:16:32",
          url: "http://example.com/a",
        }],
      },
    });

    expect(fundamentals?.roe).toBe(24.47);
    expect(fundamentals?.industry).toBe("白酒Ⅱ");
    expect(news[0].url).toBe("https://example.com/a");
  });
});
