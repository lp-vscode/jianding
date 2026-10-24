export type AssetKind = "stock" | "fund";
export type Market = "sh" | "sz" | "jj";
export type ViewKey = "watchlist" | "holdings" | "trading" | "alerts" | "settings";
export type QuoteState = "live" | "nav" | "demo";
export type TrendRange = "intraday" | "5d" | "day" | "week" | "month" | "1m" | "3m" | "1y";
export type GainLossMode = "china" | "accessible";
export type WatchlistDensity = "comfortable" | "compact";
export type WatchlistSort = "default" | "changeDesc" | "changeAsc" | "priceDesc" | "priceAsc" | "volumeDesc";

export interface Asset {
  symbol: string;
  code: string;
  name: string;
  kind: AssetKind;
  market: Market;
  typeLabel: string;
  addedAt: number;
}

export interface Quote {
  symbol: string;
  code: string;
  name: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  amount: number | null;
  updatedAt: string | null;
  navDate: string | null;
  state: QuoteState;
  source: string;
}

export interface TrendPoint {
  label: string;
  value: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

export interface IndexQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
}

export interface MarketSnapshot {
  quotes: Record<string, Quote>;
  indices: IndexQuote[];
  updatedAt: number;
}

export interface Holding {
  id: string;
  symbol: string;
  shares: number;
  cost: number;
  note: string;
  updatedAt: number;
}

export type AlertType =
  | "priceAbove"
  | "priceBelow"
  | "pctAbove"
  | "pctBelow"
  | "amountAbove"
  | "rsiAbove"
  | "rsiBelow"
  | "smaGolden"
  | "smaDeath"
  | "volumeSpike"
  | "gapUp"
  | "gapDown"
  | "pnlAbove"
  | "pnlBelow";
export type AlertLogic = "all" | "any";
export type AlertSchedule = "any" | "trading" | "preopen" | "last10";

export interface AlertCondition {
  type: AlertType;
  threshold: number;
  period?: number;
  secondaryPeriod?: number;
}

export interface AlertRule {
  id: string;
  symbol: string;
  type: AlertType;
  threshold: number;
  conditions?: AlertCondition[];
  logic?: AlertLogic;
  enabled: boolean;
  createdAt: number;
  lastTriggeredAt: number | null;
  schedule?: AlertSchedule;
}

export interface WatchlistGroup {
  id: string;
  name: string;
  symbols: string[];
  createdAt: number;
}

export type TradingSide = "buy" | "sell";
export type TradingOrderType = "market" | "limit";
export type TradingOrderStatus = "pending" | "filled" | "cancelled" | "rejected";
export type TradingSignalAction = "buy" | "sell" | "hold";
export type TradingCross = "above" | "below" | null;
export type TradingAgentAction = "execute" | "reduce" | "block" | "observe";

export interface TradingStrategy {
  enabled: boolean;
  agentEnabled: boolean;
  symbol: string;
  shortWindow: number;
  longWindow: number;
  orderNotional: number;
  lastCross: TradingCross;
  lastEvaluatedAt: number | null;
  lastAction: TradingSignalAction;
  lastReason: string;
  lastShortMa: number | null;
  lastLongMa: number | null;
}

export interface TradingRiskConfig {
  maxPositionPct: number;
  maxDrawdownPct: number;
  dailyLossLimitPct: number;
  stopLossPct: number;
  takeProfitPct: number;
}

export interface TradingBacktestResult {
  id: string;
  symbol: string;
  ranAt: number;
  shortWindow: number;
  longWindow: number;
  initialCapital: number;
  finalEquity: number;
  totalReturn: number;
  maxDrawdown: number;
  winRate: number | null;
  profitFactor: number | null;
  tradeCount: number;
  equityCurve: TrendPoint[];
  riskPassed: boolean;
}

export interface TradingAgentDecision {
  id: string;
  at: number;
  symbol: string;
  action: TradingAgentAction;
  confidence: number;
  reason: string;
  signalId: string | null;
  riskFlags: string[];
}

export interface TradingSignal {
  id: string;
  symbol: string;
  action: TradingSignalAction;
  reason: string;
  price: number;
  shortMa: number;
  longMa: number;
  at: number;
  orderId: string | null;
}

export interface TradingOrder {
  id: string;
  symbol: string;
  side: TradingSide;
  type: TradingOrderType;
  quantity: number;
  limitPrice: number | null;
  status: TradingOrderStatus;
  createdAt: number;
  updatedAt: number;
  filledAt: number | null;
  filledPrice: number | null;
  fee: number;
  reason: string;
}

export interface TradingFill {
  id: string;
  orderId: string;
  symbol: string;
  side: TradingSide;
  quantity: number;
  price: number;
  fee: number;
  realizedPnl: number;
  at: number;
}

export interface TradingPosition {
  symbol: string;
  quantity: number;
  averageCost: number;
  realizedPnl: number;
  openedAt: number;
  updatedAt: number;
}

export interface TradingEquityPoint {
  at: number;
  equity: number;
  cash: number;
  marketValue: number;
}

export interface TradingLedger {
  version: 1;
  initialCapital: number;
  cash: number;
  realizedPnl: number;
  positions: TradingPosition[];
  orders: TradingOrder[];
  fills: TradingFill[];
  signals: TradingSignal[];
  equityCurve: TradingEquityPoint[];
  strategy: TradingStrategy;
  risk: TradingRiskConfig;
  backtest: TradingBacktestResult | null;
  agentDecisions: TradingAgentDecision[];
  updatedAt: number;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  symbol: string;
  name: string;
  message: string;
  price: number;
  at: number;
  read: boolean;
  changePct?: number | null;
  amount?: number | null;
  volume?: number | null;
  source?: string;
}

export interface Settings {
  refreshSeconds: 5 | 15 | 30 | 60;
  startView: ViewKey;
  notifications: boolean;
  gainLossMode: GainLossMode;
  watchlistDensity: WatchlistDensity;
  watchlistSort: WatchlistSort;
}

export interface SearchResult {
  symbol: string;
  code: string;
  name: string;
  kind: AssetKind;
  market: Market;
  typeLabel: string;
}

export interface ToastItem {
  id: number;
  message: string;
  tone: "success" | "error" | "info";
}
