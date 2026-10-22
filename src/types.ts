export type AssetKind = "stock" | "fund";
export type Market = "sh" | "sz" | "jj";
export type ViewKey = "watchlist" | "holdings" | "alerts" | "settings";
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

export interface Holding {
  id: string;
  symbol: string;
  shares: number;
  cost: number;
  note: string;
  updatedAt: number;
}

export type AlertType = "priceAbove" | "priceBelow" | "pctAbove" | "pctBelow" | "amountAbove";
export type AlertLogic = "all" | "any";

export interface AlertCondition {
  type: AlertType;
  threshold: number;
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
}

export interface WatchlistGroup {
  id: string;
  name: string;
  symbols: string[];
  createdAt: number;
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
