import type { TradingRiskConfig, TradingStrategy } from "../types";

export type TradingBlueprintKey = "responsive" | "balanced" | "trend";

export interface TradingBlueprint {
  key: TradingBlueprintKey;
  label: string;
  rhythm: string;
  shortWindow: number;
  longWindow: number;
  orderNotional: number;
  risk: TradingRiskConfig;
}

export const TRADING_BLUEPRINTS: TradingBlueprint[] = [
  {
    key: "responsive",
    label: "灵敏",
    rhythm: "更早捕捉交叉",
    shortWindow: 5,
    longWindow: 20,
    orderNotional: 30_000,
    risk: {
      maxPositionPct: 25,
      maxDrawdownPct: 8,
      dailyLossLimitPct: 2,
      stopLossPct: 3,
      takeProfitPct: 8,
    },
  },
  {
    key: "balanced",
    label: "平衡",
    rhythm: "信号与噪声折中",
    shortWindow: 10,
    longWindow: 30,
    orderNotional: 50_000,
    risk: {
      maxPositionPct: 40,
      maxDrawdownPct: 12,
      dailyLossLimitPct: 3,
      stopLossPct: 6,
      takeProfitPct: 15,
    },
  },
  {
    key: "trend",
    label: "趋势",
    rhythm: "减少频繁切换",
    shortWindow: 20,
    longWindow: 60,
    orderNotional: 80_000,
    risk: {
      maxPositionPct: 60,
      maxDrawdownPct: 18,
      dailyLossLimitPct: 5,
      stopLossPct: 10,
      takeProfitPct: 25,
    },
  },
];

export function activeTradingBlueprint(
  strategy: TradingStrategy,
  risk: TradingRiskConfig,
): TradingBlueprintKey | null {
  return (
    TRADING_BLUEPRINTS.find(
      (blueprint) =>
        strategy.shortWindow === blueprint.shortWindow &&
        strategy.longWindow === blueprint.longWindow &&
        strategy.orderNotional === blueprint.orderNotional &&
        risk.maxPositionPct === blueprint.risk.maxPositionPct &&
        risk.maxDrawdownPct === blueprint.risk.maxDrawdownPct &&
        risk.dailyLossLimitPct === blueprint.risk.dailyLossLimitPct &&
        risk.stopLossPct === blueprint.risk.stopLossPct &&
        risk.takeProfitPct === blueprint.risk.takeProfitPct,
    )?.key ?? null
  );
}
