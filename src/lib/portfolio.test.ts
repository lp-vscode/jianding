import { describe, expect, it } from "vitest";
import { buildPortfolioPulse } from "./portfolio";

describe("buildPortfolioPulse", () => {
  it("models an empty portfolio without inventing values", () => {
    expect(buildPortfolioPulse([], 0)).toEqual({
      mood: "等待建仓",
      concentration: "--",
      contributorLabel: "今日贡献",
      contributorName: "--",
    });
  });

  it("describes warming, high concentration and the largest positive contribution", () => {
    expect(
      buildPortfolioPulse(
        [
          { name: "贵州茅台", weight: 78, dayPnl: 3805 },
          { name: "沪深300ETF", weight: 22, dayPnl: -120 },
        ],
        1.28,
      ),
    ).toEqual({
      mood: "升温",
      concentration: "高集中 78%",
      contributorLabel: "今日贡献",
      contributorName: "贵州茅台",
    });
  });

  it("names the largest absolute loss as the main drag", () => {
    expect(
      buildPortfolioPulse(
        [
          { name: "宁德时代", weight: 55, dayPnl: -840 },
          { name: "沪深300ETF", weight: 45, dayPnl: 90 },
        ],
        -0.7,
      ),
    ).toMatchObject({
      mood: "降温",
      concentration: "偏集中 55%",
      contributorLabel: "最大拖累",
      contributorName: "宁德时代",
    });
  });
});
