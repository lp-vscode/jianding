const technicalTypes = new Set(["rsiAbove", "rsiBelow", "smaGolden", "smaDeath", "volumeSpike"]);

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function rsi(points, period) {
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
  return 100 - 100 / (1 + gains / losses);
}

export function ruleNeedsTrend(rule) {
  return (rule.conditions?.length ? rule.conditions : [{ type: rule.type }]).some((condition) =>
    technicalTypes.has(condition.type),
  );
}

export function conditionsOf(rule) {
  return rule.conditions?.length
    ? rule.conditions
    : [{ type: rule.type, threshold: rule.threshold }];
}

function scheduleMatches(schedule = "any", now = new Date()) {
  if (schedule === "any") return true;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = get("weekday");
  if (weekday === "Sat" || weekday === "Sun") return false;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  if (schedule === "trading") {
    return (minutes >= 570 && minutes <= 690) || (minutes >= 780 && minutes <= 900);
  }
  if (schedule === "preopen") return minutes >= 555 && minutes < 570;
  if (schedule === "last10") return minutes >= 890 && minutes <= 900;
  return true;
}

export function evaluateCondition(condition, quote, context = {}) {
  if (!quote) return false;
  if (condition.type === "priceAbove") return quote.price != null && quote.price >= condition.threshold;
  if (condition.type === "priceBelow") return quote.price != null && quote.price <= condition.threshold;
  if (condition.type === "pctAbove") return quote.changePct != null && quote.changePct >= condition.threshold;
  if (condition.type === "pctBelow") {
    return quote.changePct != null && quote.changePct <= -Math.abs(condition.threshold);
  }
  if (condition.type === "amountAbove") {
    return quote.amount != null && quote.amount >= condition.threshold * 100_000_000;
  }
  if (condition.type === "gapUp" || condition.type === "gapDown") {
    if (quote.open == null || !quote.previousClose) return false;
    const gap = ((quote.open - quote.previousClose) / quote.previousClose) * 100;
    return condition.type === "gapUp"
      ? gap >= Math.abs(condition.threshold)
      : gap <= -Math.abs(condition.threshold);
  }
  if (condition.type === "pnlAbove" || condition.type === "pnlBelow") {
    if (!context.holdingCost || quote.price == null) return false;
    const pnl = ((quote.price - context.holdingCost) / context.holdingCost) * 100;
    return condition.type === "pnlAbove"
      ? pnl >= Math.abs(condition.threshold)
      : pnl <= -Math.abs(condition.threshold);
  }
  const points = context.trend ?? [];
  if (condition.type === "rsiAbove" || condition.type === "rsiBelow") {
    const value = rsi(points, condition.period ?? 14);
    if (value == null) return false;
    return condition.type === "rsiAbove"
      ? value >= condition.threshold
      : value <= condition.threshold;
  }
  if (condition.type === "smaGolden" || condition.type === "smaDeath") {
    const short = condition.period ?? 5;
    const long = condition.secondaryPeriod ?? 20;
    if (points.length < long + 1) return false;
    const values = points.map((point) => point.value);
    const shortNow = average(values.slice(-short));
    const longNow = average(values.slice(-long));
    const shortPrev = average(values.slice(-short - 1, -1));
    const longPrev = average(values.slice(-long - 1, -1));
    if ([shortNow, longNow, shortPrev, longPrev].some((value) => value == null)) return false;
    const wasAbove = shortPrev > longPrev;
    const isAbove = shortNow > longNow;
    return condition.type === "smaGolden" ? !wasAbove && isAbove : wasAbove && !isAbove;
  }
  if (condition.type === "volumeSpike") {
    const values = points
      .slice(-(condition.period ?? 20))
      .map((point) => point.volume)
      .filter((value) => Number.isFinite(value));
    const baseline = average(values);
    return baseline != null && quote.volume != null && quote.volume >= baseline * condition.threshold;
  }
  return false;
}

export function evaluateRule(rule, quote, context = {}, now = new Date()) {
  if (!rule?.enabled || !quote || !scheduleMatches(rule.schedule, now)) return false;
  const conditions = conditionsOf(rule);
  return rule.logic === "any"
    ? conditions.some((condition) => evaluateCondition(condition, quote, context))
    : conditions.every((condition) => evaluateCondition(condition, quote, context));
}

export function alertMessage(rule, quote, context = {}) {
  const conditions = conditionsOf(rule);
  const format = (condition) => {
    if (condition.type.startsWith("pct") || condition.type.startsWith("pnl") || condition.type.startsWith("gap")) {
      return `${condition.type} ${Math.abs(condition.threshold).toFixed(2)}%`;
    }
    if (condition.type === "amountAbove") return `成交额 ${condition.threshold.toFixed(2)} 亿`;
    if (condition.type === "rsiAbove" || condition.type === "rsiBelow") {
      return `${condition.type} ${condition.threshold} (${condition.period ?? 14}日)`;
    }
    if (condition.type === "smaGolden" || condition.type === "smaDeath") {
      return `${condition.type} ${condition.period ?? 5}/${condition.secondaryPeriod ?? 20}`;
    }
    if (condition.type === "volumeSpike") {
      return `成交量 ${condition.threshold}× ${condition.period ?? 20}日均量`;
    }
    return `${condition.type} ${condition.threshold}`;
  };
  const price = quote.price == null ? "--" : quote.price.toFixed(2);
  const pct = quote.changePct == null ? "--" : `${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%`;
  return `${quote.name} 触发 ${conditions.map(format).join(rule.logic === "any" ? " 或 " : " 且 ")}（现价 ${price}，${pct}）`;
}
