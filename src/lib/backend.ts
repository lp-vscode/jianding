import { invoke } from "@tauri-apps/api/core";
import type { Asset, IndexQuote, Quote, SearchResult, TrendPoint, TrendRange } from "../types";
import { demoIndices, demoQuotes, demoSearch, demoTrend } from "./demo";
import {
  fetchWebIndices,
  fetchWebQuotes,
  fetchWebTrend,
  searchWebAssets,
} from "./web-market";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function fetchQuotes(assets: Asset[]): Promise<Quote[]> {
  if (!assets.length) return [];
  try {
    const quotes = isTauri()
      ? await invoke<Quote[]>("fetch_quotes", {
          symbols: assets.map((asset) => asset.symbol),
        })
      : await fetchWebQuotes(assets);
    if (!quotes.length) return demoQuotes(assets);
    const bySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
    const missing = assets.filter((asset) => !bySymbol.has(asset.symbol));
    if (missing.length) {
      for (const quote of demoQuotes(missing)) bySymbol.set(quote.symbol, quote);
    }
    return assets.map((asset) => bySymbol.get(asset.symbol)).filter((quote): quote is Quote => Boolean(quote));
  } catch (error) {
    console.warn("行情接口不可用，已切换示例数据", error);
    return demoQuotes(assets);
  }
}

export async function searchAssets(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return demoSearch(query);
  try {
    const results = isTauri()
      ? await invoke<SearchResult[]>("search_assets", { query })
      : await searchWebAssets(query);
    return results.length ? results : demoSearch(query);
  } catch (error) {
    console.warn("搜索接口不可用，已切换本地目录", error);
    return demoSearch(query);
  }
}

export async function fetchTrend(asset: Asset, range: TrendRange): Promise<TrendPoint[]> {
  try {
    const points = isTauri()
      ? await invoke<TrendPoint[]>("fetch_trend", {
          symbol: asset.symbol,
          range,
        })
      : await fetchWebTrend(asset, range);
    return points.length ? points : demoTrend(asset, range);
  } catch (error) {
    console.warn("走势接口不可用，已切换示例数据", error);
    return demoTrend(asset, range);
  }
}

export async function fetchIndices(): Promise<IndexQuote[]> {
  try {
    const indices = isTauri()
      ? await invoke<IndexQuote[]>("fetch_indices")
      : await fetchWebIndices();
    return indices.length ? indices : demoIndices();
  } catch (error) {
    console.warn("指数接口不可用，已切换示例数据", error);
    return demoIndices();
  }
}
