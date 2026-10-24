const QUOTE_URL = "https://qt.gtimg.cn/q=";
const KLINE_URL = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim() || value.trim() === "--") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function tencentTimestamp(value) {
  if (!/^\d{14}/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}`;
}

export function parseTencentQuotes(text) {
  return text
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .flatMap((segment) => {
      const equals = segment.indexOf("=");
      if (equals < 0) return [];
      const name = segment.slice(0, equals).trim();
      if (!name.startsWith("v_")) return [];
      const symbol = name.slice(2);
      if (!/^(sh|sz)\d{6}$/.test(symbol)) return [];
      const fields = segment.slice(equals + 1).trim().replace(/^"|"$/g, "").split("~");
      if (fields.length < 35) return [];
      const volume = parseNumber(fields[36]);
      const amount =
        parseNumber(fields[35]?.split("/")[2]) ??
        (parseNumber(fields[37]) === null ? null : parseNumber(fields[37]) * 10_000);
      return [
        {
          symbol,
          code: fields[2] ?? symbol.slice(2),
          name: fields[1] ?? symbol,
          price: parseNumber(fields[3]),
          previousClose: parseNumber(fields[4]),
          change: parseNumber(fields[31]),
          changePct: parseNumber(fields[32]),
          open: parseNumber(fields[5]),
          high: parseNumber(fields[33]),
          low: parseNumber(fields[34]),
          volume: volume === null ? null : volume * 100,
          amount,
          updatedAt: tencentTimestamp(fields[30] ?? ""),
          navDate: null,
          state: "live",
          source: "腾讯行情",
        },
      ];
    });
}

export async function fetchStockQuotes(symbols, fetchImpl = fetch) {
  const normalized = [...new Set(symbols.filter((symbol) => /^(sh|sz)\d{6}$/.test(symbol)))];
  if (!normalized.length) return [];
  const response = await fetchImpl(`${QUOTE_URL}${normalized.join(",")}`, {
    headers: { "user-agent": "Mozilla/5.0 JiandingLocalBackend/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`腾讯行情请求失败: ${response.status}`);
  const bytes = await response.arrayBuffer();
  let text;
  try {
    text = new TextDecoder("gbk").decode(bytes);
  } catch {
    text = new TextDecoder().decode(bytes);
  }
  return parseTencentQuotes(text);
}

export async function fetchDailyTrend(symbol, count = 250, fetchImpl = fetch) {
  if (!/^(sh|sz)\d{6}$/.test(symbol)) return [];
  const params = new URLSearchParams({ param: `${symbol},day,,,${count},qfq` });
  const response = await fetchImpl(`${KLINE_URL}?${params}`, {
    headers: { "user-agent": "Mozilla/5.0 JiandingLocalBackend/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`K线请求失败: ${response.status}`);
  const payload = await response.json();
  const asset = payload?.data?.[symbol];
  const rows = Array.isArray(asset?.qfqday)
    ? asset.qfqday
    : Array.isArray(asset?.day)
      ? asset.day
      : [];
  return rows.flatMap((row) => {
    if (!Array.isArray(row)) return [];
    const value = parseNumber(row[2]);
    if (!row[0] || value === null) return [];
    return [
      {
        label: row[0],
        value,
        open: parseNumber(row[1]) ?? undefined,
        high: parseNumber(row[3]) ?? undefined,
        low: parseNumber(row[4]) ?? undefined,
        volume: parseNumber(row[5]) ?? undefined,
      },
    ];
  });
}

export async function fetchLiveQuotes(symbols, fetchImpl = fetch) {
  return fetchStockQuotes(symbols, fetchImpl);
}
