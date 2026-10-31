import type { TradingBacktestResult } from "../types";

export type MonteCarloGrade = "稳健" | "观察" | "脆弱" | "样本不足";

export interface MonteCarloBand {
  index: number;
  p05: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
}

export interface MonteCarloResult {
  simulations: number;
  observations: number;
  horizon: number;
  probabilityPositive: number;
  probabilityWithinRisk: number | null;
  p05Return: number;
  medianReturn: number;
  p95Return: number;
  medianMaxDrawdown: number;
  p95MaxDrawdown: number;
  bestReturn: number;
  worstReturn: number;
  bands: MonteCarloBand[];
  grade: MonteCarloGrade;
}

export interface MonteCarloOptions {
  simulations?: number;
  horizon?: number;
  seed?: number;
  riskDrawdownPct?: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function percentile(sorted: number[], ratio: number) {
  if (!sorted.length) return 0;
  const index = clamp(ratio, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function equityReturns(result: TradingBacktestResult) {
  const points = result.equityCurve
    .map((point) => point.value)
    .filter((value) => Number.isFinite(value) && value > 0);
  return points.flatMap((value, index) => {
    if (index === 0) return [];
    const previous = points[index - 1];
    return previous > 0 ? [(value - previous) / previous] : [];
  });
}

function gradeFor(probabilityPositive: number, p05Return: number): MonteCarloGrade {
  if (probabilityPositive >= 0.62 && p05Return >= -8) return "稳健";
  if (probabilityPositive >= 0.45 && p05Return >= -16) return "观察";
  return "脆弱";
}

export function runMonteCarloBacktest(
  result: TradingBacktestResult,
  options: MonteCarloOptions = {},
): MonteCarloResult | null {
  const returns = equityReturns(result);
  if (returns.length < 20) return null;

  const simulations = clamp(Math.round(options.simulations ?? 1_000), 100, 5_000);
  const horizon = clamp(
    Math.round(options.horizon ?? returns.length),
    20,
    750,
  );
  const seed = Math.round(options.seed ?? 20_261_031);
  const random = seededRandom(seed);
  const paths: number[][] = [];
  const finalReturns: number[] = [];
  const maxDrawdowns: number[] = [];

  for (let simulation = 0; simulation < simulations; simulation += 1) {
    let equity = result.initialCapital;
    let peak = equity;
    let maxDrawdown = 0;
    const path = [equity];
    for (let step = 0; step < horizon; step += 1) {
      const sampled = returns[Math.floor(random() * returns.length)] ?? 0;
      equity *= 1 + Math.max(-0.95, sampled);
      peak = Math.max(peak, equity);
      if (peak > 0) maxDrawdown = Math.max(maxDrawdown, ((peak - equity) / peak) * 100);
      path.push(equity);
    }
    paths.push(path);
    finalReturns.push(
      result.initialCapital > 0
        ? ((equity - result.initialCapital) / result.initialCapital) * 100
        : 0,
    );
    maxDrawdowns.push(maxDrawdown);
  }

  const sortedReturns = [...finalReturns].sort((left, right) => left - right);
  const sortedDrawdowns = [...maxDrawdowns].sort((left, right) => left - right);
  const bandSteps = 20;
  const bands = Array.from({ length: bandSteps + 1 }, (_, bandIndex) => {
    const step = Math.round((bandIndex / bandSteps) * horizon);
    const values = paths
      .map((path) => path[step] ?? result.initialCapital)
      .map((equity) =>
        result.initialCapital > 0
          ? ((equity - result.initialCapital) / result.initialCapital) * 100
          : 0,
      )
      .sort((left, right) => left - right);
    return {
      index: step,
      p05: percentile(values, 0.05),
      p25: percentile(values, 0.25),
      median: percentile(values, 0.5),
      p75: percentile(values, 0.75),
      p95: percentile(values, 0.95),
    };
  });
  const p05Return = percentile(sortedReturns, 0.05);
  const probabilityPositive =
    finalReturns.filter((value) => value > 0).length / simulations;
  const riskDrawdownPct =
    options.riskDrawdownPct != null && Number.isFinite(options.riskDrawdownPct)
      ? options.riskDrawdownPct
      : null;

  return {
    simulations,
    observations: returns.length,
    horizon,
    probabilityPositive,
    probabilityWithinRisk:
      riskDrawdownPct == null
        ? null
        : maxDrawdowns.filter((value) => value <= riskDrawdownPct).length / simulations,
    p05Return,
    medianReturn: percentile(sortedReturns, 0.5),
    p95Return: percentile(sortedReturns, 0.95),
    medianMaxDrawdown: percentile(sortedDrawdowns, 0.5),
    p95MaxDrawdown: percentile(sortedDrawdowns, 0.95),
    bestReturn: sortedReturns.at(-1) ?? 0,
    worstReturn: sortedReturns[0] ?? 0,
    bands,
    grade: gradeFor(probabilityPositive, p05Return),
  };
}
