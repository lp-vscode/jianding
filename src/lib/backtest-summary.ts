import type { TradingBacktestResult } from "../types";
import { formatPercent, formatShanghaiTime } from "./format";

export function buildBacktestSummary(
  versions: TradingBacktestResult[],
  assetName: string,
  symbol: string,
) {
  const ranked = [...versions].sort((left, right) => right.totalReturn - left.totalReturn);
  const best = ranked[0];
  const lines = [
    "简盯 · 策略回放复盘",
    `标的：${assetName}（${symbol}）`,
    `比较版本：${versions.length} 个`,
    "",
    ...versions.map((version, index) => {
      const winRate = version.winRate == null ? "--" : formatPercent(version.winRate);
      return `${index + 1}. SMA ${version.shortWindow}/${version.longWindow} · ${formatShanghaiTime(version.ranAt)} · 收益 ${formatPercent(version.totalReturn)} · 最大回撤 -${version.maxDrawdown.toFixed(2)}% · 胜率 ${winRate} · 风控${version.riskPassed ? "通过" : "未通过"}`;
    }),
  ];
  if (best) {
    lines.push(
      "",
      `样本内收益最高：SMA ${best.shortWindow}/${best.longWindow}，${formatPercent(best.totalReturn)}。`,
    );
  }
  lines.push("仅比较历史回测结果，不代表未来表现。");
  return lines.join("\n");
}
