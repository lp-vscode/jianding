import type {
  Asset,
  Quote,
  TradingAgentDecision,
  TradingBacktestResult,
  TradingEquityPoint,
  TradingFill,
  TradingLedger,
  TradingOrder,
  TradingOrderType,
  TradingPosition,
  TradingRiskConfig,
  TradingSide,
  TradingSignal,
  TradingSignalAction,
  TrendPoint,
} from "../types";

export const TRADING_INITIAL_CAPITAL = 1_000_000;
export const TRADING_COMMISSION_RATE = 0.0003;
export const TRADING_STAMP_DUTY_RATE = 0.0005;
export const TRADING_SLIPPAGE_RATE = 0.0005;
export const TRADING_MIN_COMMISSION = 5;

function tradingUid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultTradingLedger(now = Date.now(), symbol = ""): TradingLedger {
  return {
    version: 1,
    initialCapital: TRADING_INITIAL_CAPITAL,
    cash: TRADING_INITIAL_CAPITAL,
    realizedPnl: 0,
    positions: [],
    orders: [],
    fills: [],
    signals: [],
    equityCurve: [
      {
        at: now,
        equity: TRADING_INITIAL_CAPITAL,
        cash: TRADING_INITIAL_CAPITAL,
        marketValue: 0,
      },
    ],
    strategy: {
      enabled: false,
      agentEnabled: true,
      symbol,
      shortWindow: 5,
      longWindow: 20,
      orderNotional: 50_000,
      lastCross: null,
      lastEvaluatedAt: null,
      lastAction: "hold",
      lastReason: "策略尚未评估",
      lastShortMa: null,
      lastLongMa: null,
    },
    risk: {
      maxPositionPct: 40,
      maxDrawdownPct: 12,
      dailyLossLimitPct: 3,
      stopLossPct: 6,
      takeProfitPct: 15,
    },
    backtest: null,
    agentDecisions: [],
    updatedAt: now,
  };
}

function finiteNumber(value: unknown, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function validTime(value: unknown, fallback = Date.now()) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function sanitizeTradingLedger(raw: unknown, fallbackSymbol = ""): TradingLedger {
  const fallback = defaultTradingLedger(Date.now(), fallbackSymbol);
  if (!raw || typeof raw !== "object") return fallback;
  const source = raw as Partial<TradingLedger>;
  const positions: TradingPosition[] = Array.isArray(source.positions)
    ? source.positions
        .filter((position) => position && typeof position.symbol === "string")
        .map((position) => ({
          symbol: position.symbol,
          quantity: Math.max(0, finiteNumber(position.quantity)),
          averageCost: Math.max(0, finiteNumber(position.averageCost)),
          realizedPnl: finiteNumber(position.realizedPnl),
          openedAt: validTime(position.openedAt),
          updatedAt: validTime(position.updatedAt),
        }))
        .filter((position) => position.quantity > 0)
    : [];
  const orders: TradingOrder[] = Array.isArray(source.orders)
    ? source.orders
        .filter((order) => order && typeof order.symbol === "string")
        .map((order) => ({
          id: String(order.id || tradingUid("order")),
          symbol: order.symbol,
          side: (order.side === "sell" ? "sell" : "buy") as TradingSide,
          type: (order.type === "limit" ? "limit" : "market") as TradingOrderType,
          quantity: Math.max(0, finiteNumber(order.quantity)),
          limitPrice: order.limitPrice == null ? null : Math.max(0, finiteNumber(order.limitPrice)),
          status: ["pending", "filled", "cancelled", "rejected"].includes(order.status)
            ? order.status
            : "rejected",
          createdAt: validTime(order.createdAt),
          updatedAt: validTime(order.updatedAt),
          filledAt: order.filledAt == null ? null : validTime(order.filledAt),
          filledPrice: order.filledPrice == null ? null : Math.max(0, finiteNumber(order.filledPrice)),
          fee: Math.max(0, finiteNumber(order.fee)),
          reason: String(order.reason || ""),
        }))
        .slice(0, 300)
    : [];
  const fills: TradingFill[] = Array.isArray(source.fills)
    ? source.fills
        .filter((fill) => fill && typeof fill.symbol === "string")
        .map((fill) => ({
          id: String(fill.id || tradingUid("fill")),
          orderId: String(fill.orderId || ""),
          symbol: fill.symbol,
          side: (fill.side === "sell" ? "sell" : "buy") as TradingSide,
          quantity: Math.max(0, finiteNumber(fill.quantity)),
          price: Math.max(0, finiteNumber(fill.price)),
          fee: Math.max(0, finiteNumber(fill.fee)),
          realizedPnl: finiteNumber(fill.realizedPnl),
          at: validTime(fill.at),
        }))
        .slice(0, 500)
    : [];
  const signals: TradingSignal[] = Array.isArray(source.signals)
    ? source.signals
        .filter((signal) => signal && typeof signal.symbol === "string")
        .map((signal) => ({
          id: String(signal.id || tradingUid("signal")),
          symbol: signal.symbol,
          action: (signal.action === "buy" || signal.action === "sell" ? signal.action : "hold") as TradingSignalAction,
          reason: String(signal.reason || ""),
          price: Math.max(0, finiteNumber(signal.price)),
          shortMa: Math.max(0, finiteNumber(signal.shortMa)),
          longMa: Math.max(0, finiteNumber(signal.longMa)),
          at: validTime(signal.at),
          orderId: signal.orderId == null ? null : String(signal.orderId),
        }))
        .slice(0, 200)
    : [];
  const equityCurve: TradingEquityPoint[] = Array.isArray(source.equityCurve)
    ? source.equityCurve
        .filter((point) => point && typeof point === "object")
        .map((point) => ({
          at: validTime(point.at),
          equity: Math.max(0, finiteNumber(point.equity)),
          cash: Math.max(0, finiteNumber(point.cash)),
          marketValue: Math.max(0, finiteNumber(point.marketValue)),
        }))
        .slice(-2000)
    : fallback.equityCurve;
  const strategy = source.strategy && typeof source.strategy === "object" ? source.strategy : fallback.strategy;
  const risk = source.risk && typeof source.risk === "object" ? source.risk : fallback.risk;
  const shortWindow = Math.min(60, Math.max(2, Math.round(finiteNumber(strategy.shortWindow, 5))));
  const longWindow = Math.min(240, Math.max(shortWindow + 1, Math.round(finiteNumber(strategy.longWindow, 20))));
  return {
    version: 1,
    initialCapital: Math.max(1, finiteNumber(source.initialCapital, TRADING_INITIAL_CAPITAL)),
    cash: Math.max(0, finiteNumber(source.cash, TRADING_INITIAL_CAPITAL)),
    realizedPnl: finiteNumber(source.realizedPnl),
    positions,
    orders,
    fills,
    signals,
    equityCurve,
    strategy: {
      enabled: strategy.enabled === true,
      agentEnabled: strategy.agentEnabled !== false,
      symbol: typeof strategy.symbol === "string" ? strategy.symbol : fallbackSymbol,
      shortWindow,
      longWindow,
      orderNotional: Math.max(1000, finiteNumber(strategy.orderNotional, 50_000)),
      lastCross: strategy.lastCross === "above" || strategy.lastCross === "below" ? strategy.lastCross : null,
      lastEvaluatedAt: strategy.lastEvaluatedAt == null ? null : validTime(strategy.lastEvaluatedAt),
      lastAction:
        strategy.lastAction === "buy" || strategy.lastAction === "sell" ? strategy.lastAction : "hold",
      lastReason: String(strategy.lastReason || "策略尚未评估"),
      lastShortMa: strategy.lastShortMa == null ? null : finiteNumber(strategy.lastShortMa),
      lastLongMa: strategy.lastLongMa == null ? null : finiteNumber(strategy.lastLongMa),
    },
    risk: {
      maxPositionPct: Math.min(100, Math.max(1, finiteNumber(risk.maxPositionPct, 40))),
      maxDrawdownPct: Math.min(80, Math.max(1, finiteNumber(risk.maxDrawdownPct, 12))),
      dailyLossLimitPct: Math.min(30, Math.max(0.5, finiteNumber(risk.dailyLossLimitPct, 3))),
      stopLossPct: Math.min(50, Math.max(0.5, finiteNumber(risk.stopLossPct, 6))),
      takeProfitPct: Math.min(200, Math.max(1, finiteNumber(risk.takeProfitPct, 15))),
    },
    backtest:
      source.backtest && typeof source.backtest === "object"
        ? {
            id: String(source.backtest.id || tradingUid("backtest")),
            symbol: String(source.backtest.symbol || fallbackSymbol),
            ranAt: validTime(source.backtest.ranAt),
            shortWindow: Math.max(2, Math.round(finiteNumber(source.backtest.shortWindow, shortWindow))),
            longWindow: Math.max(3, Math.round(finiteNumber(source.backtest.longWindow, longWindow))),
            initialCapital: Math.max(1, finiteNumber(source.backtest.initialCapital, TRADING_INITIAL_CAPITAL)),
            finalEquity: Math.max(0, finiteNumber(source.backtest.finalEquity)),
            totalReturn: finiteNumber(source.backtest.totalReturn),
            maxDrawdown: Math.max(0, finiteNumber(source.backtest.maxDrawdown)),
            winRate:
              source.backtest.winRate == null ? null : Math.max(0, finiteNumber(source.backtest.winRate)),
            profitFactor:
              source.backtest.profitFactor == null ? null : Math.max(0, finiteNumber(source.backtest.profitFactor)),
            tradeCount: Math.max(0, Math.round(finiteNumber(source.backtest.tradeCount))),
            equityCurve: Array.isArray(source.backtest.equityCurve)
              ? source.backtest.equityCurve
                  .filter((point) => point && typeof point.label === "string")
                  .map((point) => ({ label: point.label, value: Math.max(0, finiteNumber(point.value)) }))
                  .slice(-500)
              : [],
            riskPassed: source.backtest.riskPassed === true,
          }
        : null,
    agentDecisions: Array.isArray(source.agentDecisions)
      ? source.agentDecisions
          .filter((decision) => decision && typeof decision.symbol === "string")
          .map((decision) => ({
            id: String(decision.id || tradingUid("agent")),
            at: validTime(decision.at),
            symbol: decision.symbol,
            action: (["execute", "reduce", "block", "observe"].includes(decision.action)
              ? decision.action
              : "observe") as TradingAgentDecision["action"],
            confidence: Math.min(100, Math.max(0, finiteNumber(decision.confidence))),
            reason: String(decision.reason || ""),
            signalId: decision.signalId == null ? null : String(decision.signalId),
            riskFlags: Array.isArray(decision.riskFlags) ? decision.riskFlags.map(String).slice(0, 8) : [],
          }))
          .slice(0, 200)
      : [],
    updatedAt: validTime(source.updatedAt),
  };
}

export function tradingQuantity(asset: Asset, requested: number) {
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  if (asset.kind === "fund") return Math.floor(requested * 100) / 100;
  return Math.floor(requested / 100) * 100;
}

export function suggestedTradingQuantity(asset: Asset, notional: number, price: number) {
  if (!Number.isFinite(price) || price <= 0) return 0;
  return tradingQuantity(asset, notional / price);
}

export function calculateTradingFee(asset: Asset, side: TradingSide, notional: number) {
  if (asset.kind === "fund") return Math.max(0, notional * 0.0005);
  const commission = Math.max(TRADING_MIN_COMMISSION, notional * TRADING_COMMISSION_RATE);
  const stampDuty = side === "sell" ? notional * TRADING_STAMP_DUTY_RATE : 0;
  return commission + stampDuty;
}

function positionFor(ledger: TradingLedger, symbol: string) {
  return ledger.positions.find((position) => position.symbol === symbol);
}

function fillOrder(
  ledger: TradingLedger,
  order: TradingOrder,
  asset: Asset,
  quote: Quote,
  now: number,
): TradingFill | null {
  const marketPrice = quote.price;
  if (marketPrice == null || marketPrice <= 0 || order.quantity <= 0) {
    order.status = "rejected";
    order.reason = "无有效行情或委托数量";
    order.updatedAt = now;
    return null;
  }

  const canFill =
    order.type === "market" ||
    (order.side === "buy" && order.limitPrice != null && marketPrice <= order.limitPrice) ||
    (order.side === "sell" && order.limitPrice != null && marketPrice >= order.limitPrice);
  if (!canFill) return null;

  const slipped =
    order.side === "buy"
      ? marketPrice * (1 + TRADING_SLIPPAGE_RATE)
      : marketPrice * (1 - TRADING_SLIPPAGE_RATE);
  const executionPrice =
    order.type === "limit" && order.limitPrice != null
      ? order.side === "buy"
        ? Math.min(order.limitPrice, slipped)
        : Math.max(order.limitPrice, slipped)
      : slipped;
  const gross = executionPrice * order.quantity;
  const fee = calculateTradingFee(asset, order.side, gross);
  const position = positionFor(ledger, order.symbol);
  let realizedPnl = 0;

  if (order.side === "buy") {
    if (gross + fee > ledger.cash + 0.000001) {
      order.status = "rejected";
      order.reason = "可用资金不足";
      order.updatedAt = now;
      return null;
    }
    ledger.cash -= gross + fee;
    if (position) {
      const nextQuantity = position.quantity + order.quantity;
      position.averageCost =
        (position.averageCost * position.quantity + gross + fee) / nextQuantity;
      position.quantity = nextQuantity;
      position.updatedAt = now;
    } else {
      ledger.positions.push({
        symbol: order.symbol,
        quantity: order.quantity,
        averageCost: (gross + fee) / order.quantity,
        realizedPnl: 0,
        openedAt: now,
        updatedAt: now,
      });
    }
  } else {
    if (!position || position.quantity + 0.000001 < order.quantity) {
      order.status = "rejected";
      order.reason = "可卖持仓不足";
      order.updatedAt = now;
      return null;
    }
    realizedPnl = (executionPrice - position.averageCost) * order.quantity - fee;
    ledger.cash += gross - fee;
    ledger.realizedPnl += realizedPnl;
    position.quantity -= order.quantity;
    position.realizedPnl += realizedPnl;
    position.updatedAt = now;
    if (position.quantity <= 0.000001) {
      ledger.positions = ledger.positions.filter((item) => item.symbol !== position.symbol);
    }
  }

  const fill: TradingFill = {
    id: tradingUid("fill"),
    orderId: order.id,
    symbol: order.symbol,
    side: order.side,
    quantity: order.quantity,
    price: executionPrice,
    fee,
    realizedPnl,
    at: now,
  };
  ledger.fills.unshift(fill);
  ledger.fills = ledger.fills.slice(0, 500);
  order.status = "filled";
  order.filledAt = now;
  order.filledPrice = executionPrice;
  order.fee = fee;
  order.updatedAt = now;
  ledger.updatedAt = now;
  return fill;
}

export interface SubmitOrderInput {
  symbol: string;
  side: TradingSide;
  type: TradingOrderType;
  quantity: number;
  limitPrice?: number | null;
  reason?: string;
}

export function submitTradingOrder(
  ledger: TradingLedger,
  input: SubmitOrderInput,
  asset: Asset,
  quote: Quote | undefined,
  now = Date.now(),
) {
  const quantity = tradingQuantity(asset, input.quantity);
  if (quantity <= 0) return { order: null, fill: null, error: "委托数量无效" };
  if (!quote?.price) return { order: null, fill: null, error: "当前没有可用行情" };
  if (input.type === "limit" && (!input.limitPrice || input.limitPrice <= 0)) {
    return { order: null, fill: null, error: "限价单需要有效价格" };
  }
  const order: TradingOrder = {
    id: tradingUid("order"),
    symbol: input.symbol,
    side: input.side,
    type: input.type,
    quantity,
    limitPrice: input.type === "limit" ? Number(input.limitPrice) : null,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    filledAt: null,
    filledPrice: null,
    fee: 0,
    reason: input.reason?.trim() || "手动委托",
  };
  ledger.orders.unshift(order);
  ledger.orders = ledger.orders.slice(0, 300);
  const fill = input.type === "market" ? fillOrder(ledger, order, asset, quote, now) : null;
  return {
    order,
    fill,
    error: order.status === "rejected" ? order.reason : null,
  };
}

export function matchPendingTradingOrders(
  ledger: TradingLedger,
  quotes: Record<string, Quote>,
  assetForSymbol: (symbol: string) => Asset,
  now = Date.now(),
) {
  const fills: TradingFill[] = [];
  for (const order of ledger.orders) {
    if (order.status !== "pending") continue;
    const quote = quotes[order.symbol];
    if (!quote) continue;
    const fill = fillOrder(ledger, order, assetForSymbol(order.symbol), quote, now);
    if (fill) fills.push(fill);
  }
  return fills;
}

export function cancelTradingOrder(ledger: TradingLedger, orderId: string, now = Date.now()) {
  const order = ledger.orders.find((item) => item.id === orderId);
  if (!order || order.status !== "pending") return false;
  order.status = "cancelled";
  order.updatedAt = now;
  ledger.updatedAt = now;
  return true;
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface StrategyEvaluation {
  action: TradingSignalAction;
  reason: string;
  price: number;
  shortMa: number;
  longMa: number;
  cross: "above" | "below" | null;
}

export function evaluateSmaCross(
  points: TrendPoint[],
  shortWindow: number,
  longWindow: number,
  previousCross: "above" | "below" | null,
  quote: Quote,
): StrategyEvaluation | null {
  if (quote.price == null || points.length < longWindow + 1) return null;
  const values = points.map((point) => point.value).filter((value) => Number.isFinite(value));
  if (values.length < longWindow + 1) return null;
  const shortNow = average(values.slice(-shortWindow));
  const longNow = average(values.slice(-longWindow));
  const shortPrev = average(values.slice(-shortWindow - 1, -1));
  const longPrev = average(values.slice(-longWindow - 1, -1));
  if (shortNow == null || longNow == null || shortPrev == null || longPrev == null) return null;
  const currentCross = shortNow > longNow ? "above" : "below";
  const previous = shortPrev > longPrev ? "above" : "below";
  const cross = currentCross !== previous ? currentCross : null;
  if (!cross) {
    return {
      action: "hold",
      reason:
        currentCross === "above"
          ? `短期均线 ${shortNow.toFixed(2)} 位于长期均线 ${longNow.toFixed(2)} 上方，无新交叉`
          : `短期均线 ${shortNow.toFixed(2)} 位于长期均线 ${longNow.toFixed(2)} 下方，无新交叉`,
      price: quote.price,
      shortMa: shortNow,
      longMa: longNow,
      cross: previousCross,
    };
  }
  return {
    action: cross === "above" ? "buy" : "sell",
    reason:
      cross === "above"
        ? `SMA${shortWindow} 上穿 SMA${longWindow}`
        : `SMA${shortWindow} 下穿 SMA${longWindow}`,
    price: quote.price,
    shortMa: shortNow,
    longMa: longNow,
    cross,
  };
}

export function runSmaBacktest(
  points: TrendPoint[],
  strategy: TradingLedger["strategy"],
  asset: Asset,
  risk: TradingRiskConfig,
  initialCapital = TRADING_INITIAL_CAPITAL,
  now = Date.now(),
): TradingBacktestResult {
  const values = points.map((point) => point.value).filter((value) => Number.isFinite(value));
  const curve: TrendPoint[] = [];
  let cash = initialCapital;
  let quantity = 0;
  let averageCost = 0;
  let wins = 0;
  let sells = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let peak = initialCapital;
  let maxDrawdown = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (index >= strategy.longWindow) {
      const shortNow = average(values.slice(index - strategy.shortWindow + 1, index + 1));
      const longNow = average(values.slice(index - strategy.longWindow + 1, index + 1));
      const shortPrev = average(values.slice(index - strategy.shortWindow, index));
      const longPrev = average(values.slice(index - strategy.longWindow, index));
      if (shortNow != null && longNow != null && shortPrev != null && longPrev != null) {
        const wasAbove = shortPrev > longPrev;
        const isAbove = shortNow > longNow;
        if (!wasAbove && isAbove && quantity === 0) {
          const buyPrice = value * (1 + TRADING_SLIPPAGE_RATE);
          quantity = suggestedTradingQuantity(asset, cash * 0.995, buyPrice);
          if (quantity > 0) {
            const gross = buyPrice * quantity;
            const fee = calculateTradingFee(asset, "buy", gross);
            if (gross + fee <= cash) {
              cash -= gross + fee;
              averageCost = (gross + fee) / quantity;
            } else {
              quantity = 0;
            }
          }
        } else if (wasAbove && !isAbove && quantity > 0) {
          const sellPrice = value * (1 - TRADING_SLIPPAGE_RATE);
          const gross = sellPrice * quantity;
          const fee = calculateTradingFee(asset, "sell", gross);
          const pnl = (sellPrice - averageCost) * quantity - fee;
          cash += gross - fee;
          sells += 1;
          if (pnl > 0) {
            wins += 1;
            grossProfit += pnl;
          } else {
            grossLoss += Math.abs(pnl);
          }
          quantity = 0;
          averageCost = 0;
        }
      }
    }
    const equity = cash + quantity * value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
    curve.push({ label: points[index]?.label ?? String(index), value: equity });
  }

  const finalValue = values[values.length - 1] ?? 0;
  const finalEquity = cash + quantity * finalValue;
  if (curve.length) curve[curve.length - 1] = { ...curve[curve.length - 1], value: finalEquity };
  const totalReturn = initialCapital > 0 ? ((finalEquity - initialCapital) / initialCapital) * 100 : 0;
  return {
    id: tradingUid("backtest"),
    symbol: asset.symbol,
    ranAt: now,
    shortWindow: strategy.shortWindow,
    longWindow: strategy.longWindow,
    initialCapital,
    finalEquity,
    totalReturn,
    maxDrawdown,
    winRate: sells ? (wins / sells) * 100 : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null,
    tradeCount: sells,
    equityCurve: curve.slice(-500),
    riskPassed: totalReturn > 0 && maxDrawdown <= risk.maxDrawdownPct,
  };
}

export function evaluateTradingAgent(
  ledger: TradingLedger,
  signal: TradingSignal,
  quote: Quote,
  quantity: number,
  stats: TradingStats,
  now = Date.now(),
): TradingAgentDecision {
  const flags: string[] = [];
  const dailyLossBreached =
    stats.equity > 0 && stats.todayPnl <= -(stats.equity * ledger.risk.dailyLossLimitPct) / 100;
  if (!ledger.backtest) flags.push("尚未完成回测");
  else {
    if (ledger.backtest.totalReturn <= 0) flags.push("回测收益为负");
    if (ledger.backtest.maxDrawdown > ledger.risk.maxDrawdownPct) flags.push("回测回撤超过上限");
  }
  if (dailyLossBreached) flags.push("今日亏损触及风控线");
  const proposedNotional = (quote.price ?? 0) * quantity;
  const currentExposure = stats.marketValue;
  const projectedExposure =
    stats.equity > 0 ? ((currentExposure + proposedNotional) / stats.equity) * 100 : 100;
  if (signal.action === "buy" && projectedExposure > ledger.risk.maxPositionPct) {
    flags.push("预计仓位超过上限");
  }

  let action: TradingAgentDecision["action"] = "execute";
  let reason = "回测与风控检查通过，允许执行信号";
  if (
    !ledger.backtest ||
    (ledger.backtest && ledger.backtest.totalReturn <= 0) ||
    dailyLossBreached ||
    stats.maxDrawdown > ledger.risk.maxDrawdownPct
  ) {
    action = "block";
    reason = flags[0] || "回撤风控未通过";
  } else if (signal.action === "buy" && projectedExposure > ledger.risk.maxPositionPct) {
    action = "reduce";
    reason = "预计仓位超过上限，建议减半执行";
  } else if (signal.action === "sell" && !ledger.positions.some((position) => position.symbol === signal.symbol)) {
    action = "observe";
    reason = "当前没有可卖持仓，保留卖出信号";
  }

  const confidence = Math.max(
    20,
    Math.min(
      98,
      72 +
        (ledger.backtest ? Math.min(18, Math.max(-18, ledger.backtest.totalReturn)) : -30) -
        flags.length * 8,
    ),
  );
  const decision: TradingAgentDecision = {
    id: tradingUid("agent"),
    at: now,
    symbol: signal.symbol,
    action,
    confidence,
    reason,
    signalId: signal.id,
    riskFlags: flags,
  };
  ledger.agentDecisions.unshift(decision);
  ledger.agentDecisions = ledger.agentDecisions.slice(0, 200);
  ledger.updatedAt = now;
  return decision;
}

export function riskExitForPosition(
  position: TradingPosition,
  quote: Quote | undefined,
  risk: TradingRiskConfig,
) {
  if (!quote?.price || position.averageCost <= 0) return null;
  const pnlPct = ((quote.price - position.averageCost) / position.averageCost) * 100;
  if (pnlPct <= -risk.stopLossPct) return { reason: "触发止损", pnlPct };
  if (pnlPct >= risk.takeProfitPct) return { reason: "触发止盈", pnlPct };
  return null;
}

export function recordStrategyEvaluation(
  ledger: TradingLedger,
  symbol: string,
  evaluation: StrategyEvaluation,
  now = Date.now(),
) {
  ledger.strategy.symbol = symbol;
  ledger.strategy.lastEvaluatedAt = now;
  ledger.strategy.lastAction = evaluation.action;
  ledger.strategy.lastReason = evaluation.reason;
  ledger.strategy.lastShortMa = evaluation.shortMa;
  ledger.strategy.lastLongMa = evaluation.longMa;
  if (evaluation.cross) ledger.strategy.lastCross = evaluation.cross;
  ledger.updatedAt = now;
}

export function createTradingSignal(
  ledger: TradingLedger,
  symbol: string,
  evaluation: StrategyEvaluation,
  now = Date.now(),
) {
  const signal: TradingSignal = {
    id: tradingUid("signal"),
    symbol,
    action: evaluation.action,
    reason: evaluation.reason,
    price: evaluation.price,
    shortMa: evaluation.shortMa,
    longMa: evaluation.longMa,
    at: now,
    orderId: null,
  };
  ledger.signals.unshift(signal);
  ledger.signals = ledger.signals.slice(0, 200);
  return signal;
}

export function marketValue(ledger: TradingLedger, quotes: Record<string, Quote>) {
  return ledger.positions.reduce((sum, position) => {
    const price = quotes[position.symbol]?.price ?? position.averageCost;
    return sum + price * position.quantity;
  }, 0);
}

export function recordEquityPoint(
  ledger: TradingLedger,
  quotes: Record<string, Quote>,
  now = Date.now(),
  force = false,
) {
  const latest = ledger.equityCurve[ledger.equityCurve.length - 1];
  if (!force && latest && now - latest.at < 60_000) return false;
  const positionsValue = marketValue(ledger, quotes);
  const point = {
    at: now,
    equity: ledger.cash + positionsValue,
    cash: ledger.cash,
    marketValue: positionsValue,
  };
  ledger.equityCurve.push(point);
  ledger.equityCurve = ledger.equityCurve.slice(-2000);
  ledger.updatedAt = now;
  return true;
}

export interface TradingStats {
  equity: number;
  marketValue: number;
  totalPnl: number;
  totalReturn: number;
  unrealizedPnl: number;
  realizedPnl: number;
  fees: number;
  todayPnl: number;
  maxDrawdown: number;
  winRate: number | null;
  profitFactor: number | null;
}

export function calculateTradingStats(
  ledger: TradingLedger,
  quotes: Record<string, Quote>,
  now = new Date(),
): TradingStats {
  const positionsValue = marketValue(ledger, quotes);
  const equity = ledger.cash + positionsValue;
  const unrealizedPnl = ledger.positions.reduce((sum, position) => {
    const price = quotes[position.symbol]?.price ?? position.averageCost;
    return sum + (price - position.averageCost) * position.quantity;
  }, 0);
  const fees = ledger.fills.reduce((sum, fill) => sum + fill.fee, 0);
  const sells = ledger.fills.filter((fill) => fill.side === "sell");
  const wins = sells.filter((fill) => fill.realizedPnl > 0);
  const grossProfit = wins.reduce((sum, fill) => sum + fill.realizedPnl, 0);
  const grossLoss = Math.abs(
    sells.filter((fill) => fill.realizedPnl < 0).reduce((sum, fill) => sum + fill.realizedPnl, 0),
  );
  let peak = 0;
  let maxDrawdown = 0;
  for (const point of ledger.equityCurve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, ((peak - point.equity) / peak) * 100);
  }
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const previousPoint = [...ledger.equityCurve].reverse().find((point) => point.at < startOfDay.getTime());
  const todayPnl = equity - (previousPoint?.equity ?? ledger.initialCapital);
  return {
    equity,
    marketValue: positionsValue,
    totalPnl: equity - ledger.initialCapital,
    totalReturn: ledger.initialCapital > 0 ? ((equity - ledger.initialCapital) / ledger.initialCapital) * 100 : 0,
    unrealizedPnl,
    realizedPnl: ledger.realizedPnl,
    fees,
    todayPnl,
    maxDrawdown,
    winRate: sells.length ? (wins.length / sells.length) * 100 : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null,
  };
}

export function resetTradingLedger(ledger: TradingLedger, symbol = "", now = Date.now()) {
  const next = defaultTradingLedger(now, symbol);
  Object.assign(ledger, next);
  return ledger;
}
