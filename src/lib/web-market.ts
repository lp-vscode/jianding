import type {
  Asset,
  IndexQuote,
  Market,
  Quote,
  SearchResult,
  TrendPoint,
  TrendRange,
} from "../types";

interface FundValue {
  x: number;
  y: number;
  equityReturn: number;
}

interface FundScriptData {
  name: string | null;
  code: string | null;
  values: FundValue[];
}

const USER_TIMEOUT = 12_000;
let scriptQueue: Promise<unknown> = Promise.resolve();

function parseNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text === "--") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function tencentTimestamp(value: string) {
  if (!/^\d{14}/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}`;
}

function shanghaiDate(timestamp: number) {
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function fetchTencentText(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`行情请求失败: ${response.status}`);
  const bytes = await response.arrayBuffer();
  try {
    return new TextDecoder("gbk").decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function quoteBodyFields(text: string) {
  return text
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .flatMap((segment) => {
      const equals = segment.indexOf("=");
      if (equals < 0) return [];
      const name = segment.slice(0, equals).trim();
      if (!name.startsWith("v_")) return [];
      return [[name.slice(2), segment.slice(equals + 1).trim().replace(/^"|"$/g, "").split("~")] as const];
    });
}

function parseTencentQuotes(text: string): Quote[] {
  return quoteBodyFields(text).flatMap(([symbol, fields]) => {
    if (!/^(sh|sz)\d{6}$/.test(symbol) || fields.length < 35) return [];
    const amount =
      parseNumber(fields[35]?.split("/")[2]) ??
      (parseNumber(fields[37]) === null ? null : Number(parseNumber(fields[37])) * 10_000);
    const volumeValue = parseNumber(fields[36]);
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
        volume: volumeValue === null ? null : volumeValue * 100,
        amount,
        updatedAt: tencentTimestamp(fields[30] ?? ""),
        navDate: null,
        state: "live" as const,
        source: "腾讯行情",
      },
    ];
  });
}

function loadScript(url: string) {
  return new Promise<HTMLScriptElement>((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      script.remove();
      reject(new Error("数据脚本加载超时"));
    }, USER_TIMEOUT);
    script.async = true;
    script.src = url;
    script.onload = () => {
      window.clearTimeout(timeout);
      resolve(script);
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error("数据脚本加载失败"));
    };
    document.head.appendChild(script);
  });
}

function serializedScript<T>(task: () => Promise<T>) {
  const next = scriptQueue.then(task, task);
  scriptQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function loadFundData(code: string): Promise<FundScriptData> {
  return serializedScript(async () => {
    const script = await loadScript(
      `https://fund.eastmoney.com/pingzhongdata/${encodeURIComponent(code)}.js?v=${Date.now()}`,
    );
    const globals = window as unknown as Record<string, unknown>;
    const values = Array.isArray(globals.Data_netWorthTrend)
      ? (globals.Data_netWorthTrend as FundValue[])
      : [];
    const data = {
      name: typeof globals.fS_name === "string" ? globals.fS_name : null,
      code: typeof globals.fS_code === "string" ? globals.fS_code : null,
      values: values.filter(
        (value) =>
          value &&
          typeof value.x === "number" &&
          typeof value.y === "number" &&
          Number.isFinite(value.y),
      ),
    };
    script.remove();
    if (!data.values.length) throw new Error("基金净值数据为空");
    return data;
  });
}

export async function fetchWebQuotes(assets: Asset[]): Promise<Quote[]> {
  const stockSymbols = assets
    .filter((asset) => asset.market === "sh" || asset.market === "sz")
    .map((asset) => asset.symbol);
  const fundAssets = assets.filter((asset) => asset.market === "jj");
  const [stockQuotes, fundQuotes] = await Promise.all([
    stockSymbols.length
      ? fetchTencentText(`https://qt.gtimg.cn/q=${stockSymbols.join(",")}`).then(parseTencentQuotes)
      : Promise.resolve<Quote[]>([]),
    Promise.all(
      fundAssets.map(async (asset): Promise<Quote | null> => {
        try {
          const data = await loadFundData(asset.code);
          const latest = data.values.at(-1);
          const previous = data.values.at(-2);
          if (!latest) return null;
          const price = latest.y;
          const previousClose = previous?.y ?? null;
          const change = previousClose === null ? null : price - previousClose;
          const date = shanghaiDate(latest.x);
          return {
            symbol: asset.symbol,
            code: data.code ?? asset.code,
            name: data.name ?? asset.name,
            price,
            previousClose,
            change,
            changePct: Number.isFinite(latest.equityReturn)
              ? latest.equityReturn
              : previousClose
                ? ((price - previousClose) / previousClose) * 100
                : null,
            open: null,
            high: null,
            low: null,
            volume: null,
            amount: null,
            updatedAt: `${date}T15:00:00`,
            navDate: date,
            state: "nav",
            source: "天天基金净值",
          };
        } catch (error) {
          console.warn(`基金 ${asset.code} 行情加载失败`, error);
          return null;
        }
      }),
    ).then((quotes) => quotes.filter((quote): quote is Quote => Boolean(quote))),
  ]);
  return [...stockQuotes, ...fundQuotes];
}

function parseSearchPayload(payload: string): SearchResult[] {
  const seen = new Set<string>();
  return payload
    .split("^")
    .flatMap((record) => {
      const fields = record.split("~");
      if (fields.length < 5) return [];
      const [market, code, name, , rawType] = fields;
      if (
        !["sh", "sz", "jj"].includes(market) ||
        !/^\d{6}$/.test(code) ||
        !name
      ) {
        return [];
      }
      const isFund = market === "jj" || rawType.includes("ETF") || rawType.includes("LOF");
      const isStock = rawType.includes("GP");
      if (!isFund && !isStock) return [];
      const symbol = `${market}${code}`;
      if (seen.has(symbol)) return [];
      seen.add(symbol);
      const kind = isFund ? "fund" : "stock";
      const typeLabel =
        market === "jj"
          ? "场外基金"
          : rawType.includes("ETF")
            ? "ETF"
            : rawType.includes("LOF")
              ? "LOF"
              : "A股";
      return [
        {
          symbol,
          code,
          name,
          kind,
          market: market as Market,
          typeLabel,
        } satisfies SearchResult,
      ];
    })
    .slice(0, 10);
}

export async function searchWebAssets(query: string): Promise<SearchResult[]> {
  return serializedScript(async () => {
    const url = new URL("https://smartbox.gtimg.cn/s3/");
    url.search = new URLSearchParams({
      v: "2",
      q: query.trim(),
      t: "all",
      c: "1",
      _: String(Date.now()),
    }).toString();
    const script = await loadScript(url.toString());
    const globals = window as unknown as Record<string, unknown>;
    const payload = typeof globals.v_hint === "string" ? globals.v_hint : "";
    script.remove();
    return payload && payload !== "none" ? parseSearchPayload(payload) : [];
  });
}

function parseMinutePoints(payload: Record<string, unknown>, symbol: string): TrendPoint[] {
  const root = payload.data as Record<string, unknown> | undefined;
  const asset = root?.[symbol] as Record<string, unknown> | undefined;
  const minute = asset?.data as Record<string, unknown> | undefined;
  const rows = Array.isArray(minute?.data) ? minute.data : [];
  return rows.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const fields = entry.trim().split(/\s+/);
    const value = parseNumber(fields[1]);
    if (!fields[0] || value === null) return [];
    const time = fields[0];
    return [
      {
        label: time.length === 4 ? `${time.slice(0, 2)}:${time.slice(2)}` : time,
        value,
        volume: parseNumber(fields[2]) ?? undefined,
      },
    ];
  });
}

function parseKlinePoints(
  payload: Record<string, unknown>,
  symbol: string,
  period: string,
  fullDate: boolean,
): TrendPoint[] {
  const root = payload.data as Record<string, unknown> | undefined;
  const asset = root?.[symbol] as Record<string, unknown> | undefined;
  const rows = Array.isArray(asset?.[`qfq${period}`])
    ? (asset?.[`qfq${period}`] as unknown[])
    : Array.isArray(asset?.[period])
      ? (asset?.[period] as unknown[])
      : [];
  return rows.flatMap((row) => {
    if (!Array.isArray(row)) return [];
    const date = typeof row[0] === "string" ? row[0] : "";
    const value = parseNumber(row[2]);
    if (!date || value === null) return [];
    return [
      {
        label: fullDate ? date : date.slice(5),
        value,
        open: parseNumber(row[1]) ?? undefined,
        high: parseNumber(row[3]) ?? undefined,
        low: parseNumber(row[4]) ?? undefined,
        volume: parseNumber(row[5]) ?? undefined,
      },
    ];
  });
}

async function fetchFundTrend(asset: Asset, range: TrendRange) {
  const data = await loadFundData(asset.code);
  const count = {
    intraday: 20,
    "5d": 8,
    day: 120,
    week: 520,
    month: 760,
    "1m": 32,
    "3m": 100,
    "1y": 260,
  }[range];
  const stride = range === "week" ? 5 : range === "month" ? 21 : 1;
  return data.values
    .map((value, index) => ({ value, index }))
    .filter(({ index }) => index % stride === 0 || index === data.values.length - 1)
    .slice(-count)
    .map(({ value }) => ({
      label: shanghaiDate(value.x).slice(5),
      value: value.y,
    }));
}

export async function fetchWebTrend(asset: Asset, range: TrendRange): Promise<TrendPoint[]> {
  if (asset.market === "jj") return fetchFundTrend(asset, range);
  if (range === "intraday") {
    const response = await fetch(
      `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${encodeURIComponent(asset.symbol)}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error("分时走势请求失败");
    return parseMinutePoints((await response.json()) as Record<string, unknown>, asset.symbol);
  }
  const series = {
    "5d": ["day", 5],
    week: ["week", 52],
    month: ["month", 36],
    "1m": ["day", 22],
    "3m": ["day", 66],
    "1y": ["day", 250],
    day: ["day", 120],
    intraday: ["day", 120],
  } satisfies Record<TrendRange, readonly [string, number]>;
  const [period, count] = series[range];
  const params = new URLSearchParams({ param: `${asset.symbol},${period},,,${count},qfq` });
  const response = await fetch(
    `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?${params.toString()}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("K线走势请求失败");
  return parseKlinePoints(
    (await response.json()) as Record<string, unknown>,
    asset.symbol,
    period,
    range === "1y",
  );
}

export async function fetchWebIndices(): Promise<IndexQuote[]> {
  const text = await fetchTencentText(
    "https://qt.gtimg.cn/q=s_sh000001,s_sz399001,s_sz399006",
  );
  return quoteBodyFields(text).flatMap(([symbol, fields]) => {
    const price = parseNumber(fields[3]);
    const change = parseNumber(fields[4]);
    const changePct = parseNumber(fields[5]);
    if (!fields[1] || price === null || change === null || changePct === null) return [];
    return [
      {
        symbol: symbol.replace(/^s_/, ""),
        name: fields[1],
        price,
        change,
        changePct,
      },
    ];
  });
}
