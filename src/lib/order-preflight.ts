import type {
  Asset,
  Quote,
  TradingLedger,
  TradingOrderType,
  TradingSide,
} from "../types";
import type { TradingStats } from "./trading";
import {
  calculateTradingFee,
  TRADING_SLIPPAGE_RATE,
  tradingQuantity,
} from "./trading";

export interface OrderPreflightInput {
  asset: Asset;
  quote: Quote | undefined;
  side: TradingSide;
  type: TradingOrderType;
  quantity: number;
  limitPrice?: number | null;
  ledger: TradingLedger;
  stats: TradingStats;
}

export interface OrderPreflightNote {
  tone: "warning" | "info" | "error";
  message: string;
}

export interface OrderPreflight {
  normalizedQuantity: number;
  estimatedPrice: number;
  gross: number;
  fee: number;
  cashAfter: number;
  positionAfter: number;
  projectedExposurePct: number;
  canSubmit: boolean;
  notes: OrderPreflightNote[];
}

export function buildOrderPreflight(input: OrderPreflightInput): OrderPreflight {
  const normalizedQuantity = tradingQuantity(input.asset, input.quantity);
  const quotePrice = input.quote?.price;
  const rawPrice = input.type === "limit" ? Number(input.limitPrice) : quotePrice;
  const estimatedPrice =
    rawPrice != null && Number.isFinite(rawPrice) && rawPrice > 0
      ? input.type === "limit"
        ? rawPrice
        : rawPrice * (input.side === "buy" ? 1 + TRADING_SLIPPAGE_RATE : 1 - TRADING_SLIPPAGE_RATE)
      : 0;
  const gross = normalizedQuantity * estimatedPrice;
  const fee = gross > 0 ? calculateTradingFee(input.asset, input.side, gross) : 0;
  const existing = input.ledger.positions.find((position) => position.symbol === input.asset.symbol);
  const currentQuantity = existing?.quantity ?? 0;
  const positionAfter =
    input.side === "buy"
      ? currentQuantity + normalizedQuantity
      : Math.max(0, currentQuantity - normalizedQuantity);
  const cashAfter =
    input.side === "buy"
      ? input.ledger.cash - gross - fee
      : input.ledger.cash + gross - fee;
  const projectedMarketValue = Math.max(
    0,
    input.side === "buy"
      ? input.stats.marketValue + gross
      : input.stats.marketValue - Math.min(gross, existing ? existing.averageCost * normalizedQuantity : 0),
  );
  const projectedExposurePct =
    input.stats.equity > 0 ? (projectedMarketValue / input.stats.equity) * 100 : 0;
  const notes: OrderPreflightNote[] = [];
  let canSubmit = true;

  if (normalizedQuantity <= 0) {
    canSubmit = false;
    notes.push({
      tone: "error",
      message:
        input.asset.kind === "fund"
          ? "请输入大于 0 的基金份额。"
          : "股票与 ETF 至少需要 100 股，并按 100 股取整。",
    });
  } else if (!quotePrice || quotePrice <= 0) {
    canSubmit = false;
    notes.push({ tone: "error", message: "当前没有可用行情，暂时不能提交委托。" });
  } else if (normalizedQuantity !== input.quantity) {
    notes.push({
      tone: "info",
      message: `实际提交数量按 ${normalizedQuantity} ${input.asset.kind === "fund" ? "份" : "股"}撮合。`,
    });
  }

  if (input.type === "limit" && estimatedPrice <= 0) {
    canSubmit = false;
    notes.push({ tone: "error", message: "限价单需要填写有效价格。" });
  }

  if (input.side === "buy" && cashAfter < 0) {
    canSubmit = false;
    notes.push({ tone: "error", message: "可用资金不足以覆盖预计成交额和手续费。" });
  }
  if (input.side === "sell" && currentQuantity + 0.000001 < normalizedQuantity) {
    canSubmit = false;
    notes.push({ tone: "error", message: "可卖持仓不足，请调整数量。" });
  }
  if (
    input.side === "buy" &&
    projectedExposurePct > input.ledger.risk.maxPositionPct &&
    normalizedQuantity > 0
  ) {
    notes.push({
      tone: "warning",
      message: `预计仓位 ${projectedExposurePct.toFixed(1)}%，超过 ${input.ledger.risk.maxPositionPct}% 上限。`,
    });
  }
  if (
    input.stats.equity > 0 &&
    input.stats.todayPnl <=
      -(input.stats.equity * input.ledger.risk.dailyLossLimitPct) / 100
  ) {
    notes.push({
      tone: "warning",
      message: "今日亏损已触及风控线，请谨慎继续增加风险。",
    });
  }
  if (
    input.type === "limit" &&
    quotePrice != null &&
    estimatedPrice > 0 &&
    ((input.side === "buy" && estimatedPrice < quotePrice) ||
      (input.side === "sell" && estimatedPrice > quotePrice))
  ) {
    notes.push({
      tone: "info",
      message: "限价单尚未触价，预计会保持待成交。",
    });
  }

  return {
    normalizedQuantity,
    estimatedPrice,
    gross,
    fee,
    cashAfter,
    positionAfter,
    projectedExposurePct,
    canSubmit,
    notes,
  };
}
