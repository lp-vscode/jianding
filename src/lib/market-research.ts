import type { Asset } from "../types";
import { industryForStock } from "./stock-ai";
import { fetchNativeMarketText } from "./web-market";

export interface MarketUniverseStock {
  symbol: string;
  code: string;
  name: string;
  price: number;
  changePct: number;
  amount: number;
  pe: number | null;
  pb: number | null;
  marketCap: number;
  turnover: number;
  industry: string;
}

export interface StockFundamentals {
  reportDate: string;
  periodLabel: string;
  revenue: number | null;
  revenueGrowth: number | null;
  netProfit: number | null;
  profitGrowth: number | null;
  roe: number | null;
  grossMargin: number | null;
  eps: number | null;
  industry: string | null;
}

export interface StockNewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  publishedAt: string;
  url: string;
}

interface SinaMarketRow {
  symbol?: unknown;
  code?: unknown;
  name?: unknown;
  trade?: unknown;
  changepercent?: unknown;
  amount?: unknown;
  per?: unknown;
  pb?: unknown;
  mktcap?: unknown;
  turnoverratio?: unknown;
}

interface EastmoneyFinancePayload {
  success?: boolean;
  result?: {
    data?: Array<Record<string, unknown>>;
  } | null;
}

interface EastmoneyNewsPayload {
  result?: {
    cmsArticleWebOld?: Array<{
      code?: unknown;
      title?: unknown;
      content?: unknown;
      mediaName?: unknown;
      date?: unknown;
      url?: unknown;
    }>;
  };
}

let universeCache: { at: number; stocks: MarketUniverseStock[] } | null = null;
const UNIVERSE_CACHE_MS = 2 * 60 * 1000;

function numeric(value: unknown) {
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function parseSinaMarketRows(rows: unknown[]): MarketUniverseStock[] {
  const seen = new Set<string>();
  return rows.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as SinaMarketRow;
    const symbol = stringValue(row.symbol);
    const code = stringValue(row.code);
    const name = stringValue(row.name);
    const price = numeric(row.trade);
    const changePct = numeric(row.changepercent);
    const amount = numeric(row.amount);
    const marketCap = numeric(row.mktcap);
    const turnover = numeric(row.turnoverratio);
    if (
      !/^(sh|sz)\d{6}$/.test(symbol) ||
      !/^\d{6}$/.test(code) ||
      !name ||
      price == null ||
      price <= 0 ||
      changePct == null ||
      amount == null ||
      marketCap == null ||
      turnover == null ||
      seen.has(symbol)
    ) {
      return [];
    }
    seen.add(symbol);
    return [{
      symbol,
      code,
      name,
      price,
      changePct,
      amount,
      pe: numeric(row.per),
      pb: numeric(row.pb),
      marketCap: marketCap * 10_000,
      turnover,
      industry: industryForStock({
        symbol,
        code,
        name,
        kind: "stock",
        market: symbol.startsWith("sh") ? "sh" : "sz",
        typeLabel: "A股",
        addedAt: 0,
      }),
    }];
  });
}

export function parseStockFundamentals(payload: EastmoneyFinancePayload): StockFundamentals | null {
  const row = payload.result?.data?.[0];
  if (!row) return null;
  return {
    reportDate: stringValue(row.REPORTDATE).slice(0, 10),
    periodLabel: stringValue(row.DATATYPE) || stringValue(row.DATEMMDD),
    revenue: numeric(row.TOTAL_OPERATE_INCOME),
    revenueGrowth: numeric(row.YSTZ),
    netProfit: numeric(row.PARENT_NETPROFIT),
    profitGrowth: numeric(row.SJLTZ),
    roe: numeric(row.WEIGHTAVG_ROE),
    grossMargin: numeric(row.XSMLL),
    eps: numeric(row.BASIC_EPS),
    industry: stringValue(row.PUBLISHNAME) || stringValue(row.BOARD_NAME) || null,
  };
}

export function parseStockNews(payload: EastmoneyNewsPayload): StockNewsItem[] {
  return (payload.result?.cmsArticleWebOld ?? []).flatMap((item) => {
    const title = stringValue(item.title);
    if (!title) return [];
    return [{
      id: stringValue(item.code) || title,
      title,
      summary: stringValue(item.content),
      source: stringValue(item.mediaName) || "东方财富",
      publishedAt: stringValue(item.date),
      url: stringValue(item.url).replace(/^http:/, "https:"),
    }];
  });
}

function loadJsonp<T>(url: string, callbackParameter: string) {
  return new Promise<T>((resolve, reject) => {
    const callbackName = `jiandingResearch${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    const target = new URL(url);
    target.searchParams.set(callbackParameter, callbackName);
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("研究数据请求超时"));
    }, 12_000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      script.remove();
      delete (window as unknown as Record<string, unknown>)[callbackName];
    };
    (window as unknown as Record<string, unknown>)[callbackName] = (payload: T) => {
      cleanup();
      resolve(payload);
    };
    script.async = true;
    script.src = target.toString();
    script.onerror = () => {
      cleanup();
      reject(new Error("研究数据脚本加载失败"));
    };
    document.head.appendChild(script);
  });
}

async function fetchSinaPage(page: number) {
  const url = new URL(
    "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData",
  );
  url.searchParams.set("page", String(page));
  url.searchParams.set("num", "100");
  url.searchParams.set("sort", "amount");
  url.searchParams.set("asc", "0");
  url.searchParams.set("node", "hs_a");
  url.searchParams.set("symbol", "");
  url.searchParams.set("_", String(Date.now()));
  const nativeText = await fetchNativeMarketText(url.toString());
  if (nativeText) {
    const payload = JSON.parse(nativeText) as unknown;
    return Array.isArray(payload) ? payload : [];
  }
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`全市场行情请求失败: ${response.status}`);
  const payload = (await response.json()) as unknown;
  return Array.isArray(payload) ? payload : [];
}

async function fetchSinaPageWithRetry(page: number) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await fetchSinaPage(page);
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 650 * (attempt + 1)));
    }
  }
  return [];
}

export async function fetchMarketUniverse(onProgress?: (loaded: number, total: number) => void) {
  if (universeCache && Date.now() - universeCache.at < UNIVERSE_CACHE_MS) {
    onProgress?.(universeCache.stocks.length, universeCache.stocks.length);
    return universeCache.stocks;
  }
  const pageCount = 60;
  const estimatedCount = 5_600;
  const rows: unknown[] = [];
  const batchSize = 6;
  for (let start = 1; start <= pageCount; start += batchSize) {
    const batch = await Promise.all(
      Array.from(
        { length: Math.min(batchSize, pageCount - start + 1) },
        (_, index) => fetchSinaPageWithRetry(start + index),
      ),
    );
    for (const page of batch) rows.push(...page);
    onProgress?.(rows.length, estimatedCount);
    if (batch.some((page) => page.length === 0)) break;
    await new Promise((resolve) => window.setTimeout(resolve, 900));
  }
  const stocks = parseSinaMarketRows(rows);
  universeCache = { at: Date.now(), stocks };
  return stocks;
}

function preScreenScore(stock: MarketUniverseStock) {
  const liquidity = Math.min(100, Math.max(0, 20 + Math.log10(Math.max(1, stock.amount / 1_000_000)) * 18));
  const valuation =
    stock.pe == null || stock.pe <= 0
      ? 18
      : stock.pe <= 20
        ? 96
        : stock.pe <= 40
          ? 82
          : stock.pe <= 70
            ? 58
            : stock.pe <= 120
              ? 34
              : 16;
  const size = Math.min(100, Math.max(15, 30 + Math.log10(Math.max(1, stock.marketCap / 1_000_000_000)) * 24));
  const turnover =
    stock.turnover < 0.2
      ? 25
      : stock.turnover <= 8
        ? 85
        : stock.turnover <= 20
          ? 55
          : 20;
  const daily =
    stock.changePct >= 9.5
      ? 25
      : stock.changePct >= 0
        ? 65
        : stock.changePct >= -5
          ? 55
          : 35;
  return liquidity * 0.38 + valuation * 0.2 + size * 0.16 + turnover * 0.16 + daily * 0.1;
}

export function preScreenMarketStocks(stocks: MarketUniverseStock[], limit = 12) {
  const filtered = stocks
    .filter(
      (stock) =>
        !/ST|退|N |C /i.test(stock.name) &&
        stock.amount >= 30_000_000 &&
        stock.marketCap >= 3_000_000_000,
    )
    .sort((left, right) => preScreenScore(right) - preScreenScore(left));
  const selected: MarketUniverseStock[] = [];
  const industryCounts = new Map<string, number>();
  for (const stock of filtered) {
    const count = industryCounts.get(stock.industry) ?? 0;
    if (count >= 2) continue;
    selected.push(stock);
    industryCounts.set(stock.industry, count + 1);
    if (selected.length >= limit) break;
  }
  if (selected.length < limit) {
    for (const stock of filtered) {
      if (selected.some((item) => item.symbol === stock.symbol)) continue;
      selected.push(stock);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

export async function fetchStockFundamentals(code: string): Promise<StockFundamentals | null> {
  const url = new URL("https://datacenter-web.eastmoney.com/api/data/v1/get");
  url.searchParams.set("reportName", "RPT_LICO_FN_CPD");
  url.searchParams.set("columns", "ALL");
  url.searchParams.set("filter", `(SECURITY_CODE="${code}")`);
  url.searchParams.set("pageNumber", "1");
  url.searchParams.set("pageSize", "1");
  url.searchParams.set("sortColumns", "REPORTDATE");
  url.searchParams.set("sortTypes", "-1");
  url.searchParams.set("source", "WEB");
  url.searchParams.set("client", "WEB");
  try {
    const payload = await loadJsonp<EastmoneyFinancePayload>(url.toString(), "callback");
    return payload.success === false ? null : parseStockFundamentals(payload);
  } catch (error) {
    console.warn(`${code} 财报加载失败`, error);
    return null;
  }
}

export async function fetchStockNews(name: string, limit = 5): Promise<StockNewsItem[]> {
  const param = {
    uid: "",
    keyword: name,
    type: ["cmsArticleWebOld"],
    client: "web",
    clientType: "web",
    clientVersion: "curr",
    param: {
      cmsArticleWebOld: {
        searchScope: "default",
        sort: "default",
        pageIndex: 1,
        pageSize: limit,
        preTag: "",
        postTag: "",
      },
    },
  };
  const url = new URL("https://search-api-web.eastmoney.com/search/jsonp");
  url.searchParams.set("param", JSON.stringify(param));
  try {
    const payload = await loadJsonp<EastmoneyNewsPayload>(url.toString(), "cb");
    return parseStockNews(payload);
  } catch (error) {
    console.warn(`${name} 新闻加载失败`, error);
    return [];
  }
}

export function marketStockToAsset(stock: MarketUniverseStock): Asset {
  return {
    symbol: stock.symbol,
    code: stock.code,
    name: stock.name,
    kind: "stock",
    market: stock.symbol.startsWith("sh") ? "sh" : "sz",
    typeLabel: "A股",
    addedAt: 0,
  };
}
