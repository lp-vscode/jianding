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
    price: 1392.05,
    previousClose: 1354,
    open: 1363,
    high: 1393.37,
    low: 1352.98,
    volume: 5_992_700,
    amount: 8_257_000_000,
  },
  {
    code: "300750",
    name: "宁德时代",
    kind: "stock",
    market: "sz",
    typeLabel: "A股",
    price: 232.92,
    previousClose: 229.07,
    open: 230.31,
    high: 234.78,
    low: 228.61,
    volume: 3_780_000,
    amount: 8_801_000_000,
  },
  {
    code: "510300",
    name: "沪深300ETF华泰柏瑞",
    kind: "fund",
    market: "sh",
    typeLabel: "ETF",
    price: 4.065,
    previousClose: 4.111,
    open: 4.1,
    high: 4.11,
    low: 4.06,
    volume: 9_865_000,
    amount: 4_023_000_000,
  },
  {
    code: "012414",
    name: "招商中证白酒指数C",
    kind: "fund",
    market: "jj",
    typeLabel: "场外基金",
    price: 0.5647,
    previousClose: 0.5347,
    open: null,
    high: null,
    low: null,
    volume: null,
    amount: null,
    navDate: "2026-10-30",
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
  {
    symbol: "sh601398",
    code: "601398",
    name: "工商银行",
    kind: "stock",
    market: "sh",
    typeLabel: "A股",
  },
  {
    symbol: "sh601857",
    code: "601857",
    name: "中国石油",
    kind: "stock",
    market: "sh",
    typeLabel: "A股",
  },
  {
    symbol: "sh600030",
    code: "600030",
    name: "中信证券",
    kind: "stock",
    market: "sh",
    typeLabel: "A股",
  },
  {
    symbol: "sh600276",
    code: "600276",
    name: "恒瑞医药",
    kind: "stock",
    market: "sh",
    typeLabel: "A股",
  },
  {
    symbol: "sh601888",
    code: "601888",
    name: "中国中免",
    kind: "stock",
    market: "sh",
    typeLabel: "A股",
  },
  {
    symbol: "sz002594",
    code: "002594",
    name: "比亚迪",
    kind: "stock",
    market: "sz",
    typeLabel: "A股",
  },
  {
    symbol: "sz300059",
    code: "300059",
    name: "东方财富",
    kind: "stock",
    market: "sz",
    typeLabel: "A股",
  },
  {
    symbol: "sh510050",
    code: "510050",
    name: "上证50ETF华夏",
    kind: "fund",
    market: "sh",
    typeLabel: "ETF",
  },
  {
    symbol: "sh512480",
    code: "512480",
    name: "半导体ETF国联安",
    kind: "fund",
    market: "sh",
    typeLabel: "ETF",
  },
  {
    symbol: "sh512690",
    code: "512690",
    name: "酒ETF鹏华",
    kind: "fund",
    market: "sh",
    typeLabel: "ETF",
  },
  {
    symbol: "sz159949",
    code: "159949",
    name: "创业板50ETF华安",
    kind: "fund",
    market: "sz",
    typeLabel: "ETF",
  },
  {
    symbol: "jj000001",
    code: "000001",
    name: "华夏成长混合",
    kind: "fund",
    market: "jj",
    typeLabel: "场外基金",
  },
  {
    symbol: "jj110011",
    code: "110011",
    name: "易方达优质精选混合",
    kind: "fund",
    market: "jj",
    typeLabel: "场外基金",
  },
  {
    symbol: "jj003095",
    code: "003095",
    name: "中欧医疗健康混合A",
    kind: "fund",
    market: "jj",
    typeLabel: "场外基金",
  },
  {
    symbol: "jj000961",
    code: "000961",
    name: "天弘沪深300ETF联接A",
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
    if (!base) {
      return {
        symbol: asset.symbol,
        code: asset.code,
        name: asset.name,
        price: null,
        previousClose: null,
        change: null,
        changePct: null,
        open: null,
        high: null,
        low: null,
        volume: null,
        amount: null,
        updatedAt: null,
        navDate: null,
        state: "demo",
        source: "暂无离线行情",
      };
    }
    const source = base;
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
      updatedAt: open ? isoForShanghai(now) : "2026-10-30T15:00:00+08:00",
      navDate: source.market === "jj" ? source.navDate ?? null : null,
      state: "demo",
      source: open ? "示例数据" : "2026-10-30 收盘快照",
    };
  });
}

export function demoIndices(now = new Date()): IndexQuote[] {
  const drift = isMarketOpen(now) ? Math.sin(now.getTime() / 21_000) * 0.0004 : 0;
  const items = [
    { symbol: "sh000001", name: "上证指数", price: 3599.02, changePct: -1.44 },
    { symbol: "sz399001", name: "深证成指", price: 10833.78, changePct: -2.73 },
    { symbol: "sz399006", name: "创业板指", price: 2413.63, changePct: -4.13 },
    { symbol: "sh000300", name: "沪深300", price: 3985.5, changePct: -1.39 },
    { symbol: "sh000905", name: "中证500", price: 6266.19, changePct: -2.91 },
    { symbol: "sh000688", name: "科创50", price: 1160.84, changePct: -5.48 },
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
