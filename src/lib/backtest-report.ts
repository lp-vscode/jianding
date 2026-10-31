import type { TradingBacktestResult, TradingRiskConfig } from "../types";
import { formatMoney, formatPercent, formatShanghaiTime } from "./format";

export interface FullBacktestReportInput {
  assetName: string;
  symbol: string;
  versions: TradingBacktestResult[];
  risk: TradingRiskConfig;
  generatedAt?: number;
}

function markdownCell(value: string | number) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function passesCurrentRisk(version: TradingBacktestResult, risk: TradingRiskConfig) {
  return version.totalReturn > 0 && version.maxDrawdown <= risk.maxDrawdownPct;
}

export function buildFullBacktestReport({
  assetName,
  symbol,
  versions,
  risk,
  generatedAt = Date.now(),
}: FullBacktestReportInput) {
  const ordered = [...versions].sort((left, right) => right.ranAt - left.ranAt);
  const byReturn = [...ordered].sort((left, right) => right.totalReturn - left.totalReturn);
  const byDrawdown = [...ordered].sort((left, right) => left.maxDrawdown - right.maxDrawdown);
  const bestReturn = byReturn[0];
  const lowestDrawdown = byDrawdown[0];
  const riskPassed = ordered.filter((version) => passesCurrentRisk(version, risk)).length;
  const lines = [
    "# 简盯 · 完整策略回测报告",
    "",
    `- 生成时间：${formatShanghaiTime(generatedAt)}`,
    `- 标的：${assetName}（${symbol}）`,
    `- 版本范围：${ordered.length} 个已保存回测版本`,
    "- 数据口径：日线收盘价、SMA 交叉信号、历史权益曲线；结果按上海时间展示",
    "",
    "## 核心结论",
    "",
    bestReturn
      ? `- 样本内收益最高：SMA ${bestReturn.shortWindow}/${bestReturn.longWindow}，${formatPercent(bestReturn.totalReturn)}。`
      : "- 无可用回测版本。",
    lowestDrawdown
      ? `- 样本内最大回撤最低：SMA ${lowestDrawdown.shortWindow}/${lowestDrawdown.longWindow}，${lowestDrawdown.maxDrawdown.toFixed(2)}%。`
      : "",
    `- 按当前风控阈值通过：${riskPassed} / ${ordered.length} 个版本。`,
    "",
    "## 风控参数",
    "",
    "| 参数 | 当前值 |",
    "| --- | ---: |",
    `| 最大仓位 | ${risk.maxPositionPct.toFixed(1)}% |`,
    `| 最大回撤 | ${risk.maxDrawdownPct.toFixed(1)}% |`,
    `| 单日亏损上限 | ${risk.dailyLossLimitPct.toFixed(1)}% |`,
    `| 止损线 | ${risk.stopLossPct.toFixed(1)}% |`,
    `| 止盈线 | ${risk.takeProfitPct.toFixed(1)}% |`,
    "",
    "## 版本概览",
    "",
    "| # | 参数 | 运行时间 | 初始资金 | 期末权益 | 收益 | 最大回撤 | 胜率 | 交易次数 | 盈亏比 | 当前风控 |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...ordered.map(
      (version, index) =>
        `| ${index + 1} | SMA ${version.shortWindow}/${version.longWindow} | ${formatShanghaiTime(version.ranAt)} | ¥${formatMoney(version.initialCapital)} | ¥${formatMoney(version.finalEquity)} | ${formatPercent(version.totalReturn)} | ${version.maxDrawdown.toFixed(2)}% | ${version.winRate == null ? "--" : formatPercent(version.winRate)} | ${version.tradeCount} | ${version.profitFactor == null ? "--" : Number.isFinite(version.profitFactor) ? version.profitFactor.toFixed(2) : "∞"} | ${passesCurrentRisk(version, risk) ? "通过" : "未通过"} |`,
    ),
    "",
    "## 版本详情与权益曲线",
    "",
  ];

  for (const [index, version] of ordered.entries()) {
    lines.push(
      `### ${index + 1}. SMA ${version.shortWindow} / ${version.longWindow}`,
      "",
      `- 运行时间：${formatShanghaiTime(version.ranAt)}`,
      `- 初始资金：¥${formatMoney(version.initialCapital)}`,
      `- 期末权益：¥${formatMoney(version.finalEquity)}`,
      `- 总收益：${formatPercent(version.totalReturn)}`,
      `- 最大回撤：${version.maxDrawdown.toFixed(2)}%`,
      `- 胜率：${version.winRate == null ? "--" : formatPercent(version.winRate)}`,
      `- 交易次数：${version.tradeCount}`,
      `- 当前风控结论：${passesCurrentRisk(version, risk) ? "通过" : "未通过"}`,
      "",
      "| 日期/序号 | 权益 |",
      "| --- | ---: |",
      ...version.equityCurve.map(
        (point) => `| ${markdownCell(point.label)} | ¥${formatMoney(point.value)} |`,
      ),
      "",
    );
  }

  lines.push(
    "## 方法与限制",
    "",
    "- 回测使用保存版本自身的参数和权益曲线，报告不会重新拉取行情或改写历史结果。",
    "- 报告中的风控结论按导出时的最大回撤阈值重新判定，不沿用版本保存时的旧阈值。",
    "- 回测未覆盖停牌、涨跌停无法成交、未来数据偏差及真实券商约束，仅用于本地研究。",
    "",
    "## 风险声明",
    "",
    "历史结果不代表未来表现。参数扫描、回测和任何稳健性检验都可能受样本区间与过拟合影响，不构成投资建议。",
    "",
  );
  return lines.filter((line, index, source) => line !== "" || source[index - 1] !== "").join("\n");
}

export function backtestReportFilename(symbol: string, generatedAt = Date.now()) {
  const date = new Date(generatedAt + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "");
  return `简盯_策略回测_${symbol || "report"}_${date}.md`;
}
