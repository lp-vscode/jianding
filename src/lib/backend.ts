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
    JiandingNative?: {
      requestNotificationPermission?: () => Promise<boolean>;
      notify?: (title: string, body: string) => Promise<boolean>;
      saveTextFile?: (fileName: string, contents: string) => Promise<boolean>;
      fetchMarketText?: (url: string, requestId: string) => string;
    };
  }
}

export function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isHarmonyWebView() {
  return (
    typeof window !== "undefined" &&
    (Boolean(window.JiandingNative) || window.location.protocol === "resource:")
  );
}

export async function requestHarmonyNotificationPermission() {
  if (!isHarmonyWebView() || !window.JiandingNative?.requestNotificationPermission) return false;
  try {
    return await window.JiandingNative.requestNotificationPermission();
  } catch (error) {
    console.warn("HarmonyOS 通知权限申请失败", error);
    return false;
  }
}

export async function sendHarmonyNotification(title: string, body: string) {
  if (!isHarmonyWebView() || !window.JiandingNative?.notify) return false;
  try {
    return await window.JiandingNative.notify(title, body);
  } catch (error) {
    console.warn("HarmonyOS 通知发送失败", error);
    return false;
  }
}

export async function saveHarmonyTextFile(fileName: string, contents: string) {
  if (!isHarmonyWebView() || !window.JiandingNative?.saveTextFile) return false;
  try {
    return await window.JiandingNative.saveTextFile(fileName, contents);
  } catch (error) {
    console.warn("HarmonyOS 文件保存失败", error);
    return false;
  }
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
    const bySymbol = new Map(
      quotes.filter((quote) => quote.price != null).map((quote) => [quote.symbol, quote]),
    );
    let missing = assets.filter((asset) => !bySymbol.has(asset.symbol));
    if (missing.length) {
      const retried = await Promise.all(
        missing.map(async (asset) => {
          try {
            const [quote] = isTauri()
              ? await invoke<Quote[]>("fetch_quotes", { symbols: [asset.symbol] })
              : await fetchWebQuotes([asset]);
            return quote ?? null;
          } catch (error) {
            console.warn(`${asset.symbol} 行情单标的重试失败`, error);
            return null;
          }
        }),
      );
      for (const quote of retried) {
        if (quote?.price != null) bySymbol.set(quote.symbol, quote);
      }
      missing = assets.filter((asset) => !bySymbol.has(asset.symbol));
      const historical = await Promise.all(
        missing.map(async (asset) => {
          try {
            const points = isTauri()
              ? await invoke<TrendPoint[]>("fetch_trend", {
                  symbol: asset.symbol,
                  range: "1y",
                })
              : await fetchWebTrend(asset, "1y");
            const valid = points.filter((point) => Number.isFinite(point.value) && point.value > 0);
            const latest = valid.at(-1);
            const previous = valid.at(-2);
            if (!latest) return null;
            const change = previous ? latest.value - previous.value : null;
            const changePct =
              previous && previous.value > 0
                ? (change! / previous.value) * 100
                : null;
            const historicalQuote: Quote = {
              symbol: asset.symbol,
              code: asset.code,
              name: asset.name,
              price: latest.value,
              previousClose: previous?.value ?? null,
              change,
              changePct,
              open: latest.open ?? null,
              high: latest.high ?? null,
              low: latest.low ?? null,
              volume: latest.volume ?? null,
              amount: null,
              updatedAt: latest.label.includes("-")
                ? `${latest.label}T15:00:00`
                : null,
              navDate: asset.market === "jj" ? latest.label : null,
              state: asset.market === "jj" ? "nav" : "close",
              source: asset.market === "jj" ? "最近净值" : "最近收盘",
            };
            return historicalQuote;
          } catch (error) {
            console.warn(`${asset.symbol} 历史收盘回退失败`, error);
            return null;
          }
        }),
      );
      for (const quote of historical) {
        if (quote) bySymbol.set(quote.symbol, quote);
      }
      missing = assets.filter((asset) => !bySymbol.has(asset.symbol));
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

export async function loadTradingLedgerDisk() {
  if (!isTauri()) return null;
  return invoke<string | null>("load_trading_ledger");
}

export async function saveTradingLedgerDisk(contents: string) {
  if (!isTauri()) return;
  await invoke("save_trading_ledger", { contents });
}
