import type { AlertRule, AlertType, Quote } from "../types";
import { formatPercent, formatPrice, priceDigits } from "./format";

export const ALERT_LABELS: Record<AlertType, string> = {
  priceAbove: "价格涨破",
  priceBelow: "价格跌破",
  pctAbove: "涨幅超过",
  pctBelow: "跌幅超过",
};

export const ALERT_SHORT_LABELS: Record<AlertType, string> = {
  priceAbove: "涨破",
  priceBelow: "跌破",
  pctAbove: "涨幅",
  pctBelow: "跌幅",
};

export function alertThresholdText(rule: AlertRule) {
  if (rule.type === "pctAbove" || rule.type === "pctBelow") {
    return `${rule.threshold.toFixed(2)}%`;
  }
  return formatPrice(rule.threshold, rule.threshold < 2 ? 4 : 2);
}

export function alertConditionText(rule: AlertRule, name: string) {
  return `${name} ${ALERT_SHORT_LABELS[rule.type]} ${alertThresholdText(rule)}`;
}

export function isTriggered(rule: AlertRule, quote: Quote | undefined) {
  if (!rule.enabled || !quote) return false;
  if (rule.type === "priceAbove" || rule.type === "priceBelow") {
    if (quote.price == null) return false;
    return rule.type === "priceAbove" ? quote.price >= rule.threshold : quote.price <= rule.threshold;
  }
  if (quote.changePct == null) return false;
  return rule.type === "pctAbove" ? quote.changePct >= rule.threshold : quote.changePct <= -Math.abs(rule.threshold);
}

export function alertEventMessage(rule: AlertRule, quote: Quote) {
  const digits = priceDigits(quote.symbol.startsWith("jj") ? "fund" : "stock", quote.price);
  const price = formatPrice(quote.price, digits);
  const pct = formatPercent(quote.changePct);
  if (rule.type === "priceAbove") {
    return `${quote.name} 现价 ${price}，已涨破提醒价 ${alertThresholdText(rule)}（${pct}）`;
  }
  if (rule.type === "priceBelow") {
    return `${quote.name} 现价 ${price}，已跌破提醒价 ${alertThresholdText(rule)}（${pct}）`;
  }
  if (rule.type === "pctAbove") {
    return `${quote.name} 今日涨幅 ${pct}，已超过 ${rule.threshold.toFixed(2)}%（现价 ${price}）`;
  }
  return `${quote.name} 今日跌幅 ${pct}，已超过 ${Math.abs(rule.threshold).toFixed(2)}%（现价 ${price}）`;
}
