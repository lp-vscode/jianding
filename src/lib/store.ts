import { computed, nextTick, reactive, watch } from "vue";
import type {
  AlertEvent,
  AlertCondition,
  AlertSchedule,
  AlertRule,
  AlertType,
  Asset,
  Holding,
  IndexQuote,
  MarketSnapshot,
  Quote,
  SearchResult,
  Settings,
  ToastItem,
  TradingLedger,
  TradingOrderType,
  TradingRiskConfig,
  TradingSide,
  TradingStrategy,
  TrendRange,
  ViewKey,
  WatchlistGroup,
} from "../types";
import {
  fetchIndices,
  fetchQuotes,
  fetchTrend,
  isTauri,
  loadTradingLedgerDisk,
  saveTradingLedgerDisk,
} from "./backend";
import { alertConditions, alertEventMessage, isTriggered } from "./alerts";
import { DEFAULT_ASSETS, demoAsset } from "./demo";
import { effectiveRefreshMs, marketPhase, shanghaiParts } from "./market";
import {
  cancelTradingOrder,
  calculateTradingStats,
  createTradingSignal,
  defaultTradingLedger,
  evaluateTradingAgent,
  evaluateSmaCross,
  matchPendingTradingOrders,
  recordEquityPoint,
  recordStrategyEvaluation,
  riskExitForPosition,
  runSmaBacktest,
  resetTradingLedger as resetLedger,
  sanitizeTradingLedger,
  submitTradingOrder,
  suggestedTradingQuantity,
} from "./trading";

const STORAGE_KEY = "jianding:state:v1";
const ALERT_COOLDOWN = 30 * 60 * 1000;

const DEFAULT_SETTINGS: Settings = {
  refreshSeconds: 15,
  startView: "watchlist",
  notifications: true,
  gainLossMode: "china",
  watchlistDensity: "comfortable",
  watchlistSort: "default",
};

interface PersistedState {
  version: 1;
  assets: Asset[];
  watchlist: string[];
  watchlistGroups: WatchlistGroup[];
  activeWatchlistGroupId: string | null;
  holdings: Holding[];
  alerts: AlertRule[];
  events: AlertEvent[];
  settings: Settings;
  selectedSymbol: string | null;
  trading: TradingLedger;
  marketSnapshot: MarketSnapshot | null;
}

interface AppState extends PersistedState {
  ready: boolean;
  view: ViewKey;
  quotes: Record<string, Quote>;
  indices: IndexQuote[];
  refreshing: boolean;
  lastUpdated: number | null;
  marketFromCache: boolean;
  online: boolean;
  searchOpen: boolean;
  toasts: ToastItem[];
  detailRange: TrendRange;
  holdingDialog: { open: boolean; holding: Holding | null };
  alertDialog: { open: boolean; symbol: string | null; rule: AlertRule | null };
}

interface WindowStatePayload {
  source: string;
  revision: number;
  persisted: PersistedState;
}

interface WindowMarketPayload {
  source: string;
  quotes: Record<string, Quote>;
  indices: IndexQuote[];
  lastUpdated: number | null;
  fromCache: boolean;
}

interface WindowSyncRequest {
  source: string;
}

const STATE_SYNC_EVENT = "jianding:state-sync";
const MARKET_SYNC_EVENT = "jianding:market-sync";
const SNAPSHOT_REQUEST_EVENT = "jianding:snapshot-request";

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const ALERT_TYPES: AlertType[] = [
  "priceAbove",
  "priceBelow",
  "pctAbove",
  "pctBelow",
  "amountAbove",
  "rsiAbove",
  "rsiBelow",
  "smaGolden",
  "smaDeath",
  "volumeSpike",
  "gapUp",
  "gapDown",
  "pnlAbove",
  "pnlBelow",
];

function sanitizeAlertCondition(raw: unknown): AlertCondition | null {
  if (!raw || typeof raw !== "object") return null;
  const condition = raw as Partial<AlertCondition>;
  if (!ALERT_TYPES.includes(condition.type as AlertType)) return null;
  const threshold = Number(condition.threshold);
  if (!Number.isFinite(threshold) || threshold <= 0) return null;
  const type = condition.type as AlertType;
  return {
    type,
    threshold,
    period:
      type === "rsiAbove" || type === "rsiBelow"
        ? Math.min(60, Math.max(2, Math.round(Number(condition.period) || 14)))
        : type === "volumeSpike"
          ? Math.min(120, Math.max(2, Math.round(Number(condition.period) || 20)))
          : type === "smaGolden" || type === "smaDeath"
            ? Math.min(60, Math.max(2, Math.round(Number(condition.period) || 5)))
            : undefined,
    secondaryPeriod:
      type === "smaGolden" || type === "smaDeath"
        ? Math.min(240, Math.max(3, Math.round(Number(condition.secondaryPeriod) || 20)))
        : undefined,
  };
}

function sanitizeAlertRule(raw: unknown): AlertRule | null {
  if (!raw || typeof raw !== "object") return null;
  const rule = raw as Partial<AlertRule>;
  if (typeof rule.id !== "string" || typeof rule.symbol !== "string") return null;
  const conditions = Array.isArray(rule.conditions)
    ? rule.conditions.map(sanitizeAlertCondition).filter((item): item is AlertCondition => Boolean(item)).slice(0, 3)
    : [];
  const legacy = sanitizeAlertCondition(rule);
  const first = conditions[0] ?? legacy;
  if (!first) return null;
  return {
    id: rule.id,
    symbol: rule.symbol,
    type: first.type,
    threshold: first.threshold,
    conditions: conditions.length ? conditions : [first],
    logic: rule.logic === "any" ? "any" : "all",
    schedule: (["any", "trading", "preopen", "last10"] as AlertSchedule[]).includes(
      rule.schedule as AlertSchedule,
    )
      ? (rule.schedule as AlertSchedule)
      : "any",
    enabled: rule.enabled !== false,
    createdAt: typeof rule.createdAt === "number" ? rule.createdAt : Date.now(),
    lastTriggeredAt: typeof rule.lastTriggeredAt === "number" ? rule.lastTriggeredAt : null,
  };
}

function defaultPersisted(): PersistedState {
  return {
    version: 1,
    assets: DEFAULT_ASSETS.map((asset) => ({ ...asset, addedAt: Date.now() })),
    watchlist: DEFAULT_ASSETS.map((asset) => asset.symbol),
    watchlistGroups: [],
    activeWatchlistGroupId: null,
    holdings: [],
    alerts: [],
    events: [],
    settings: { ...DEFAULT_SETTINGS },
    selectedSymbol: DEFAULT_ASSETS[0]?.symbol ?? null,
    trading: defaultTradingLedger(Date.now(), DEFAULT_ASSETS[0]?.symbol ?? ""),
    marketSnapshot: null,
  };
}

export const state = reactive<AppState>({
  ...defaultPersisted(),
  ready: false,
  view: "watchlist",
  quotes: {},
  indices: [],
  refreshing: false,
  lastUpdated: null,
  marketFromCache: false,
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  searchOpen: false,
  toasts: [],
  detailRange: "intraday",
  holdingDialog: { open: false, holding: null },
  alertDialog: { open: false, symbol: null, rule: null },
});

export const watchlistAssets = computed(() => {
  const bySymbol = new Map(state.assets.map((asset) => [asset.symbol, asset]));
  return state.watchlist
    .map((symbol) => bySymbol.get(symbol))
    .filter((asset): asset is Asset => Boolean(asset));
});

export const selectedAsset = computed(
  () => state.assets.find((asset) => asset.symbol === state.selectedSymbol) ?? watchlistAssets.value[0] ?? null,
);

export const dataMode = computed<"live" | "demo" | "mixed" | "loading" | "cached">(() => {
  if (state.marketFromCache) return "cached";
  const quotes = Object.values(state.quotes);
  if (!quotes.length) return "loading";
  const demo = quotes.filter((quote) => quote.state === "demo").length;
  if (demo === quotes.length) return "demo";
  if (demo > 0 || quotes.some((quote) => quote.state === "nav")) return "mixed";
  return "live";
});

export const unreadAlertCount = computed(() => state.events.filter((event) => !event.read).length);

export function assetForSymbol(symbol: string) {
  return state.assets.find((asset) => asset.symbol === symbol) ?? demoAsset(symbol);
}

export function quoteFor(symbol: string) {
  return state.quotes[symbol];
}

function applyMarketSnapshot(snapshot = state.marketSnapshot) {
  if (!snapshot) return false;
  state.quotes = snapshot.quotes;
  state.indices = snapshot.indices;
  state.lastUpdated = snapshot.updatedAt;
  state.marketFromCache = true;
  return true;
}

function captureMarketSnapshot() {
  if (!state.lastUpdated || !Object.keys(state.quotes).length) return;
  state.marketSnapshot = {
    quotes: { ...state.quotes },
    indices: state.indices.map((index) => ({ ...index })),
    updatedAt: state.lastUpdated,
  };
  scheduleSave(0);
}

function sanitizePersisted(raw: unknown): PersistedState | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Partial<PersistedState>;
  if (!Array.isArray(source.assets) || !Array.isArray(source.watchlist)) return null;
  const assets = source.assets.filter(
    (asset): asset is Asset =>
      Boolean(
        asset &&
          typeof asset.symbol === "string" &&
          typeof asset.code === "string" &&
          typeof asset.name === "string" &&
          (asset.kind === "stock" || asset.kind === "fund"),
      ),
  );
  const watchlist = source.watchlist.filter((symbol): symbol is string => typeof symbol === "string");
  const watchlistGroups: WatchlistGroup[] = Array.isArray(source.watchlistGroups)
    ? source.watchlistGroups
        .filter(
          (group): group is WatchlistGroup =>
            Boolean(
              group &&
                typeof group.id === "string" &&
                typeof group.name === "string" &&
                Array.isArray(group.symbols),
            ),
        )
        .map((group) => ({
          id: group.id,
          name: group.name.trim().slice(0, 20),
          symbols: [...new Set(group.symbols.filter((symbol) => typeof symbol === "string" && watchlist.includes(symbol)))],
          createdAt: typeof group.createdAt === "number" ? group.createdAt : Date.now(),
        }))
        .filter((group) => group.name)
    : [];
  const settings: Settings = {
    refreshSeconds: [5, 15, 30, 60].includes(Number(source.settings?.refreshSeconds))
      ? (Number(source.settings?.refreshSeconds) as Settings["refreshSeconds"])
      : DEFAULT_SETTINGS.refreshSeconds,
    startView: (["watchlist", "holdings", "trading", "alerts", "settings"] as ViewKey[]).includes(
      source.settings?.startView as ViewKey,
    )
      ? (source.settings?.startView as ViewKey)
      : DEFAULT_SETTINGS.startView,
    notifications:
      typeof source.settings?.notifications === "boolean"
        ? source.settings.notifications
        : DEFAULT_SETTINGS.notifications,
    gainLossMode:
      source.settings?.gainLossMode === "accessible" || source.settings?.gainLossMode === "china"
        ? source.settings.gainLossMode
        : DEFAULT_SETTINGS.gainLossMode,
    watchlistDensity:
      source.settings?.watchlistDensity === "compact" || source.settings?.watchlistDensity === "comfortable"
        ? source.settings.watchlistDensity
        : DEFAULT_SETTINGS.watchlistDensity,
    watchlistSort: (["default", "changeDesc", "changeAsc", "priceDesc", "priceAsc", "volumeDesc"] as const).includes(
      source.settings?.watchlistSort as Settings["watchlistSort"],
    )
      ? (source.settings?.watchlistSort as Settings["watchlistSort"])
      : DEFAULT_SETTINGS.watchlistSort,
  };
  const marketSnapshot =
    source.marketSnapshot &&
    typeof source.marketSnapshot === "object" &&
    source.marketSnapshot.quotes &&
    typeof source.marketSnapshot.quotes === "object" &&
    Array.isArray(source.marketSnapshot.indices) &&
    typeof source.marketSnapshot.updatedAt === "number"
      ? {
          quotes: source.marketSnapshot.quotes,
          indices: source.marketSnapshot.indices,
          updatedAt: source.marketSnapshot.updatedAt,
        }
      : null;
  return {
    version: 1,
    assets,
    watchlist,
    watchlistGroups,
    activeWatchlistGroupId: watchlistGroups.some((group) => group.id === source.activeWatchlistGroupId)
      ? (source.activeWatchlistGroupId ?? null)
      : null,
    holdings: Array.isArray(source.holdings) ? source.holdings.filter((item) => item && typeof item.symbol === "string") : [],
    alerts: Array.isArray(source.alerts)
      ? source.alerts.map(sanitizeAlertRule).filter((item): item is AlertRule => Boolean(item))
      : [],
    events: Array.isArray(source.events)
      ? source.events.slice(0, 80).map((event) => ({
          ...event,
          changePct: typeof event.changePct === "number" ? event.changePct : null,
          amount: typeof event.amount === "number" ? event.amount : null,
          volume: typeof event.volume === "number" ? event.volume : null,
          source: typeof event.source === "string" ? event.source : "",
        }))
      : [],
    settings,
    selectedSymbol: typeof source.selectedSymbol === "string" ? source.selectedSymbol : null,
    trading: sanitizeTradingLedger(source.trading, watchlist[0] ?? ""),
    marketSnapshot,
  };
}

function applyPersisted(persisted: PersistedState) {
  const assets = persisted.assets.length ? persisted.assets : DEFAULT_ASSETS.map((asset) => ({ ...asset }));
  const known = new Set(assets.map((asset) => asset.symbol));
  for (const symbol of persisted.watchlist) {
    if (!known.has(symbol)) {
      const asset = demoAsset(symbol);
      assets.push(asset);
      known.add(symbol);
    }
  }
  const watchlist = persisted.watchlist.length ? persisted.watchlist : assets.map((asset) => asset.symbol);
  state.assets = assets;
  state.watchlist = watchlist;
  state.watchlistGroups = persisted.watchlistGroups;
  state.activeWatchlistGroupId = persisted.activeWatchlistGroupId;
  state.holdings = persisted.holdings;
  state.alerts = persisted.alerts;
  state.events = persisted.events;
  state.settings = persisted.settings;
  state.trading = persisted.trading;
  state.marketSnapshot = persisted.marketSnapshot;
  state.selectedSymbol =
    persisted.selectedSymbol && watchlist.includes(persisted.selectedSymbol)
      ? persisted.selectedSymbol
      : watchlist[0] ?? assets[0]?.symbol ?? null;
}

let saveTimer: number | undefined;
let pendingSaveAt = 0;
let applyingRemoteState = false;
let stateRevision = 0;
let latestRemoteRevision = 0;
let currentWindowLabel = "";
let unlistenWindowSync: Array<() => void> = [];

function snapshot(): PersistedState {
  return {
    version: 1,
    assets: state.assets,
    watchlist: state.watchlist,
    watchlistGroups: state.watchlistGroups,
    activeWatchlistGroupId: state.activeWatchlistGroupId,
    holdings: state.holdings,
    alerts: state.alerts,
    events: state.events,
    settings: state.settings,
    selectedSymbol: state.selectedSymbol,
    trading: state.trading,
    marketSnapshot: state.marketSnapshot,
  };
}

export function persistNow() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
  } catch (error) {
    console.warn("保存本地数据失败", error);
  }
}

function scheduleSave(delay = 240) {
  if (!state.ready) return;
  if (applyingRemoteState) return;
  const nextSaveAt = Date.now() + delay;
  if (saveTimer !== undefined && pendingSaveAt <= nextSaveAt) return;
  window.clearTimeout(saveTimer);
  pendingSaveAt = nextSaveAt;
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    pendingSaveAt = 0;
    persistNow();
    void publishWindowState();
  }, delay);
}

export function hydrate() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = sanitizePersisted(JSON.parse(raw));
      if (parsed) applyPersisted(parsed);
    }
  } catch (error) {
    console.warn("读取本地数据失败，已使用默认自选", error);
  }
  if (!Object.keys(state.quotes).length) applyMarketSnapshot();
  state.view = state.settings.startView;
  state.ready = true;
}

export function setNetworkOnline(online: boolean) {
  state.online = online;
  if (!online) applyMarketSnapshot();
}

let tradingDiskTimer: number | undefined;

export async function persistTradingNow() {
  if (!isTauri()) return;
  try {
    await saveTradingLedgerDisk(JSON.stringify(state.trading, null, 2));
  } catch (error) {
    console.warn("写入交易账本失败", error);
  }
}

function scheduleTradingDiskSave() {
  if (!state.ready || !isTauri()) return;
  window.clearTimeout(tradingDiskTimer);
  tradingDiskTimer = window.setTimeout(() => {
    void persistTradingNow();
  }, 300);
}

export async function hydrateTradingLedger() {
  if (!isTauri()) return;
  try {
    const raw = await loadTradingLedgerDisk();
    if (!raw) return;
    const restored = sanitizeTradingLedger(JSON.parse(raw), state.watchlist[0] ?? "");
    if (restored.updatedAt > state.trading.updatedAt) {
      state.trading = restored;
      persistNow();
      showToast("已恢复本地交易账本", "info");
    }
  } catch (error) {
    console.warn("读取交易账本失败", error);
  }
}

function nextStateRevision() {
  stateRevision = Math.max(Date.now(), stateRevision + 1, latestRemoteRevision + 1);
  return stateRevision;
}

async function publishWindowState(target?: string) {
  if (!isTauri() || !state.ready) return;
  try {
    const [{ emit, emitTo }, { getCurrentWindow }] = await Promise.all([
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/window"),
    ]);
    const payload: WindowStatePayload = {
      source: getCurrentWindow().label,
      revision: nextStateRevision(),
      persisted: snapshot(),
    };
    if (target) {
      await emitTo(target, STATE_SYNC_EVENT, payload);
    } else {
      await emit(STATE_SYNC_EVENT, payload);
    }
  } catch (error) {
    console.warn("同步桌面窗口状态失败", error);
  }
}

async function publishWindowMarket(target?: string) {
  if (!isTauri() || !state.ready) return;
  try {
    const [{ emit, emitTo }, { getCurrentWindow }] = await Promise.all([
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/window"),
    ]);
    const payload: WindowMarketPayload = {
      source: getCurrentWindow().label,
      quotes: state.quotes,
      indices: state.indices,
      lastUpdated: state.lastUpdated,
      fromCache: state.marketFromCache,
    };
    if (target) {
      await emitTo(target, MARKET_SYNC_EVENT, payload);
    } else {
      await emit(MARKET_SYNC_EVENT, payload);
    }
  } catch (error) {
    console.warn("同步桌面行情失败", error);
  }
}

async function publishSnapshot(target: string) {
  await Promise.all([publishWindowState(target), publishWindowMarket(target)]);
}

async function requestWindowSnapshot() {
  if (!isTauri()) return;
  try {
    const [{ emit }, { getCurrentWindow }] = await Promise.all([
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/window"),
    ]);
    const payload: WindowSyncRequest = { source: getCurrentWindow().label };
    await emit(SNAPSHOT_REQUEST_EVENT, payload);
  } catch (error) {
    console.warn("请求桌面窗口快照失败", error);
  }
}

export async function startWindowSync() {
  if (!isTauri() || unlistenWindowSync.length) return;
  try {
    const [{ listen }, { getCurrentWindow }] = await Promise.all([
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/window"),
    ]);
    const unlisteners: Array<() => void> = [];
    unlistenWindowSync = unlisteners;
    currentWindowLabel = getCurrentWindow().label;
    const unlistenState = await listen<WindowStatePayload>(STATE_SYNC_EVENT, (event) => {
      const payload = event.payload;
      if (
        !payload ||
        payload.source === currentWindowLabel ||
        !Number.isFinite(payload.revision) ||
        payload.revision <= latestRemoteRevision
      ) {
        return;
      }
      const persisted = sanitizePersisted(payload.persisted);
      if (!persisted) return;
      const selectedSymbolChanged = persisted.selectedSymbol !== state.selectedSymbol;
      applyingRemoteState = true;
      latestRemoteRevision = payload.revision;
      stateRevision = Math.max(stateRevision, payload.revision);
      applyPersisted(persisted);
      if (
        currentWindowLabel === "main" &&
        payload.source === "compact" &&
        selectedSymbolChanged
      ) {
        state.view = "watchlist";
        state.searchOpen = false;
      }
      persistNow();
      void nextTick(() => {
        applyingRemoteState = false;
      });
    });
    unlisteners.push(unlistenState);
    const unlistenMarket = await listen<WindowMarketPayload>(MARKET_SYNC_EVENT, (event) => {
      const payload = event.payload;
      if (!payload || payload.source === currentWindowLabel) return;
      state.quotes = payload.quotes && typeof payload.quotes === "object" ? payload.quotes : {};
      state.indices = Array.isArray(payload.indices) ? payload.indices : [];
      state.lastUpdated = typeof payload.lastUpdated === "number" ? payload.lastUpdated : null;
      state.marketFromCache = payload.fromCache === true;
    });
    unlisteners.push(unlistenMarket);
    const unlistenRequest = await listen<WindowSyncRequest>(SNAPSHOT_REQUEST_EVENT, (event) => {
      const payload = event.payload;
      if (!payload || payload.source === currentWindowLabel) return;
      void publishSnapshot(payload.source);
    });
    unlisteners.push(unlistenRequest);
    if (currentWindowLabel === "compact") {
      await requestWindowSnapshot();
    }
  } catch (error) {
    for (const unlisten of unlistenWindowSync) unlisten();
    unlistenWindowSync = [];
    console.warn("启用桌面窗口同步失败", error);
  }
}

export function stopSyncingWindows() {
  for (const unlisten of unlistenWindowSync) unlisten();
  unlistenWindowSync = [];
}

let toastId = 0;

export function showToast(message: string, tone: ToastItem["tone"] = "info", duration = 3600) {
  const item = { id: ++toastId, message, tone };
  state.toasts.push(item);
  window.setTimeout(() => dismissToast(item.id), duration);
}

export function dismissToast(id: number) {
  const index = state.toasts.findIndex((toast) => toast.id === id);
  if (index >= 0) state.toasts.splice(index, 1);
}

function processTradingMarket(forceEquity = false) {
  if (isTauri() && currentWindowLabel !== "" && currentWindowLabel !== "main") return;
  for (const position of [...state.trading.positions]) {
    const quote = quoteFor(position.symbol);
    const exit = riskExitForPosition(position, quote, state.trading.risk);
    if (!exit || !quote) continue;
    const asset = assetForSymbol(position.symbol);
    const result = submitTradingOrder(
      state.trading,
      {
        symbol: position.symbol,
        side: "sell",
        type: "market",
        quantity: position.quantity,
        reason: `${exit.reason} ${exit.pnlPct.toFixed(2)}%`,
      },
      asset,
      quote,
    );
    state.trading.agentDecisions.unshift({
      id: uid("agent"),
      at: Date.now(),
      symbol: position.symbol,
      action: "execute",
      confidence: 100,
      reason: `${exit.reason}，自动平仓`,
      signalId: null,
      riskFlags: [exit.reason],
    });
    state.trading.agentDecisions = state.trading.agentDecisions.slice(0, 200);
    if (result.fill) showToast(`${asset.name} ${exit.reason}，已模拟平仓`, "info");
  }
  const fills = matchPendingTradingOrders(state.trading, state.quotes, assetForSymbol);
  for (const fill of fills) {
    const asset = assetForSymbol(fill.symbol);
    showToast(
      `${asset.name} ${fill.side === "buy" ? "买入" : "卖出"} ${fill.quantity} @ ${fill.price.toFixed(3)}`,
      "success",
    );
  }
  const recorded = recordEquityPoint(state.trading, state.quotes, Date.now(), forceEquity || fills.length > 0);
  if (fills.length || recorded) scheduleSave();
}

let tradingEvaluationPromise: Promise<unknown> | null = null;

export async function evaluateTradingStrategy(manual = false) {
  if (isTauri() && currentWindowLabel !== "" && currentWindowLabel !== "main") return null;
  if (tradingEvaluationPromise && !manual) return tradingEvaluationPromise;
  tradingEvaluationPromise = (async () => {
    const strategy = state.trading.strategy;
    const symbol = strategy.symbol || state.selectedSymbol || state.watchlist[0] || "";
    const asset = symbol ? assetForSymbol(symbol) : null;
    const quote = symbol ? quoteFor(symbol) : undefined;
    if (!asset || !quote?.price) {
      strategy.lastReason = "当前没有可用行情，无法计算信号";
      strategy.lastAction = "hold";
      strategy.lastEvaluatedAt = Date.now();
      scheduleSave();
      if (manual) showToast(strategy.lastReason, "error");
      return null;
    }
    strategy.symbol = symbol;
    const points = await fetchTrend(asset, "1y");
    const previousCross = strategy.lastCross;
    const evaluation = evaluateSmaCross(
      points,
      strategy.shortWindow,
      strategy.longWindow,
      previousCross,
      quote,
    );
    if (!evaluation) {
      strategy.lastReason = "历史数据不足，至少需要长均线窗口加 1 个数据点";
      strategy.lastAction = "hold";
      strategy.lastEvaluatedAt = Date.now();
      state.trading.updatedAt = Date.now();
      scheduleSave();
      if (manual) showToast(strategy.lastReason, "info");
      return null;
    }
    recordStrategyEvaluation(state.trading, symbol, evaluation);
    let signal = null;
    if (evaluation.cross && evaluation.cross !== previousCross) {
      signal = createTradingSignal(state.trading, symbol, evaluation);
      if (strategy.enabled) {
        let quantity = suggestedTradingQuantity(asset, strategy.orderNotional, quote.price);
        if (strategy.agentEnabled) {
          const stats = calculateTradingStats(state.trading, state.quotes);
          const decision = evaluateTradingAgent(state.trading, signal, quote, quantity, stats);
          if (decision.action === "block" || decision.action === "observe") {
            showToast(`智能体暂不执行：${decision.reason}`, "info");
            quantity = 0;
          } else if (decision.action === "reduce") {
            quantity = Math.max(
              asset.kind === "fund" ? 0.01 : 100,
              Math.floor(quantity / 2 / (asset.kind === "fund" ? 0.01 : 100)) *
                (asset.kind === "fund" ? 0.01 : 100),
            );
          }
        }
        if (quantity <= 0) {
          scheduleSave();
          return { evaluation, signal };
        }
        const result = submitTradingOrder(
          state.trading,
          {
            symbol,
            side: evaluation.action === "sell" ? "sell" : "buy",
            type: "market",
            quantity,
            reason: `SMA${strategy.shortWindow}/${strategy.longWindow} 自动信号`,
          },
          asset,
          quote,
        );
        signal.orderId = result.order?.id ?? null;
        if (result.error) showToast(`策略信号未能成交：${result.error}`, "error");
        else if (result.fill) {
          showToast(
            `${asset.name} 自动${result.fill.side === "buy" ? "买入" : "卖出"} ${result.fill.quantity} 股/份`,
            "success",
          );
        }
      }
    }
    recordEquityPoint(state.trading, state.quotes, Date.now(), Boolean(signal));
    scheduleSave();
    if (manual) {
      showToast(
        evaluation.action === "hold" ? evaluation.reason : `${evaluation.reason}，已记录信号`,
        "info",
      );
    }
    return { evaluation, signal };
  })().finally(() => {
    tradingEvaluationPromise = null;
  });
  return tradingEvaluationPromise;
}

export function updateTradingStrategy(patch: Partial<TradingStrategy>) {
  const strategy = state.trading.strategy;
  if (patch.symbol && state.watchlist.includes(patch.symbol)) strategy.symbol = patch.symbol;
  if (patch.shortWindow != null) {
    strategy.shortWindow = Math.min(60, Math.max(2, Math.round(patch.shortWindow)));
  }
  if (patch.longWindow != null) {
    strategy.longWindow = Math.min(240, Math.max(strategy.shortWindow + 1, Math.round(patch.longWindow)));
  }
  if (strategy.longWindow <= strategy.shortWindow) strategy.longWindow = strategy.shortWindow + 1;
  if (patch.orderNotional != null) strategy.orderNotional = Math.max(1000, patch.orderNotional);
  if (patch.enabled != null) strategy.enabled = patch.enabled;
  if (patch.agentEnabled != null) strategy.agentEnabled = patch.agentEnabled;
  state.trading.updatedAt = Date.now();
  scheduleSave();
}

export function updateTradingRisk(patch: Partial<TradingRiskConfig>) {
  const risk = state.trading.risk;
  if (patch.maxPositionPct != null) risk.maxPositionPct = Math.min(100, Math.max(1, patch.maxPositionPct));
  if (patch.maxDrawdownPct != null) risk.maxDrawdownPct = Math.min(80, Math.max(1, patch.maxDrawdownPct));
  if (patch.dailyLossLimitPct != null) {
    risk.dailyLossLimitPct = Math.min(30, Math.max(0.5, patch.dailyLossLimitPct));
  }
  if (patch.stopLossPct != null) risk.stopLossPct = Math.min(50, Math.max(0.5, patch.stopLossPct));
  if (patch.takeProfitPct != null) risk.takeProfitPct = Math.min(200, Math.max(1, patch.takeProfitPct));
  state.trading.updatedAt = Date.now();
  scheduleSave();
}

let backtestPromise: Promise<unknown> | null = null;

export async function runTradingBacktest() {
  if (backtestPromise) return backtestPromise;
  backtestPromise = (async () => {
    const strategy = state.trading.strategy;
    const asset = assetForSymbol(strategy.symbol);
    const points = await fetchTrend(asset, "1y");
    const result = runSmaBacktest(
      points,
      strategy,
      asset,
      state.trading.risk,
      state.trading.initialCapital,
    );
    state.trading.backtest = result;
    state.trading.updatedAt = Date.now();
    scheduleSave();
    showToast(
      `回测完成：收益 ${result.totalReturn.toFixed(2)}%，最大回撤 ${result.maxDrawdown.toFixed(2)}%`,
      result.riskPassed ? "success" : "info",
    );
    return result;
  })().finally(() => {
    backtestPromise = null;
  });
  return backtestPromise;
}

export function placeTradingOrder(input: {
  symbol: string;
  side: TradingSide;
  type: TradingOrderType;
  quantity: number;
  limitPrice?: number | null;
}) {
  const asset = assetForSymbol(input.symbol);
  const result = submitTradingOrder(state.trading, input, asset, quoteFor(input.symbol));
  if (result.error) {
    showToast(result.error, "error");
    return result;
  }
  if (result.fill) {
    showToast(
      `${asset.name} ${result.fill.side === "buy" ? "买入" : "卖出"}成交 ${result.fill.quantity}，手续费 ¥${result.fill.fee.toFixed(2)}`,
      "success",
    );
    recordEquityPoint(state.trading, state.quotes, Date.now(), true);
  } else {
    showToast(`${asset.name} 限价委托已挂单`, "info");
  }
  scheduleSave();
  return result;
}

export function cancelPendingTradingOrder(orderId: string) {
  const cancelled = cancelTradingOrder(state.trading, orderId);
  if (cancelled) {
    showToast("委托已撤销", "info");
    scheduleSave();
  }
  return cancelled;
}

export function resetTradingAccount() {
  resetLedger(state.trading, state.selectedSymbol ?? state.watchlist[0] ?? "");
  scheduleSave();
  void persistTradingNow();
  showToast("模拟账户已重置", "info");
}

let refreshingPromise: Promise<void> | null = null;
let lastFetchAt = 0;

export async function refreshQuotes(force = false) {
  if (refreshingPromise) return refreshingPromise;
  if (!force && Date.now() - lastFetchAt < 1000) return;
  refreshingPromise = (async () => {
    state.refreshing = true;
    state.online = typeof navigator === "undefined" ? true : navigator.onLine;
    if (!state.online) {
      applyMarketSnapshot();
      state.refreshing = false;
      refreshingPromise = null;
      return;
    }
    const symbols = new Set([...state.watchlist, ...state.holdings.map((holding) => holding.symbol)]);
    if (state.selectedSymbol) symbols.add(state.selectedSymbol);
    const assets = [...symbols].map(assetForSymbol);
    try {
      const quotes = await fetchQuotes(assets);
      if (quotes.length && quotes.every((quote) => quote.state === "demo") && state.marketSnapshot) {
        applyMarketSnapshot();
        return;
      }
      const next: Record<string, Quote> = { ...state.quotes };
      for (const quote of quotes) next[quote.symbol] = quote;
      state.quotes = next;
      lastFetchAt = Date.now();
      state.lastUpdated = lastFetchAt;
      state.marketFromCache = false;
      state.online = true;
      captureMarketSnapshot();
      await checkAlerts();
      if (!isTauri() || currentWindowLabel === "" || currentWindowLabel === "main") {
        processTradingMarket();
        if (state.trading.strategy.enabled) void evaluateTradingStrategy();
      }
      void publishWindowMarket();
    } finally {
      state.refreshing = false;
      refreshingPromise = null;
    }
  })();
  return refreshingPromise;
}

export async function refreshIndices() {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    state.online = false;
    applyMarketSnapshot();
    return;
  }
  try {
    const indices = await fetchIndices();
    if (indices.length) {
      state.indices = indices;
      if (state.lastUpdated) {
        state.marketSnapshot = {
          quotes: { ...state.quotes },
          indices: indices.map((index) => ({ ...index })),
          updatedAt: state.lastUpdated,
        };
        scheduleSave(0);
      }
      void publishWindowMarket();
    }
  } catch (error) {
    console.warn("指数行情更新失败", error);
  }
}

export async function refreshAll() {
  await Promise.all([refreshQuotes(true), refreshIndices()]);
}

let pollTimer: number | undefined;

export function startPolling() {
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => {
    if (document.hidden) return;
    if (Date.now() - lastFetchAt >= effectiveRefreshMs(state.settings.refreshSeconds)) {
      void refreshQuotes();
      void refreshIndices();
    }
  }, 4000);
}

export function setView(view: ViewKey) {
  state.view = view;
  state.searchOpen = false;
}

export function selectAsset(symbol: string) {
  state.selectedSymbol = symbol;
  state.detailRange = assetForSymbol(symbol).market === "jj" ? "3m" : "intraday";
  state.view = "watchlist";
  scheduleSave(0);
}

export function ensureAsset(result: SearchResult): Asset {
  const existing = state.assets.find((asset) => asset.symbol === result.symbol);
  if (existing) return existing;
  const asset: Asset = { ...result, addedAt: Date.now() };
  state.assets.push(asset);
  return asset;
}

export function addToWatchlist(result: SearchResult) {
  const asset = ensureAsset(result);
  const group = state.watchlistGroups.find((item) => item.id === state.activeWatchlistGroupId);
  if (!state.watchlist.includes(asset.symbol)) {
    state.watchlist.push(asset.symbol);
    showToast(group ? `已把 ${asset.name} 加入「${group.name}」` : `已把 ${asset.name} 加入自选`, "success");
  } else {
    showToast(group ? `已将 ${asset.name} 加入「${group.name}」` : `${asset.name} 已在自选中`, "info");
  }
  if (group && !group.symbols.includes(asset.symbol)) group.symbols.push(asset.symbol);
  selectAsset(asset.symbol);
  state.searchOpen = false;
  scheduleSave();
  void refreshQuotes(true);
}

export function removeFromWatchlist(symbol: string) {
  const index = state.watchlist.indexOf(symbol);
  if (index < 0) return;
  const asset = assetForSymbol(symbol);
  state.watchlist.splice(index, 1);
  for (const group of state.watchlistGroups) {
    const groupIndex = group.symbols.indexOf(symbol);
    if (groupIndex >= 0) group.symbols.splice(groupIndex, 1);
  }
  if (
    state.activeWatchlistGroupId &&
    state.watchlistGroups.find((item) => item.id === state.activeWatchlistGroupId)?.symbols.length === 0
  ) {
    state.activeWatchlistGroupId = null;
  }
  if (state.selectedSymbol === symbol) {
    state.selectedSymbol = state.watchlist[Math.min(index, state.watchlist.length - 1)] ?? null;
  }
  const held = state.holdings.some((holding) => holding.symbol === symbol);
  showToast(held ? `已将 ${asset.name} 移出自选，持仓仍保留` : `已将 ${asset.name} 移出自选`, "info");
  scheduleSave();
}

export function setActiveWatchlistGroup(id: string | null) {
  if (id && !state.watchlistGroups.some((group) => group.id === id)) return;
  state.activeWatchlistGroupId = id;
  scheduleSave(0);
}

export function createWatchlistGroup(name: string) {
  const trimmed = name.trim().slice(0, 20);
  if (!trimmed) {
    showToast("请输入分组名称", "error");
    return null;
  }
  const duplicate = state.watchlistGroups.find((group) => group.name === trimmed);
  if (duplicate) {
    showToast("已经有同名分组", "info");
    state.activeWatchlistGroupId = duplicate.id;
    scheduleSave(0);
    return duplicate;
  }
  const group: WatchlistGroup = {
    id: uid("group"),
    name: trimmed,
    symbols: [],
    createdAt: Date.now(),
  };
  state.watchlistGroups.push(group);
  state.activeWatchlistGroupId = group.id;
  scheduleSave();
  showToast(`已创建分组「${group.name}」`, "success");
  return group;
}

export function renameWatchlistGroup(id: string, name: string) {
  const group = state.watchlistGroups.find((item) => item.id === id);
  const trimmed = name.trim().slice(0, 20);
  if (!group || !trimmed) return false;
  if (state.watchlistGroups.some((item) => item.id !== id && item.name === trimmed)) {
    showToast("已经有同名分组", "info");
    return false;
  }
  group.name = trimmed;
  scheduleSave();
  return true;
}

export function deleteWatchlistGroup(id: string) {
  const index = state.watchlistGroups.findIndex((group) => group.id === id);
  if (index < 0) return;
  const [removed] = state.watchlistGroups.splice(index, 1);
  if (state.activeWatchlistGroupId === id) state.activeWatchlistGroupId = null;
  showToast(`已删除分组「${removed.name}」，自选标的仍保留`, "info");
  scheduleSave();
}

export function toggleWatchlistGroupSymbol(groupId: string, symbol: string) {
  const group = state.watchlistGroups.find((item) => item.id === groupId);
  if (!group || !state.watchlist.includes(symbol)) return;
  const index = group.symbols.indexOf(symbol);
  if (index >= 0) {
    group.symbols.splice(index, 1);
    showToast(`已从「${group.name}」移除`, "info");
  } else {
    group.symbols.push(symbol);
    showToast(`已加入「${group.name}」`, "success");
  }
  scheduleSave();
}

export function createAlert(rule: Omit<AlertRule, "id" | "createdAt" | "lastTriggeredAt" | "enabled">) {
  const alert: AlertRule = {
    ...rule,
    id: uid("alert"),
    enabled: true,
    createdAt: Date.now(),
    lastTriggeredAt: Date.now(),
  };
  state.alerts.unshift(alert);
  const asset = assetForSymbol(rule.symbol);
  showToast(`已为 ${asset.name} 设置提醒`, "success");
  scheduleSave();
  return alert;
}

export function updateAlert(id: string, patch: Partial<AlertRule>) {
  const alert = state.alerts.find((item) => item.id === id);
  if (!alert) return;
  Object.assign(alert, patch);
  scheduleSave();
}

export function deleteAlert(id: string) {
  const index = state.alerts.findIndex((alert) => alert.id === id);
  if (index >= 0) {
    state.alerts.splice(index, 1);
    scheduleSave();
  }
}

export function markEventsRead(ids?: string[]) {
  const selected = ids ? new Set(ids) : null;
  let changed = false;
  for (const event of state.events) {
    if (event.read || (selected && !selected.has(event.id))) continue;
    event.read = true;
    changed = true;
  }
  if (changed) scheduleSave();
}

export function addHolding(input: { symbol: string; shares: number; cost: number; note: string }) {
  const existing = state.holdings.find((holding) => holding.symbol === input.symbol);
  if (existing) {
    existing.shares = input.shares;
    existing.cost = input.cost;
    existing.note = input.note;
    existing.updatedAt = Date.now();
  } else {
    state.holdings.push({
      id: uid("holding"),
      symbol: input.symbol,
      shares: input.shares,
      cost: input.cost,
      note: input.note,
      updatedAt: Date.now(),
    });
  }
  const asset = assetForSymbol(input.symbol);
  if (!state.watchlist.includes(input.symbol)) state.watchlist.push(input.symbol);
  if (!state.assets.some((item) => item.symbol === input.symbol)) state.assets.push(asset);
  showToast(`已保存 ${asset.name} 的持仓`, "success");
  scheduleSave();
  void refreshQuotes(true);
}

export function deleteHolding(id: string) {
  const index = state.holdings.findIndex((holding) => holding.id === id);
  if (index >= 0) {
    state.holdings.splice(index, 1);
    showToast("已删除该笔持仓", "info");
    scheduleSave();
  }
}

export function openHoldingDialog(holding: Holding | null = null) {
  state.holdingDialog = { open: true, holding };
}

export function closeHoldingDialog() {
  state.holdingDialog = { open: false, holding: null };
}

export function openAlertDialog(symbol: string | null = null, rule: AlertRule | null = null) {
  state.alertDialog = { open: true, symbol: symbol ?? state.selectedSymbol, rule };
}

export function closeAlertDialog() {
  state.alertDialog = { open: false, symbol: null, rule: null };
}

export async function requestNotificationPermission() {
  if (!isTauri()) return true;
  try {
    const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch (error) {
    console.warn("通知权限申请失败", error);
    return false;
  }
}

async function sendSystemNotification(body: string) {
  if (!state.settings.notifications || !isTauri()) return;
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import(
      "@tauri-apps/plugin-notification"
    );
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) {
      sendNotification({ title: "简盯 · 提醒", body });
    }
  } catch (error) {
    console.warn("系统通知发送失败", error);
  }
}

const technicalTrendCache = new Map<string, { at: number; points: Awaited<ReturnType<typeof fetchTrend>> }>();
let alertEvaluationPromise: Promise<void> | null = null;

const TECHNICAL_ALERT_TYPES = new Set<AlertType>([
  "rsiAbove",
  "rsiBelow",
  "smaGolden",
  "smaDeath",
  "volumeSpike",
]);

function alertScheduleActive(schedule: AlertSchedule = "any", now = new Date()) {
  if (schedule === "any") return true;
  if (schedule === "trading") return marketPhase(now) === "交易中";
  if (schedule === "preopen") return marketPhase(now) === "集合竞价";
  const parts = shanghaiParts(now);
  const minutes = parts.hour * 60 + parts.minute;
  return marketPhase(now) === "交易中" && minutes >= 14 * 60 + 50 && minutes <= 15 * 60;
}

async function checkAlerts() {
  if (alertEvaluationPromise) return alertEvaluationPromise;
  alertEvaluationPromise = (async () => {
  const now = Date.now();
  const symbols = new Set<string>();
  const cycleEvents = new Map<string, AlertEvent[]>();
  for (const rule of state.alerts) {
    if (!rule.enabled || !alertScheduleActive(rule.schedule, new Date(now))) continue;
    if (alertConditions(rule).some((condition) => TECHNICAL_ALERT_TYPES.has(condition.type))) {
      symbols.add(rule.symbol);
    }
  }
  await Promise.all(
    [...symbols].map(async (symbol) => {
      const cached = technicalTrendCache.get(symbol);
      if (cached && now - cached.at < 90_000) return;
      try {
        const points = await fetchTrend(assetForSymbol(symbol), "1y");
        technicalTrendCache.set(symbol, { at: now, points });
      } catch (error) {
        console.warn(`技术指标行情加载失败 ${symbol}`, error);
      }
    }),
  );
  for (const rule of state.alerts) {
    if (!rule.enabled) continue;
    if (!alertScheduleActive(rule.schedule, new Date(now))) continue;
    if (rule.lastTriggeredAt && now - rule.lastTriggeredAt < ALERT_COOLDOWN) continue;
    const quote = state.quotes[rule.symbol];
    const holding = state.holdings.find((item) => item.symbol === rule.symbol);
    if (
      !isTriggered(rule, quote, {
        trend: technicalTrendCache.get(rule.symbol)?.points,
        holdingCost: holding?.cost,
      })
    ) {
      continue;
    }
    rule.lastTriggeredAt = now;
    const event: AlertEvent = {
      id: uid("event"),
      ruleId: rule.id,
      symbol: rule.symbol,
      name: quote.name,
      message: alertEventMessage(rule, quote),
      price: quote.price ?? 0,
      at: now,
      read: false,
      changePct: quote.changePct,
      amount: quote.amount,
      volume: quote.volume,
      source: quote.source,
    };
    state.events.unshift(event);
    if (state.events.length > 80) state.events.length = 80;
    const symbolEvents = cycleEvents.get(rule.symbol) ?? [];
    symbolEvents.push(event);
    cycleEvents.set(rule.symbol, symbolEvents);
    scheduleSave();
  }
  for (const events of cycleEvents.values()) {
    const first = events[0];
    const message =
      events.length === 1
        ? first.message
        : `${first.name} 同时触发 ${events.length} 条提醒：${events
            .map((event) => event.message.replace(`${first.name} `, ""))
            .join("；")}`;
    showToast(message, "info", 5600);
    void sendSystemNotification(message);
  }
  })().finally(() => {
    alertEvaluationPromise = null;
  });
  return alertEvaluationPromise;
}

export function updateSettings(patch: Partial<Settings>) {
  Object.assign(state.settings, patch);
  scheduleSave();
  if (patch.refreshSeconds) {
    void refreshQuotes(true);
  }
}

export async function copyBackup() {
  const text = JSON.stringify({ app: "jianding", exportedAt: new Date().toISOString(), data: snapshot() }, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    showToast("本地数据已复制到剪贴板", "success");
    return true;
  } catch (error) {
    console.warn("复制备份失败", error);
    showToast("复制失败，请检查剪贴板权限", "error");
    return false;
  }
}

export function restoreBackup(text: string) {
  const parsed = JSON.parse(text) as { data?: unknown } | unknown;
  const candidate =
    parsed && typeof parsed === "object" && "data" in parsed
      ? (parsed as { data: unknown }).data
      : parsed;
  const sanitized = sanitizePersisted(candidate);
  if (!sanitized) throw new Error("备份内容无法识别");
  applyPersisted(sanitized);
  persistNow();
  state.view = sanitized.settings.startView;
  showToast("备份已恢复", "success");
  void refreshAll();
}

export function resetAllData() {
  const next = defaultPersisted();
  applyPersisted(next);
  state.quotes = {};
  state.events = [];
  persistNow();
  state.view = "watchlist";
  showToast("已恢复默认自选", "info");
  void refreshAll();
}

watch(
  () => [
    state.assets,
    state.watchlist,
    state.watchlistGroups,
    state.activeWatchlistGroupId,
    state.holdings,
    state.alerts,
    state.events,
    state.settings,
    state.selectedSymbol,
    state.trading,
  ],
  () => scheduleSave(),
  { deep: true },
);

watch(
  () => state.trading,
  () => scheduleTradingDiskSave(),
  { deep: true },
);
