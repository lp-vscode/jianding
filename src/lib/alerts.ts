import type { AlertCondition, AlertRule, AlertType, Quote, TrendPoint } from "../types";
import { formatPercent, formatPrice, priceDigits } from "./format";

export const ALERT_SHORT_LABELS: Record<AlertType, string> = {
  priceAbove: "涨破",
  priceBelow: "跌破",
  pctAbove: "涨幅",
  pctBelow: "跌幅",
  amountAbove: "成交额",
  rsiAbove: "RSI 高于",
  rsiBelow: "RSI 低于",
  smaGolden: "均线金叉",
  smaDeath: "均线死叉",
  volumeSpike: "放量",
  gapUp: "向上跳空",
  gapDown: "向下跳空",
  pnlAbove: "持仓盈利",
  pnlBelow: "持仓亏损",
};

export function alertThresholdText(
  condition: Pick<AlertCondition, "type" | "threshold" | "period" | "secondaryPeriod">,
) {
  if (
    condition.type === "pctAbove" ||
    condition.type === "pctBelow" ||
    condition.type === "gapUp" ||
    condition.type === "gapDown" ||
    condition.type === "pnlAbove" ||
    condition.type === "pnlBelow"
  ) {
    return `${Math.abs(condition.threshold).toFixed(2)}%`;
  }
  if (condition.type === "amountAbove") {
    return `${condition.threshold.toFixed(2)} 亿`;
  }
  if (condition.type === "rsiAbove" || condition.type === "rsiBelow") {
    return `${Math.abs(condition.threshold).toFixed(1)}（${condition.period ?? 14} 日）`;
  }
  if (condition.type === "smaGolden" || condition.type === "smaDeath") {
    const short = condition.period ?? 5;
    const long = condition.secondaryPeriod ?? 20;
    return `SMA ${short}/${long}`;
  }
  if (condition.type === "volumeSpike") {
    return `${condition.threshold.toFixed(1)}× ${condition.period ?? 20} 日均量`;
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

export interface AlertEvaluationContext {
  trend?: TrendPoint[];
  holdingCost?: number;
}

export function alertConditionText(rule: AlertRule, name: string) {
  const prefix = name ? `${name} ` : "";
  return `${prefix}${alertRuleSummary(rule)}`;
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rsi(points: TrendPoint[], period: number) {
  if (points.length <= period) return null;
  const values = points.map((point) => point.value);
  let gains = 0;
  let losses = 0;
  for (let index = values.length - period; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }
  if (losses === 0) return gains > 0 ? 100 : 50;
  const relativeStrength = gains / losses;
  return 100 - 100 / (1 + relativeStrength);
}

export function isConditionTriggered(
  condition: AlertCondition,
  quote: Quote,
  context: AlertEvaluationContext = {},
) {
  if (condition.type === "priceAbove" || condition.type === "priceBelow") {
    if (quote.price == null) return false;
    return condition.type === "priceAbove"
      ? quote.price >= condition.threshold
      : quote.price <= condition.threshold;
  }
  if (condition.type === "amountAbove") {
    return quote.amount != null && quote.amount >= condition.threshold * 100_000_000;
  }
  if (condition.type === "rsiAbove" || condition.type === "rsiBelow") {
    const value = context.trend ? rsi(context.trend, condition.period ?? 14) : null;
    if (value == null) return false;
    return condition.type === "rsiAbove" ? value >= condition.threshold : value <= condition.threshold;
  }
  if (condition.type === "smaGolden" || condition.type === "smaDeath") {
    const points = context.trend ?? [];
    const short = condition.period ?? 5;
    const long = condition.secondaryPeriod ?? 20;
    if (points.length < long + 1) return false;
    const values = points.map((point) => point.value);
    const shortNow = average(values.slice(-short));
    const longNow = average(values.slice(-long));
    const shortPrev = average(values.slice(-short - 1, -1));
    const longPrev = average(values.slice(-long - 1, -1));
    if (shortNow == null || longNow == null || shortPrev == null || longPrev == null) return false;
    const wasAbove = shortPrev > longPrev;
    const isAbove = shortNow > longNow;
    return condition.type === "smaGolden" ? !wasAbove && isAbove : wasAbove && !isAbove;
  }
  if (condition.type === "volumeSpike") {
    const period = condition.period ?? 20;
    const volumes = (context.trend ?? [])
      .slice(-period)
      .map((point) => point.volume)
      .filter((value): value is number => value != null && Number.isFinite(value));
    const averageVolume = average(volumes);
    return Boolean(
      averageVolume &&
        quote.volume != null &&
        quote.volume >= averageVolume * condition.threshold,
    );
  }
  if (condition.type === "gapUp" || condition.type === "gapDown") {
    if (quote.open == null || quote.previousClose == null || quote.previousClose <= 0) return false;
    const gap = ((quote.open - quote.previousClose) / quote.previousClose) * 100;
    return condition.type === "gapUp"
      ? gap >= Math.abs(condition.threshold)
      : gap <= -Math.abs(condition.threshold);
  }
  if (condition.type === "pnlAbove" || condition.type === "pnlBelow") {
    if (!context.holdingCost || quote.price == null) return false;
    const pnlPct = ((quote.price - context.holdingCost) / context.holdingCost) * 100;
    return condition.type === "pnlAbove"
      ? pnlPct >= Math.abs(condition.threshold)
      : pnlPct <= -Math.abs(condition.threshold);
  }
  if (quote.changePct == null) return false;
  return condition.type === "pctAbove"
    ? quote.changePct >= condition.threshold
    : quote.changePct <= -Math.abs(condition.threshold);
}

export function isTriggered(
  rule: AlertRule,
  quote: Quote | undefined,
  context: AlertEvaluationContext = {},
) {
  if (!rule.enabled || !quote) return false;
  const conditions = alertConditions(rule);
  return rule.logic === "any"
    ? conditions.some((condition) => isConditionTriggered(condition, quote, context))
    : conditions.every((condition) => isConditionTriggered(condition, quote, context));
}

export function alertEventMessage(rule: AlertRule, quote: Quote) {
  const digits = priceDigits(quote.symbol.startsWith("jj") ? "fund" : "stock", quote.price);
  const price = formatPrice(quote.price, digits);
  const pct = formatPercent(quote.changePct);
  const first = alertConditions(rule)[0];
  const technical = !["priceAbove", "priceBelow", "pctAbove", "pctBelow", "amountAbove"].includes(first.type);
  if ((rule.conditions && rule.conditions.length > 1) || technical) {
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
