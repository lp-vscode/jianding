import type { Asset, Quote, TrendPoint } from "../types";
import type { StockFundamentals, StockNewsItem } from "./market-research";

export type StockAiProfile = "steady" | "balanced" | "aggressive";

export interface StockAiFactorScores {
  trend: number;
  momentum: number;
  risk: number;
  industry: number;
  liquidity: number;
  fundamentals: number;
  news: number;
}

export interface StockAiMetrics {
  return20: number;
  return60: number;
  volatility: number;
  maxDrawdown: number;
  amount: number | null;
  aboveSma20: boolean;
  shortAboveLong: boolean;
}

export interface StockAiInput {
  asset: Asset;
  quote?: Quote | null;
  trend: TrendPoint[];
  fundamentals?: StockFundamentals | null;
  news?: StockNewsItem[];
}

export interface StockAiCandidate {
  symbol: string;
  code: string;
  name: string;
  industry: string;
  score: number;
  rank: number;
  rating: "强势领先" | "趋势候选" | "中性观察" | "风险优先" | "数据不足";
  factors: StockAiFactorScores;
  metrics: StockAiMetrics;
  reasons: string[];
  warnings: string[];
  fundamentals: StockFundamentals | null;
  news: StockNewsItem[];
  newsSentiment: number;
  dataPoints: number;
  available: boolean;
}

export interface StockAiIndustry {
  name: string;
  count: number;
  averageReturn20: number;
  leaderSymbol: string | null;
}

export interface StockAiReport {
  profile: StockAiProfile;
  candidates: StockAiCandidate[];
  topPick: StockAiCandidate | null;
  industries: StockAiIndustry[];
  universeSize: number;
  availableCount: number;
}

const PROFILE_WEIGHTS: Record<StockAiProfile, StockAiFactorScores> = {
  steady: { trend: 25, momentum: 12, risk: 24, industry: 7, liquidity: 5, fundamentals: 22, news: 5 },
  balanced: { trend: 24, momentum: 19, risk: 18, industry: 8, liquidity: 5, fundamentals: 20, news: 6 },
  aggressive: { trend: 27, momentum: 28, risk: 10, industry: 8, liquidity: 5, fundamentals: 15, news: 7 },
};

const INDUSTRY_BY_CODE: Record<string, string> = {
  "600519": "白酒消费",
  "000858": "白酒消费",
  "300750": "新能源",
  "601318": "保险",
  "600036": "银行",
  "601398": "银行",
  "600900": "电力",
  "600089": "电气设备",
  "002389": "航天军工",
  "601857": "能源",
  "600030": "证券",
  "600276": "医药",
  "601888": "免税消费",
  "000333": "家电",
};

const INDUSTRY_KEYWORDS: Array<[RegExp, string]> = [
  [/银行/, "银行"],
  [/保险|平安/, "保险"],
  [/证券/, "证券"],
  [/电力|水电|能源|石油|煤炭/, "能源电力"],
  [/医药|药业|生物|医疗/, "医药"],
  [/芯片|半导体|科技|软件|信息/, "科技"],
  [/锂|电池|新能源|光伏|风电/, "新能源"],
  [/家电|电器/, "家电"],
  [/酒|食品|消费|免税/, "消费"],
  [/军工|航天|航空/, "航天军工"],
];

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentageReturn(values: number[], lookback: number) {
  if (values.length < 2) return 0;
  const end = values.at(-1) ?? 0;
  const start = values[Math.max(0, values.length - 1 - lookback)] ?? end;
  return start > 0 ? ((end - start) / start) * 100 : 0;
}

function maxDrawdown(values: number[]) {
  let peak = values[0] ?? 0;
  let drawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) drawdown = Math.max(drawdown, ((peak - value) / peak) * 100);
  }
  return drawdown;
}

function volatility(values: number[]) {
  const returns = values.flatMap((value, index) => {
    const previous = values[index - 1];
    return index > 0 && previous > 0 ? [(value - previous) / previous] : [];
  });
  if (returns.length < 2) return 0;
  const mean = average(returns);
  const variance = average(returns.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export function industryForStock(asset: Asset, fallbackIndustry?: string | null) {
  const keywordIndustry = INDUSTRY_KEYWORDS.find(([pattern]) => pattern.test(asset.name))?.[1];
  const reportIndustry = fallbackIndustry?.replace(/Ⅱ|Ⅲ/g, "").trim() || undefined;
  return INDUSTRY_BY_CODE[asset.code] ?? keywordIndustry ?? reportIndustry ?? "综合";
}

function ratingFor(score: number, available: boolean): StockAiCandidate["rating"] {
  if (!available) return "数据不足";
  if (score >= 76) return "强势领先";
  if (score >= 62) return "趋势候选";
  if (score >= 48) return "中性观察";
  return "风险优先";
}

function buildWarnings(
  metrics: StockAiMetrics,
  points: number,
  fundamentals: StockFundamentals | null,
) {
  const warnings: string[] = [];
  if (points < 40) warnings.push("历史样本偏短");
  if (metrics.maxDrawdown > 15) warnings.push(`区间回撤 ${metrics.maxDrawdown.toFixed(1)}%`);
  if (metrics.volatility > 42) warnings.push(`年化波动 ${metrics.volatility.toFixed(0)}%`);
  if (metrics.return20 < 0) warnings.push("20 日动量为负");
  if (metrics.amount != null && metrics.amount < 50_000_000) warnings.push("成交额偏低");
  if (!metrics.aboveSma20) warnings.push("价格位于 20 日均线下方");
  if (fundamentals?.profitGrowth != null && fundamentals.profitGrowth < 0) {
    warnings.push(`净利润同比 ${fundamentals.profitGrowth.toFixed(1)}%`);
  }
  if (fundamentals?.roe != null && fundamentals.roe < 5) {
    warnings.push(`ROE 仅 ${fundamentals.roe.toFixed(1)}%`);
  }
  return warnings.slice(0, 3);
}

function buildReasons(
  metrics: StockAiMetrics,
  industryDelta: number,
  fundamentals: StockFundamentals | null,
  newsSentiment: number,
) {
  const reasons: string[] = [];
  reasons.push(`近 60 日 ${metrics.return60 >= 0 ? "+" : ""}${metrics.return60.toFixed(1)}%`);
  reasons.push(metrics.shortAboveLong ? "短均线位于长均线上方" : "短均线尚未形成多头排列");
  if (Math.abs(industryDelta) >= 0.1) {
    reasons.push(
      `相对同行业 ${industryDelta >= 0 ? "领先" : "落后"} ${Math.abs(industryDelta).toFixed(1)} 个百分点`,
    );
  } else {
    reasons.push("与同行业走势接近");
  }
  if (fundamentals?.roe != null) {
    reasons.push(`最新 ROE ${fundamentals.roe.toFixed(1)}%`);
  }
  if (newsSentiment >= 0.25) reasons.push("近期新闻情绪偏正面");
  if (newsSentiment <= -0.25) reasons.push("近期新闻情绪偏负面");
  return reasons;
}

function fundamentalScore(fundamentals: StockFundamentals | null) {
  if (!fundamentals) return 45;
  const roe = fundamentals.roe == null ? 35 : clamp(35 + fundamentals.roe * 2.4);
  const revenueGrowth =
    fundamentals.revenueGrowth == null ? 45 : clamp(50 + fundamentals.revenueGrowth * 2);
  const profitGrowth =
    fundamentals.profitGrowth == null ? 45 : clamp(50 + fundamentals.profitGrowth * 2);
  const grossMargin =
    fundamentals.grossMargin == null ? 45 : clamp(45 + fundamentals.grossMargin * 0.55);
  return Math.round(roe * 0.4 + revenueGrowth * 0.2 + profitGrowth * 0.25 + grossMargin * 0.15);
}

export function scoreNewsSentiment(news: StockNewsItem[]) {
  if (!news.length) return 0;
  const positiveWords = /增长|突破|中标|回购|增持|扭亏|创新高|上调|盈利|超预期|订单|分红|扩产|领先|改善/;
  const negativeWords = /下滑|亏损|减持|处罚|立案|下跌|风险|终止|违约|退市|冻结|商誉|低于预期|承压|调查/;
  const score = news.reduce((sum, item) => {
    const titleScore =
      Number(positiveWords.test(item.title)) - Number(negativeWords.test(item.title));
    const summaryScore =
      (Number(positiveWords.test(item.summary)) - Number(negativeWords.test(item.summary))) * 0.45;
    return sum + titleScore + summaryScore;
  }, 0);
  return clamp(score / Math.max(1, news.length), -1, 1) * 100;
}

export function rankStockCandidates(
  inputs: StockAiInput[],
  profile: StockAiProfile = "balanced",
): StockAiReport {
  const metricsBySymbol = new Map<string, StockAiMetrics>();
  const pointsBySymbol = new Map<string, number>();
  const industryBySymbol = new Map<string, string>();

  for (const input of inputs) {
    const values = input.trend
      .map((point) => point.value)
      .filter((value) => Number.isFinite(value) && value > 0);
    const currentValues = values.length >= 60 ? values.slice(-120) : values;
    const shortAverage = average(currentValues.slice(-20));
    const longAverage = average(currentValues.slice(-60));
    const latest = currentValues.at(-1) ?? 0;
    const metrics: StockAiMetrics = {
      return20: percentageReturn(currentValues, 20),
      return60: percentageReturn(currentValues, 60),
      volatility: volatility(currentValues),
      maxDrawdown: maxDrawdown(currentValues),
      amount:
        input.quote?.amount != null && Number.isFinite(input.quote.amount)
          ? input.quote.amount
          : null,
      aboveSma20: latest > 0 && shortAverage > 0 && latest >= shortAverage,
      shortAboveLong: shortAverage > 0 && longAverage > 0 && shortAverage >= longAverage,
    };
    metricsBySymbol.set(input.asset.symbol, metrics);
    pointsBySymbol.set(input.asset.symbol, currentValues.length);
    industryBySymbol.set(
      input.asset.symbol,
      industryForStock(input.asset, input.fundamentals?.industry),
    );
  }

  const industryGroups = new Map<string, StockAiInput[]>();
  for (const input of inputs) {
    const industry = industryBySymbol.get(input.asset.symbol) ?? "综合";
    const group = industryGroups.get(industry) ?? [];
    group.push(input);
    industryGroups.set(industry, group);
  }

  const availableInputs = inputs.filter(
    (input) => (pointsBySymbol.get(input.asset.symbol) ?? 0) >= 20,
  );
  const amountSorted = availableInputs
    .map((input) => metricsBySymbol.get(input.asset.symbol)?.amount ?? -1)
    .sort((left, right) => left - right);

  const candidates = inputs.map<StockAiCandidate>((input) => {
    const industry = industryBySymbol.get(input.asset.symbol) ?? "综合";
    const metrics = metricsBySymbol.get(input.asset.symbol)!;
    const dataPoints = pointsBySymbol.get(input.asset.symbol) ?? 0;
    const available = dataPoints >= 20;
    const peers = industryGroups.get(industry) ?? [];
    const peerReturn20 = average(
      peers
        .map((peer) => metricsBySymbol.get(peer.asset.symbol)?.return20)
        .filter((value): value is number => value != null),
    );
    const industryDelta = metrics.return20 - peerReturn20;
    const fundamentals = input.fundamentals ?? null;
    const news = input.news ?? [];
    const newsSentiment = scoreNewsSentiment(news);
    const trendScore = clamp(
      50 +
        (metrics.aboveSma20 ? 16 : -16) +
        (metrics.shortAboveLong ? 16 : -16) +
        (metrics.return20 > 0 ? 10 : -10) +
        (metrics.return60 > 0 ? 8 : -8),
    );
    const momentumScore = clamp(50 + metrics.return20 * 2.1 + metrics.return60 * 0.75);
    const riskScore = clamp(100 - metrics.maxDrawdown * 2.5 - metrics.volatility * 0.78);
    const industryScore =
      peers.length > 1 ? clamp(50 + industryDelta * 4) : 50;
    const amountRank = amountSorted.lastIndexOf(metrics.amount ?? -1);
    const liquidityScore =
      amountSorted.length > 1
        ? clamp(25 + (Math.max(0, amountRank) / (amountSorted.length - 1)) * 75)
        : metrics.amount != null
          ? clamp(30 + Math.log10(Math.max(1, metrics.amount / 1_000_000)) * 14)
          : 35;
    const fundamentalsFactor = fundamentalScore(fundamentals);
    const newsFactor = clamp(50 + newsSentiment * 0.35);
    const factors: StockAiFactorScores = {
      trend: Math.round(trendScore),
      momentum: Math.round(momentumScore),
      risk: Math.round(riskScore),
      industry: Math.round(industryScore),
      liquidity: Math.round(liquidityScore),
      fundamentals: fundamentalsFactor,
      news: Math.round(newsFactor),
    };
    const weights = PROFILE_WEIGHTS[profile];
    const score = available
      ? Math.round(
          factors.trend * (weights.trend / 100) +
            factors.momentum * (weights.momentum / 100) +
            factors.risk * (weights.risk / 100) +
            factors.industry * (weights.industry / 100) +
            factors.liquidity * (weights.liquidity / 100) +
            factors.fundamentals * (weights.fundamentals / 100) +
            factors.news * (weights.news / 100),
        )
      : 0;
    return {
      symbol: input.asset.symbol,
      code: input.asset.code,
      name: input.asset.name,
      industry,
      score,
      rank: 0,
      rating: ratingFor(score, available),
      factors,
      metrics,
      reasons: buildReasons(metrics, industryDelta, fundamentals, newsSentiment),
      warnings: buildWarnings(metrics, dataPoints, fundamentals),
      fundamentals,
      news,
      newsSentiment,
      dataPoints,
      available,
    };
  });

  const sorted = [...candidates].sort((left, right) => {
    if (left.available !== right.available) return left.available ? -1 : 1;
    return right.score - left.score;
  });
  sorted.forEach((candidate, index) => {
    candidate.rank = index + 1;
  });

  const industries = [...industryGroups.entries()]
    .map<StockAiIndustry>(([name, peers]) => {
      const scored = peers
        .map((peer) => candidates.find((candidate) => candidate.symbol === peer.asset.symbol))
        .filter((candidate): candidate is StockAiCandidate => Boolean(candidate?.available))
        .sort((left, right) => right.score - left.score);
      return {
        name,
        count: peers.length,
        averageReturn20: average(scored.map((candidate) => candidate.metrics.return20)),
        leaderSymbol: scored[0]?.symbol ?? null,
      };
    })
    .sort((left, right) => right.averageReturn20 - left.averageReturn20);

  return {
    profile,
    candidates: sorted,
    topPick: sorted.find((candidate) => candidate.available) ?? null,
    industries,
    universeSize: inputs.length,
    availableCount: availableInputs.length,
  };
}
