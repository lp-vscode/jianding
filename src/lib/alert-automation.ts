import type { AlertRule, Asset, Quote, TradingLedger, TradingSide } from "../types";
import { suggestedTradingQuantity, tradingQuantity } from "./trading";

export interface AlertAutomationIntent {
  side: TradingSide;
  notional: number;
  quantity: number;
  blockedReason: string | null;
}

export function buildAlertAutomationIntent(
  rule: AlertRule,
  asset: Asset,
  quote: Quote | undefined,
  ledger: TradingLedger,
): AlertAutomationIntent | null {
  const automation = rule.autoTrade;
  if (!automation?.enabled) return null;

  const side = automation.side;
  const notional = Math.max(1000, automation.notional);
  const blockedReason = !ledger.strategy.agentEnabled
    ? "智能体未启用"
    : !ledger.backtest
      ? "尚未完成回测"
      : !ledger.backtest.riskPassed
        ? "回测风控未通过"
        : !quote?.price || quote.price <= 0
          ? "当前没有可用行情"
          : null;
  if (blockedReason) {
    return { side, notional, quantity: 0, blockedReason };
  }

  let quantity = suggestedTradingQuantity(asset, notional, quote?.price ?? 0);
  if (side === "sell") {
    const position = ledger.positions.find((item) => item.symbol === asset.symbol);
    const available = position?.quantity ?? 0;
    if (available <= 0) {
      return { side, notional, quantity: 0, blockedReason: "没有可卖持仓" };
    }
    quantity = Math.min(quantity, tradingQuantity(asset, available));
  }
  if (quantity <= 0) {
    return {
      side,
      notional,
      quantity: 0,
      blockedReason:
        asset.kind === "fund" ? "委托金额不足一份" : "委托金额不足一手",
    };
  }
  return { side, notional, quantity, blockedReason: null };
}
