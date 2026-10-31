export interface RebalanceHolding {
  symbol: string;
  name: string;
  value: number;
  weight: number;
}

export interface RebalanceAction {
  symbol: string;
  name: string;
  side: "buy" | "sell";
  currentWeight: number;
  targetWeight: number;
  deviation: number;
  amount: number;
}

export interface RebalancePlan {
  canRebalance: boolean;
  needsAdjustment: boolean;
  targetWeight: number;
  maxDeviation: number;
  actions: RebalanceAction[];
}

export function buildEqualWeightRebalancePlan(
  holdings: RebalanceHolding[],
  tolerance = 3,
): RebalancePlan {
  const totalValue = holdings.reduce((sum, holding) => sum + Math.max(0, holding.value), 0);
  if (holdings.length < 2 || totalValue <= 0) {
    return {
      canRebalance: false,
      needsAdjustment: false,
      targetWeight: holdings.length ? 100 / holdings.length : 0,
      maxDeviation: 0,
      actions: [],
    };
  }

  const targetWeight = 100 / holdings.length;
  const targetValue = totalValue / holdings.length;
  const maxDeviation = Math.max(
    ...holdings.map((holding) => Math.abs(holding.weight - targetWeight)),
  );
  const actions = holdings
    .map<RebalanceAction>((holding) => ({
      symbol: holding.symbol,
      name: holding.name,
      side: holding.weight > targetWeight ? "sell" : "buy",
      currentWeight: holding.weight,
      targetWeight,
      deviation: holding.weight - targetWeight,
      amount: Math.abs(holding.value - targetValue),
    }))
    .filter((action) => Math.abs(action.deviation) >= tolerance)
    .sort((left, right) => Math.abs(right.deviation) - Math.abs(left.deviation));

  return {
    canRebalance: true,
    needsAdjustment: actions.length > 0,
    targetWeight,
    maxDeviation,
    actions,
  };
}
