import type { TrendPoint } from "../types";

export interface NormalizedTrendPoint {
  label: string;
  value: number;
}

export interface TrendPerformance {
  points: NormalizedTrendPoint[];
  totalReturn: number;
  maxDrawdown: number;
  startValue: number | null;
  endValue: number | null;
}

export function calculateTrendPerformance(points: TrendPoint[]): TrendPerformance {
  const valid = points.filter(
    (point) => Number.isFinite(point.value) && point.value > 0,
  );
  const startValue = valid[0]?.value ?? null;
  const endValue = valid[valid.length - 1]?.value ?? null;
  if (!valid.length || startValue == null || endValue == null) {
    return {
      points: [],
      totalReturn: 0,
      maxDrawdown: 0,
      startValue: null,
      endValue: null,
    };
  }

  let peak = startValue;
  let maxDrawdown = 0;
  const normalized = valid.map((point) => {
    peak = Math.max(peak, point.value);
    maxDrawdown = Math.min(maxDrawdown, ((point.value / peak) - 1) * 100);
    return {
      label: point.label,
      value: ((point.value / startValue) - 1) * 100,
    };
  });

  return {
    points: normalized,
    totalReturn: ((endValue / startValue) - 1) * 100,
    maxDrawdown,
    startValue,
    endValue,
  };
}
