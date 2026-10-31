import type {
  Asset,
  TradingBacktestResult,
  TradingRiskConfig,
  TradingStrategy,
  TrendPoint,
} from "../types";
import { runSmaBacktest } from "./trading";

export type SensitivityMetric = "return" | "drawdown" | "score";

export interface SensitivityCell {
  shortWindow: number;
  longWindow: number;
  valid: boolean;
  result: TradingBacktestResult | null;
  score: number;
}

export interface SensitivityGrid {
  shortWindows: number[];
  longWindows: number[];
  cells: SensitivityCell[];
  best: SensitivityCell | null;
}

export function buildSensitivityGrid(
  points: TrendPoint[],
  strategy: TradingStrategy,
  asset: Asset,
  risk: TradingRiskConfig,
  initialCapital: number,
  shortWindows = [5, 10, 15, 20],
  longWindows = [20, 30, 45, 60],
): SensitivityGrid {
  const cells = shortWindows.flatMap((shortWindow) =>
    longWindows.map<SensitivityCell>((longWindow) => {
      if (longWindow <= shortWindow || points.length <= longWindow) {
        return {
          shortWindow,
          longWindow,
          valid: false,
          result: null,
          score: Number.NEGATIVE_INFINITY,
        };
      }
      const result = runSmaBacktest(
        points,
        {
          ...strategy,
          shortWindow,
          longWindow,
        },
        asset,
        risk,
        initialCapital,
      );
      return {
        shortWindow,
        longWindow,
        valid: true,
        result,
        score: result.totalReturn - result.maxDrawdown * 0.5,
      };
    }),
  );
  const best =
    cells
      .filter((cell) => cell.valid)
      .sort((left, right) => right.score - left.score)[0] ?? null;
  return { shortWindows, longWindows, cells, best };
}

export function sensitivityValue(cell: SensitivityCell, metric: SensitivityMetric) {
  if (!cell.valid || !cell.result) return null;
  if (metric === "return") return cell.result.totalReturn;
  if (metric === "drawdown") return -cell.result.maxDrawdown;
  return cell.score;
}
