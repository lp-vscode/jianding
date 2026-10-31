import type { Quote } from "../types";

export type MarketPhase = "盘前" | "集合竞价" | "交易中" | "午间休市" | "已收盘" | "周末休市";

export interface IntradaySignal {
  key: "surge" | "drop" | "nearHigh" | "nearLow";
  label: string;
  tone: "up" | "down" | "flat";
}

const SHANGHAI_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function shanghaiParts(now = new Date()) {
  const parts = SHANGHAI_FORMATTER.formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") === 24 ? 0 : read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

export function shanghaiDate(now = new Date()) {
  const parts = shanghaiParts(now);
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

export function marketPhase(now = new Date()): MarketPhase {
  const local = shanghaiDate(now);
  const day = local.getDay();
  if (day === 0 || day === 6) return "周末休市";
  const minutes = local.getHours() * 60 + local.getMinutes();
  if (minutes < 9 * 60 + 15) return "盘前";
  if (minutes < 9 * 60 + 30) return "集合竞价";
  if (minutes <= 11 * 60 + 30) return "交易中";
  if (minutes < 13 * 60) return "午间休市";
  if (minutes <= 15 * 60) return "交易中";
  return "已收盘";
}

export function isMarketOpen(now = new Date()) {
  return marketPhase(now) === "交易中";
}

export function marketClock(now = new Date()) {
  const parts = shanghaiParts(now);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function effectiveRefreshMs(seconds: number, now = new Date()) {
  return isMarketOpen(now) ? seconds * 1000 : Math.max(60_000, seconds * 4000);
}

export function dataDelayLimitMs(seconds: number, now = new Date()) {
  return Math.max(45_000, effectiveRefreshMs(seconds, now) * 1.5);
}

export function isDataDelayed(lastUpdated: number | null, seconds: number, now = new Date()) {
  if (!lastUpdated) return false;
  return now.getTime() - lastUpdated > dataDelayLimitMs(seconds, now);
}

export function marketLabel(phase: MarketPhase) {
  if (phase === "交易中") return "交易中";
  if (phase === "集合竞价") return "集合竞价";
  if (phase === "午间休市") return "午间休市";
  if (phase === "周末休市") return "周末休市";
  if (phase === "盘前") return "盘前";
  return "已收盘";
}

export function intradaySignal(quote: Quote | undefined): IntradaySignal | null {
  if (!quote || quote.price == null || quote.symbol.startsWith("jj")) return null;
  if (quote.changePct != null && Math.abs(quote.changePct) >= 5) {
    return quote.changePct >= 0
      ? { key: "surge", label: `快速上涨 ${quote.changePct.toFixed(2)}%`, tone: "up" }
      : { key: "drop", label: `快速下跌 ${Math.abs(quote.changePct).toFixed(2)}%`, tone: "down" };
  }
  if (
    quote.high != null &&
    quote.high > 0 &&
    quote.changePct != null &&
    quote.changePct >= 2 &&
    quote.price >= quote.high * 0.998
  ) {
    return {
      key: "nearHigh",
      label: `接近今日高点 ${quote.high.toFixed(2)}`,
      tone: "up",
    };
  }
  if (
    quote.low != null &&
    quote.low > 0 &&
    quote.changePct != null &&
    quote.changePct <= -2 &&
    quote.price <= quote.low * 1.002
  ) {
    return {
      key: "nearLow",
      label: `接近今日低点 ${quote.low.toFixed(2)}`,
      tone: "down",
    };
  }
  return null;
}
