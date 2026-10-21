import type { Asset, IndexQuote, Quote, SearchResult, TrendPoint, TrendRange } from "../types";
import { isMarketOpen, shanghaiParts } from "./market";

interface DemoBase {
  code: string;
  name: string;
  kind: "stock" | "fund";
  market: "sh" | "sz" | "jj";
  typeLabel: string;
  price: number;
  previousClose: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  amount: number | null;
  navDate?: string;
}

const DEMO_BASE: DemoBase[] = [
  {
    code: "600519",
    name: "贵州茅台",
    kind: "stock",
    market: "sh",
    typeLabel: "A股",
    price: 1324.97,
    previousClose: 1329,
    open: 1322.5,
    high: 1348.6,
    low: 1321,
    volume: 39729,
    amount: 5_308_935_919,
  },
  {
    code: "300750",
    name: "宁德时代",
    kind: "stock",
    market: "sz",
    typeLabel: "A股",
    price: 267.02,
    previousClose: 277,
    open: 275,
    high: 275,
    low: 267.02,
    volume: 311460,
    amount: 8_399_331_715,
  },
  {
    code: "510300",
    name: "沪深300ETF华泰柏瑞",
    kind: "fund",
    market: "sh",
    typeLabel: "ETF",
    price: 4.24,
    previousClose: 4.236,
    open: 4.224,
    high: 4.267,
    low: 4.22,
    volume: 12_105_648,
    amount: 5_137_102_820,
  },
  {
    code: "012414",
    name: "招商中证白酒指数C",
    kind: "fund",
    market: "jj",
    typeLabel: "场外基金",
    price: 0.5312,
    previousClose: 0.5267,
    open: null,
    high: null,
    low: null,
    volume: null,
    amount: null,
    navDate: "2026-10-19",
  },
  {
    code: "161725",
    name: "招商中证白酒指数(LOF)A",
    kind: "fund",
    market: "sz",
    typeLabel: "LOF",
    price: 0.544,
    previousClose: 0.537,
    open: 0.536,
    high: 0.552,
    low: 0.534,
    volume: 672_688,
    amount: 36_623_482,
  },
  {
    code: "601318",
    name: "中国平安",
    kind: "stock",
    market: "sh",
    typeLabel: "A股",
    price: 58.66,
    previousClose: 58.12,
    open: 58.3,
    high: 59.02,
    low: 58.05,
    volume: 812_300,
    amount: 4_723_000_000,
  },
  {
    code: "000858",
    name: "五粮液",
    kind: "stock",
    market: "sz",
    typeLabel: "A股",
    price: 112.34,
    previousClose: 111.62,
    open: 111.8,
    high: 113.2,
    low: 110.95,
    volume: 268_900,
    amount: 3_014_000_000,
  },
  {
    code: "588000",
    name: "科创50ETF华夏",
    kind: "fund",
    market: "sh",
    typeLabel: "ETF",
    price: 1.284,
    previousClose: 1.271,
    open: 1.273,
    high: 1.291,
    low: 1.268,
    volume: 28_410_000,
    amount: 3_634_000_000,
  },
];

const SEARCH_CATALOG: SearchResult[] = DEMO_BASE.map((item) => ({
  symbol: `${item.market}${item.code}`,
  code: item.code,
  name: item.name,
  kind: item.kind,
  market: item.market,
  typeLabel: item.typeLabel,
})).concat([
  {
    symbol: "sz000333",
    code: "000333",
    name: "美的集团",
    kind: "stock",
    market: "sz",
    typeLabel: "A股",
  },
  {
    symbol: "sh600036",
    code: "600036",
    name: "招商银行",
    kind: "stock",
    market: "sh",
    typeLabel: "A股",
  },
  {
    symbol: "sh510500",
    code: "510500",
    name: "中证500ETF南方",
    kind: "fund",
    market: "sh",
    typeLabel: "ETF",
  },
  {
    symbol: "sz159915",
    code: "159915",
    name: "创业板ETF易方达",
    kind: "fund",
    market: "sz",
    typeLabel: "ETF",
  },
  {
    symbol: "jj110022",
    code: "110022",
    name: "易方达消费行业股票",
    kind: "fund",
    market: "jj",
    typeLabel: "场外基金",
  },
  {
    symbol: "jj161005",
    code: "161005",
    name: "富国天惠成长混合A",
    kind: "fund",
    market: "jj",
    typeLabel: "场外基金",
  },
  {
    symbol: "jj005827",
    code: "005827",
    name: "易方达蓝筹精选混合",
    kind: "fund",
    market: "jj",
    typeLabel: "场外基金",
  },
]);

export const DEFAULT_ASSETS: Asset[] = ["sh600519", "sz300750", "sh510300", "jj012414"].map(
  (symbol, index) => {
    const base = DEMO_BASE.find((item) => `${item.market}${item.code}` === symbol) ?? DEMO_BASE[0];
    return {
      symbol,
      code: base.code,
      name: base.name,
      kind: base.kind,
      market: base.market,
      typeLabel: base.typeLabel,
      addedAt: Date.now() - index * 1000,
    };
  },
);

export const DEMO_CATALOG = SEARCH_CATALOG;

function hash(input: string) {
  let value = 0;
  for (let index = 0; index < input.length; index += 1) {
    value = (value * 31 + input.charCodeAt(index)) >>> 0;
  }
  return value;
}

function seeded(seed: number) {
  let state = seed || 1;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function isoForShanghai(now: Date) {
  const parts = shanghaiParts(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

export function demoAsset(symbol: string, name = "自定义标的"): Asset {
  const found = SEARCH_CATALOG.find((item) => item.symbol === symbol);
  if (found) {
    return { ...found, addedAt: Date.now() };
  }
  const market = symbol.slice(0, 2) as "sh" | "sz" | "jj";
  return {
    symbol,
    code: symbol.slice(2),
    name,
    kind: market === "jj" ? "fund" : "stock",
    market,
    typeLabel: market === "jj" ? "场外基金" : "A股",
    addedAt: Date.now(),
  };
}

export function demoQuotes(assets: Pick<Asset, "symbol" | "code" | "name" | "kind" | "market" | "typeLabel">[], now = new Date()): Quote[] {
  const open = isMarketOpen(now);
  return assets.map((asset) => {
    const base = DEMO_BASE.find((item) => `${item.market}${item.code}` === asset.symbol);
    const fallback = DEMO_BASE[hash(asset.symbol) % DEMO_BASE.length];
    const source = base ?? fallback;
    const drift = open ? Math.sin(now.getTime() / 17_000 + hash(asset.symbol)) * 0.0007 : 0;
    const price = Number((source.price * (1 + drift)).toFixed(source.kind === "fund" && source.market === "jj" ? 4 : source.price < 10 ? 3 : 2));
    const change = price - source.previousClose;
    const changePct = source.previousClose ? (change / source.previousClose) * 100 : 0;
    return {
      symbol: asset.symbol,
      code: asset.code,
      name: asset.name || source.name,
      price,
      previousClose: source.previousClose,
      change: Number(change.toFixed(4)),
      changePct: Number(changePct.toFixed(2)),
      open: source.open,
      high: source.high,
      low: source.low,
      volume: source.volume,
      amount: source.amount,
      updatedAt: isoForShanghai(now),
      navDate: source.market === "jj" ? source.navDate ?? null : null,
      state: "demo",
      source: "示例数据",
    };
  });
}

export function demoIndices(now = new Date()): IndexQuote[] {
  const drift = isMarketOpen(now) ? Math.sin(now.getTime() / 21_000) * 0.0004 : 0;
  const items = [
    { symbol: "sh000001", name: "上证指数", price: 3730.92, changePct: 0.39 },
    { symbol: "sz399001", name: "深证成指", price: 11842.15, changePct: 0.62 },
    { symbol: "sz399006", name: "创业板指", price: 2576.38, changePct: -0.18 },
  ];
  return items.map((item) => ({
    ...item,
    price: Number((item.price * (1 + drift)).toFixed(2)),
    change: Number((item.price * (item.changePct / 100)).toFixed(2)),
  }));
}

export async function demoSearch(query: string): Promise<SearchResult[]> {
  const term = query.trim().toLowerCase();
  if (!term) return SEARCH_CATALOG.slice(0, 6);
  return SEARCH_CATALOG.filter(
    (item) =>
      item.code.includes(term) ||
      item.name.toLowerCase().includes(term) ||
      item.typeLabel.toLowerCase().includes(term),
  ).slice(0, 8);
}

function timeLabels(range: TrendRange, count: number) {
  if (range === "intraday") {
    return Array.from({ length: count }, (_, index) => {
      const minutes = 9 * 60 + 30 + Math.round((index / Math.max(1, count - 1)) * 330);
      const adjusted = minutes > 11 * 60 + 30 ? minutes + 90 : minutes;
      return `${String(Math.floor(adjusted / 60)).padStart(2, "0")}:${String(adjusted % 60).padStart(2, "0")}`;
    });
  }
  if (range === "5d") {
    return Array.from({ length: count }, (_, index) => {
      const day = Math.floor(index / 48);
      const slot = index % 48;
      return `T-${4 - Math.min(4, day)} ${slot === 0 ? "09:30" : ""}`.trim();
    });
  }
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.now() - (count - 1 - index) * 86_400_000);
    return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
}

export function demoTrend(asset: Asset, range: TrendRange): TrendPoint[] {
  const base = DEMO_BASE.find((item) => `${item.market}${item.code}` === asset.symbol) ?? DEMO_BASE[0];
  const count = range === "intraday" ? 76 : range === "5d" ? 240 : range === "1m" ? 22 : range === "3m" ? 66 : range === "1y" ? 250 : 120;
  const random = seeded(hash(`${asset.symbol}:${range}`));
  const labels = timeLabels(range, count);
  const end = base.price;
  const start = base.previousClose * (range === "intraday" || range === "5d" ? 1 : 0.94);
  let value = start;
  const points: TrendPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const progress = index / Math.max(1, count - 1);
    const wave = Math.sin(progress * Math.PI * 4.4 + random() * 0.5) * 0.0034;
    const noise = (random() - 0.5) * 0.0022;
    const pull = (start + (end - start) * progress - value) * 0.09;
    value = Math.max(0.0001, value + value * (wave + noise) + pull);
    const digits = base.kind === "fund" && base.market === "jj" ? 4 : base.price < 10 ? 3 : 2;
    points.push({
      label: labels[index],
      value: Number(value.toFixed(digits)),
    });
  }
  if (points.length) points[points.length - 1] = { ...points[points.length - 1], value: end };
  return points;
}
