import type { AlertCondition, AlertRule, AlertType, Quote } from "../types";
import { formatPercent, formatPrice, priceDigits } from "./format";

export const ALERT_SHORT_LABELS: Record<AlertType, string> = {
  priceAbove: "涨破",
  priceBelow: "跌破",
  pctAbove: "涨幅",
  pctBelow: "跌幅",
  amountAbove: "成交额",
};

export function alertThresholdText(condition: Pick<AlertCondition, "type" | "threshold">) {
  if (condition.type === "pctAbove" || condition.type === "pctBelow") {
    return `${Math.abs(condition.threshold).toFixed(2)}%`;
  }
  if (condition.type === "amountAbove") {
    return `${condition.threshold.toFixed(2)} 亿`;
  }
  return formatPrice(condition.threshold, condition.threshold < 2 ? 4 : 2);
}

export function alertConditions(rule: AlertRule): AlertCondition[] {
  return rule.conditions?.length ? rule.conditions : [{ type: rule.type, threshold: rule.threshold }];
}

export function alertRuleSummary(rule: AlertRule) {
  const joiner = rule.logic === "any" && alertConditions(rule).length > 1 ? " 或 " : " 且 ";
  return alertConditions(rule)
    .map((condition) => `${ALERT_SHORT_LABELS[condition.type]} ${alertThresholdText(condition)}`)
    .join(joiner);
}

export function alertConditionText(rule: AlertRule, name: string) {
  const prefix = name ? `${name} ` : "";
  return `${prefix}${alertRuleSummary(rule)}`;
}

export function isConditionTriggered(condition: AlertCondition, quote: Quote) {
  if (condition.type === "priceAbove" || condition.type === "priceBelow") {
    if (quote.price == null) return false;
    return condition.type === "priceAbove"
      ? quote.price >= condition.threshold
      : quote.price <= condition.threshold;
  }
  if (condition.type === "amountAbove") {
    return quote.amount != null && quote.amount >= condition.threshold * 100_000_000;
  }
  if (quote.changePct == null) return false;
  return condition.type === "pctAbove"
    ? quote.changePct >= condition.threshold
    : quote.changePct <= -Math.abs(condition.threshold);
}

export function isTriggered(rule: AlertRule, quote: Quote | undefined) {
  if (!rule.enabled || !quote) return false;
  const conditions = alertConditions(rule);
  return rule.logic === "any"
    ? conditions.some((condition) => isConditionTriggered(condition, quote))
    : conditions.every((condition) => isConditionTriggered(condition, quote));
}

export function alertEventMessage(rule: AlertRule, quote: Quote) {
  const digits = priceDigits(quote.symbol.startsWith("jj") ? "fund" : "stock", quote.price);
  const price = formatPrice(quote.price, digits);
  const pct = formatPercent(quote.changePct);
  const first = alertConditions(rule)[0];
  if (rule.conditions && rule.conditions.length > 1) {
    return `${quote.name} 触发提醒：${alertRuleSummary(rule)}（现价 ${price}，${pct}）`;
  }
  if (first.type === "priceAbove") {
    return `${quote.name} 现价 ${price}，已涨破提醒价 ${alertThresholdText(first)}（${pct}）`;
  }
  if (first.type === "priceBelow") {
    return `${quote.name} 现价 ${price}，已跌破提醒价 ${alertThresholdText(first)}（${pct}）`;
  }
  if (first.type === "pctAbove") {
    return `${quote.name} 今日涨幅 ${pct}，已超过 ${Math.abs(first.threshold).toFixed(2)}%（现价 ${price}）`;
  }
  if (first.type === "pctBelow") {
    return `${quote.name} 今日跌幅 ${pct}，已超过 ${Math.abs(first.threshold).toFixed(2)}%（现价 ${price}）`;
  }
  return `${quote.name} 今日成交额已达到 ${alertThresholdText(first)}（现价 ${price}，${pct}）`;
}
