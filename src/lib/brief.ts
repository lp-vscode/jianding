import type { AlertEvent, Asset, IndexQuote, Quote } from "../types";
import { formatPercent } from "./format";
import { intradaySignal, type IntradaySignal } from "./market";

export interface BriefQuote {
  asset: Asset;
  quote: Quote | undefined;
  changePct: number | null;
  signal: IntradaySignal | null;
}

export interface MarketBrief {
  count: number;
  observedCount: number;
  upCount: number;
  downCount: number;
  flatCount: number;
  averageChange: number | null;
  strongest: BriefQuote | null;
  weakest: BriefQuote | null;
  spread: number | null;
  benchmarkName: string | null;
  benchmarkChange: number | null;
  relativeChange: number | null;
  unreadAlerts: number;
  signals: BriefQuote[];
  stale: boolean;
  tone: "up" | "down" | "flat";
  headline: string;
  detail: string;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function preferredBenchmark(indices: IndexQuote[]) {
  return (
    indices.find((index) => index.symbol === "sh000300" || index.name === "沪深300") ??
    indices.find((index) => index.name.includes("沪深300")) ??
    null
  );
}

function headlineName(name: string) {
  const normalized = name.replace(/\s+/g, "");
  const themes: Array<[string, string]> = [
    ["沪深300", "沪深300"],
    ["中证500", "中证500"],
    ["创业板", "创业板"],
    ["白酒", "白酒"],
    ["半导体", "半导体"],
    ["医疗", "医疗"],
    ["银行", "银行"],
  ];
  const matched = themes.find(([keyword]) => normalized.includes(keyword));
  if (matched) return matched[1];
  return normalized.length > 7 ? `${normalized.slice(0, 7)}…` : normalized;
}

function headlineFor(
  observedCount: number,
  count: number,
  upCount: number,
  downCount: number,
  spread: number | null,
  relativeChange: number | null,
  stale: boolean,
  strongestName: string | null,
  weakestName: string | null,
) {
  if (!observedCount) return "行情正在汇入";
  if (stale) return "先确认行情，再读变化";
  if (observedCount < count) return "部分行情已就绪";
  if (upCount === observedCount) {
    return spread != null && spread >= 4 ? "全线走强，强弱拉开" : "自选全线向上";
  }
  if (downCount === observedCount) {
    return spread != null && spread >= 4 ? "全线回落，跌幅分化" : "自选全线回落";
  }
  if (spread != null && spread >= 4 && strongestName && weakestName) {
    return `${headlineName(strongestName)}领涨，${headlineName(weakestName)}承压`;
  }
  if (relativeChange != null && relativeChange >= 1) return "自选走势强于大盘";
  if (relativeChange != null && relativeChange <= -1) return "自选走势弱于大盘";
  if (Math.abs((upCount - downCount) / observedCount) < 0.34) return "自选窄幅分化";
  return upCount > downCount ? "自选整体偏强" : "自选整体偏弱";
}

function detailFor(
  count: number,
  observedCount: number,
  strongest: BriefQuote | null,
  weakest: BriefQuote | null,
  spread: number | null,
  benchmarkName: string | null,
  relativeChange: number | null,
  stale: boolean,
) {
  if (!count) return "当前分组没有标的，添加股票、ETF 或基金后开始汇总。";
  if (!observedCount) return "正在汇总当前分组的行情与盘中信号。";
  if (stale) return "当前展示的可能是最近一次成功快照，先刷新可避免把延迟数据当成盘中变化。";

  const leader = strongest
    ? `${strongest.asset.name} ${formatPercent(strongest.changePct)}`
    : "暂无明确领涨";
  const laggard = weakest
    ? `${weakest.asset.name} ${formatPercent(weakest.changePct)}`
    : "暂无明确领跌";
  const parts = [`${leader}，${laggard}`];
  if (spread != null && observedCount > 1) parts.push(`首尾相差 ${spread.toFixed(2)} 个百分点`);
  if (benchmarkName && relativeChange != null) {
    const relation = relativeChange >= 0 ? "高" : "低";
    parts.push(`相对${benchmarkName}${relation} ${Math.abs(relativeChange).toFixed(2)} 个百分点`);
  }
  if (observedCount < count) parts.push(`${count - observedCount} 只标的仍在等待行情`);
  return `${parts.join("；")}。`;
}

export function buildMarketBrief(
  assets: Asset[],
  quotes: Record<string, Quote>,
  events: AlertEvent[],
  indices: IndexQuote[],
  stale: boolean,
): MarketBrief {
  const observed: BriefQuote[] = assets.map((asset) => {
    const quote = quotes[asset.symbol];
    const changePct =
      quote?.changePct != null && Number.isFinite(quote.changePct) ? quote.changePct : null;
    return {
      asset,
      quote,
      changePct,
      signal: intradaySignal(quote),
    };
  });
  const priced = observed.filter(
    (item): item is BriefQuote & { changePct: number } => item.changePct != null,
  );
  const sorted = [...priced].sort((left, right) => right.changePct - left.changePct);
  const strongest = sorted[0] ?? null;
  const weakest = sorted.at(-1) ?? null;
  const averageChange = average(priced.map((item) => item.changePct));
  const benchmark = preferredBenchmark(indices);
  const spread =
    strongest && weakest ? Math.abs(strongest.changePct - weakest.changePct) : null;
  const relativeChange =
    averageChange != null && benchmark && Number.isFinite(benchmark.changePct)
      ? averageChange - benchmark.changePct
      : null;
  const upCount = priced.filter((item) => item.changePct > 0).length;
  const downCount = priced.filter((item) => item.changePct < 0).length;
  const flatCount = priced.length - upCount - downCount;
  const tone =
    averageChange == null || Math.abs(averageChange) < 0.05
      ? "flat"
      : averageChange > 0
        ? "up"
        : "down";

  return {
    count: assets.length,
    observedCount: priced.length,
    upCount,
    downCount,
    flatCount,
    averageChange,
    strongest,
    weakest,
    spread,
    benchmarkName: benchmark?.name ?? null,
    benchmarkChange: benchmark?.changePct ?? null,
    relativeChange,
    unreadAlerts: events.filter((event) => !event.read).length,
    signals: observed.filter((item) => item.signal),
    stale,
    tone,
    headline: headlineFor(
      priced.length,
      assets.length,
      upCount,
      downCount,
      spread,
      relativeChange,
      stale,
      strongest?.asset.name ?? null,
      weakest?.asset.name ?? null,
    ),
    detail: detailFor(
      assets.length,
      priced.length,
      strongest,
      weakest,
      spread,
      benchmark?.name ?? null,
      relativeChange,
      stale,
    ),
  };
}
