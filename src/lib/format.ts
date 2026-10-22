export function formatPrice(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "--";
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatSigned(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "--";
  const text = Math.abs(value).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (value > 0) return `+${text}`;
  if (value < 0) return `-${text}`;
  return text;
}

export function formatPercent(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${formatSigned(value, digits)}%`;
}

export function directionMark(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value === 0) return "•";
  return value > 0 ? "▲" : "▼";
}

export function formatCompactMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  if (abs >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿`;
  if (abs >= 10_000) return `${(value / 10_000).toFixed(2)} 万`;
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

export function formatMoney(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "--";
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatVolume(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(2)} 万`;
  return Math.round(value).toLocaleString("zh-CN");
}

export function formatTime(iso: string | null | undefined) {
  if (!iso) return "--";
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (match) return `${match[1]}/${match[2]}/${match[3]} ${match[4]}:${match[5]}`;
  return iso;
}

export function timeAgo(timestamp: number | null | undefined) {
  if (!timestamp) return "尚未触发";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 30) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} 小时前`;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function priceDigits(kind: string, price: number | null | undefined) {
  if (kind === "fund" && price != null && price < 2) return 4;
  if (kind === "fund") return 3;
  return 2;
}

export function toneOf(value: number | null | undefined) {
  if (value == null || value === 0) return "flat" as const;
  return value > 0 ? ("up" as const) : ("down" as const);
}
