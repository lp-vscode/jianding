import { computed, nextTick, reactive, watch } from "vue";
import type {
  AlertEvent,
  AlertRule,
  Asset,
  Holding,
  IndexQuote,
  Quote,
  SearchResult,
  Settings,
  ToastItem,
  TrendRange,
  ViewKey,
} from "../types";
import { fetchIndices, fetchQuotes, isTauri } from "./backend";
import { alertEventMessage, isTriggered } from "./alerts";
import { DEFAULT_ASSETS, demoAsset } from "./demo";
import { effectiveRefreshMs } from "./market";

const STORAGE_KEY = "jianding:state:v1";
const ALERT_COOLDOWN = 30 * 60 * 1000;

const DEFAULT_SETTINGS: Settings = {
  refreshSeconds: 15,
  startView: "watchlist",
  notifications: true,
};

interface PersistedState {
  version: 1;
  assets: Asset[];
  watchlist: string[];
  holdings: Holding[];
  alerts: AlertRule[];
  events: AlertEvent[];
  settings: Settings;
  selectedSymbol: string | null;
}

interface AppState extends PersistedState {
  ready: boolean;
  view: ViewKey;
  quotes: Record<string, Quote>;
  indices: IndexQuote[];
  refreshing: boolean;
  lastUpdated: number | null;
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

function defaultPersisted(): PersistedState {
  return {
    version: 1,
    assets: DEFAULT_ASSETS.map((asset) => ({ ...asset, addedAt: Date.now() })),
    watchlist: DEFAULT_ASSETS.map((asset) => asset.symbol),
    holdings: [],
    alerts: [],
    events: [],
    settings: { ...DEFAULT_SETTINGS },
    selectedSymbol: DEFAULT_ASSETS[0]?.symbol ?? null,
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

export const dataMode = computed<"live" | "demo" | "mixed" | "loading">(() => {
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
  const settings: Settings = {
    refreshSeconds: [5, 15, 30, 60].includes(Number(source.settings?.refreshSeconds))
      ? (Number(source.settings?.refreshSeconds) as Settings["refreshSeconds"])
      : DEFAULT_SETTINGS.refreshSeconds,
    startView: (["watchlist", "holdings", "alerts", "settings"] as ViewKey[]).includes(
      source.settings?.startView as ViewKey,
    )
      ? (source.settings?.startView as ViewKey)
      : DEFAULT_SETTINGS.startView,
    notifications:
      typeof source.settings?.notifications === "boolean"
        ? source.settings.notifications
        : DEFAULT_SETTINGS.notifications,
  };
  return {
    version: 1,
    assets,
    watchlist,
    holdings: Array.isArray(source.holdings) ? source.holdings.filter((item) => item && typeof item.symbol === "string") : [],
    alerts: Array.isArray(source.alerts) ? source.alerts.filter((item) => item && typeof item.symbol === "string") : [],
    events: Array.isArray(source.events) ? source.events.slice(0, 80) : [],
    settings,
    selectedSymbol: typeof source.selectedSymbol === "string" ? source.selectedSymbol : null,
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
  state.holdings = persisted.holdings;
  state.alerts = persisted.alerts;
  state.events = persisted.events;
  state.settings = persisted.settings;
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
    holdings: state.holdings,
    alerts: state.alerts,
    events: state.events,
    settings: state.settings,
    selectedSymbol: state.selectedSymbol,
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
  state.view = state.settings.startView;
  state.ready = true;
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

let refreshingPromise: Promise<void> | null = null;
let lastFetchAt = 0;

export async function refreshQuotes(force = false) {
  if (refreshingPromise) return refreshingPromise;
  if (!force && Date.now() - lastFetchAt < 1000) return;
  refreshingPromise = (async () => {
    state.refreshing = true;
    const symbols = new Set([...state.watchlist, ...state.holdings.map((holding) => holding.symbol)]);
    if (state.selectedSymbol) symbols.add(state.selectedSymbol);
    const assets = [...symbols].map(assetForSymbol);
    try {
      const quotes = await fetchQuotes(assets);
      const next: Record<string, Quote> = { ...state.quotes };
      for (const quote of quotes) next[quote.symbol] = quote;
      state.quotes = next;
      lastFetchAt = Date.now();
      state.lastUpdated = lastFetchAt;
      checkAlerts();
      void publishWindowMarket();
    } finally {
      state.refreshing = false;
      refreshingPromise = null;
    }
  })();
  return refreshingPromise;
}

export async function refreshIndices() {
  try {
    const indices = await fetchIndices();
    if (indices.length) {
      state.indices = indices;
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
  if (!state.watchlist.includes(asset.symbol)) {
    state.watchlist.push(asset.symbol);
    showToast(`已把 ${asset.name} 加入自选`, "success");
  } else {
    showToast(`${asset.name} 已在自选中`, "info");
  }
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
  if (state.selectedSymbol === symbol) {
    state.selectedSymbol = state.watchlist[Math.min(index, state.watchlist.length - 1)] ?? null;
  }
  const held = state.holdings.some((holding) => holding.symbol === symbol);
  showToast(held ? `已将 ${asset.name} 移出自选，持仓仍保留` : `已将 ${asset.name} 移出自选`, "info");
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

export function markEventsRead() {
  for (const event of state.events) event.read = true;
  scheduleSave();
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

function checkAlerts() {
  const now = Date.now();
  for (const rule of state.alerts) {
    if (!rule.enabled) continue;
    if (rule.lastTriggeredAt && now - rule.lastTriggeredAt < ALERT_COOLDOWN) continue;
    const quote = state.quotes[rule.symbol];
    if (!isTriggered(rule, quote)) continue;
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
    };
    state.events.unshift(event);
    if (state.events.length > 80) state.events.length = 80;
    showToast(event.message, "info", 5600);
    void sendSystemNotification(event.message);
    scheduleSave();
  }
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
  () => [state.assets, state.watchlist, state.holdings, state.alerts, state.events, state.settings, state.selectedSymbol],
  () => scheduleSave(),
  { deep: true },
);
