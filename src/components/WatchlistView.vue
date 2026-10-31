<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  BellPlus,
  BellRing,
  Check,
  FolderPlus,
  GitCompareArrows,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Star,
  StarOff,
  Trash2,
  X,
} from "lucide-vue-next";
import type { Asset, TrendPoint, TrendRange, WatchlistSort } from "../types";
import {
  addToWatchlist,
  createWatchlistGroup,
  dataMode,
  deleteWatchlistGroup,
  openAlertDialog,
  quoteFor,
  refreshAll,
  removeFromWatchlist,
  renameWatchlistGroup,
  selectAsset,
  setActiveWatchlistGroup,
  setView,
  state,
  toggleWatchlistGroupSymbol,
  updateSettings,
  watchlistAssets,
} from "../lib/store";
import { fetchTrend } from "../lib/backend";
import {
  formatCompactMoney,
  formatPercent,
  formatPrice,
  formatSigned,
  formatVolume,
  directionMark,
  priceDigits,
  toneOf,
} from "../lib/format";
import {
  alertConditions,
  alertRuleSummary,
  isTriggered,
  priceAlertLevels,
  visiblePriceAlertLevels,
  type PriceAlertLevel,
} from "../lib/alerts";
import { intradaySignal, isDataDelayed, marketPhase } from "../lib/market";
import MarketBrief from "./MarketBrief.vue";
import ComparisonDialog from "./ComparisonDialog.vue";
import StockAiDialog from "./StockAiDialog.vue";
import TrendChart from "./TrendChart.vue";

const ranges: { key: TrendRange; label: string }[] = [
  { key: "intraday", label: "分时" },
  { key: "5d", label: "5日" },
  { key: "1m", label: "1月" },
  { key: "3m", label: "3月" },
  { key: "1y", label: "1年" },
  { key: "day", label: "日K" },
  { key: "week", label: "周K" },
  { key: "month", label: "月K" },
];

const trend = ref<TrendPoint[]>([]);
const trendLoading = ref(false);
const showChartTable = ref(false);
const watchMode = ref<"list" | "heatmap">("list");
const assetClassFilter = ref<"all" | "stock" | "fund" | "jj">("all");
const detailSheetOpen = ref(false);
const mobileViewport = ref(false);
const tickFlashes = ref<Record<string, { tone: "up" | "down"; token: number }>>({});
const rowButtons = new Map<string, HTMLButtonElement>();
const healthNow = ref(Date.now());
const groupEditorOpen = ref(false);
const groupName = ref("");
const editingGroupId = ref<string | null>(null);
const groupNameEl = ref<HTMLInputElement | null>(null);
const groupDeleteArmed = ref(false);
const quickSymbol = ref<string | null>(null);
const quickPrimary = ref<HTMLButtonElement | null>(null);
const detailSheetClose = ref<HTMLButtonElement | null>(null);
const compareOpen = ref(false);
const compareTrigger = ref<HTMLButtonElement | null>(null);
const stockAiOpen = ref(false);
const stockAiTrigger = ref<HTMLButtonElement | null>(null);
const flashTimers = new Map<string, number>();
const lastPrices = new Map<string, number>();
let requestToken = 0;
let flashToken = 0;
let longPressTimer: number | undefined;
let groupDeleteTimer: number | undefined;
let suppressRowClick = false;
let detailSheetTrigger: HTMLElement | null = null;
let mobileMedia: MediaQueryList | null = null;

const healthTimer = window.setInterval(() => {
  healthNow.value = Date.now();
}, 5_000);

const sortOptions: { value: WatchlistSort; label: string }[] = [
  { value: "default", label: "默认顺序" },
  { value: "alertFirst", label: "提醒优先" },
  { value: "changeDesc", label: "涨幅优先" },
  { value: "changeAsc", label: "跌幅优先" },
  { value: "priceDesc", label: "价格从高到低" },
  { value: "priceAsc", label: "价格从低到高" },
  { value: "volumeDesc", label: "成交量优先" },
];

const activeGroup = computed(
  () => state.watchlistGroups.find((group) => group.id === state.activeWatchlistGroupId) ?? null,
);
const activeSymbols = computed(() => activeGroup.value?.symbols ?? state.watchlist);
const activeAssets = computed(() => {
  const bySymbol = new Map(watchlistAssets.value.map((asset) => [asset.symbol, asset]));
  return activeSymbols.value
    .map((symbol) => bySymbol.get(symbol))
    .filter((asset): asset is Asset => Boolean(asset));
});
const dataDelayed = computed(() =>
  dataMode.value === "demo"
    ? false
    : isDataDelayed(state.lastUpdated, state.settings.refreshSeconds, new Date(healthNow.value)),
);
const assetClassTabs = computed(() => {
  const definitions: Array<{ key: typeof assetClassFilter.value; label: string }> = [
    { key: "all", label: "全部" },
    { key: "stock", label: "A股" },
    { key: "fund", label: "ETF / LOF" },
    { key: "jj", label: "场外基金" },
  ];
  return definitions.map((definition) => {
    const assets = activeAssets.value.filter((asset) => {
      if (definition.key === "all") return true;
      if (definition.key === "jj") return asset.market === "jj";
      if (definition.key === "fund") return asset.kind === "fund" && asset.market !== "jj";
      return asset.kind === "stock";
    });
    return { ...definition, count: assets.length };
  });
});
const activeClassLabel = computed(
  () => assetClassTabs.value.find((item) => item.key === assetClassFilter.value)?.label ?? "全部",
);
const emptyTitle = computed(() => {
  if (activeGroup.value) {
    return assetClassFilter.value === "all"
      ? `「${activeGroup.value.name}」暂无标的`
      : `「${activeGroup.value.name}」暂无${activeClassLabel.value}`;
  }
  return assetClassFilter.value === "all"
    ? "自选还是空的"
    : `自选里没有${activeClassLabel.value}`;
});
const emptyDescription = computed(() => {
  if (assetClassFilter.value !== "all") {
    return `切换到全部品类，或添加新的${activeClassLabel.value}标的。`;
  }
  return activeGroup.value
    ? "可从全部自选中选择标的，或直接向这个分组添加新的股票、ETF 与基金。"
    : "添加股票、ETF 或场外基金，首页会汇总价格、涨跌与提醒状态。";
});

const groupSummaries = computed(() => {
  const groups = [
    { id: null, name: "全部", symbols: state.watchlist },
    ...state.watchlistGroups,
  ];
  return groups.map((group) => {
    const changes = group.symbols
      .map((symbol) => quoteFor(symbol)?.changePct)
      .filter((value): value is number => value != null && Number.isFinite(value));
    return {
      ...group,
      count: group.symbols.length,
      change: changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : null,
    };
  });
});

const visibleAssets = computed(() => {
  const assets = activeAssets.value.filter((asset) => {
    if (assetClassFilter.value === "all") return true;
    if (assetClassFilter.value === "jj") return asset.market === "jj";
    if (assetClassFilter.value === "fund") return asset.kind === "fund" && asset.market !== "jj";
    return asset.kind === "stock";
  });
  if (state.settings.watchlistSort === "default") return assets;
  const metric = (symbol: string, key: "price" | "changePct" | "volume") => {
    const value = quoteFor(symbol)?.[key];
    return value == null || !Number.isFinite(value) ? Number.NEGATIVE_INFINITY : value;
  };
  const sorted = [...assets];
  sorted.sort((a, b) => {
    if (state.settings.watchlistSort === "alertFirst") {
      const priority = (symbol: string) => {
        const alert = rowAlertState(symbol);
        return alert.unreadCount * 100 + alert.triggeredCount * 10 + (alert.ruleCount ? 1 : 0);
      };
      return priority(b.symbol) - priority(a.symbol);
    }
    if (state.settings.watchlistSort === "changeDesc") return metric(b.symbol, "changePct") - metric(a.symbol, "changePct");
    if (state.settings.watchlistSort === "changeAsc") return metric(a.symbol, "changePct") - metric(b.symbol, "changePct");
    if (state.settings.watchlistSort === "priceDesc") return metric(b.symbol, "price") - metric(a.symbol, "price");
    if (state.settings.watchlistSort === "priceAsc") return metric(a.symbol, "price") - metric(b.symbol, "price");
    return metric(b.symbol, "volume") - metric(a.symbol, "volume");
  });
  return sorted;
});

const detailAsset = computed(
  () => visibleAssets.value.find((asset) => asset.symbol === state.selectedSymbol) ?? visibleAssets.value[0] ?? null,
);

const quote = computed(() => (detailAsset.value ? quoteFor(detailAsset.value.symbol) : undefined));
const digits = computed(() =>
  detailAsset.value ? priceDigits(detailAsset.value.kind, quote.value?.price ?? null) : 2,
);
const inWatchlist = computed(
  () => Boolean(detailAsset.value && state.watchlist.includes(detailAsset.value.symbol)),
);
const relatedAlerts = computed(() =>
  detailAsset.value ? state.alerts.filter((alert) => alert.symbol === detailAsset.value?.symbol) : [],
);
const rowAlertStates = computed(() => {
  const summaries = new Map<
    string,
    { ruleCount: number; triggeredCount: number; unreadCount: number }
  >();
  for (const symbol of state.watchlist) {
    const rules = state.alerts.filter((rule) => rule.symbol === symbol && rule.enabled);
    summaries.set(symbol, {
      ruleCount: rules.length,
      triggeredCount: rules.filter((rule) => isTriggered(rule, quoteFor(symbol))).length,
      unreadCount: state.events.filter((event) => event.symbol === symbol && !event.read).length,
    });
  }
  return summaries;
});
const chartLevels = computed(() => priceAlertLevels(relatedAlerts.value, quote.value));
const visibleChartLevels = computed(() =>
  visiblePriceAlertLevels(trend.value, chartLevels.value),
);
const hiddenChartLevelCount = computed(() => Math.max(0, chartLevels.value.length - visibleChartLevels.value.length));
const detailSignal = computed(() => intradaySignal(quote.value));
const rowSignals = computed(() => {
  const signals = new Map<string, NonNullable<ReturnType<typeof intradaySignal>>>();
  for (const symbol of state.watchlist) {
    const signal = intradaySignal(quoteFor(symbol));
    if (signal) signals.set(symbol, signal);
  }
  return signals;
});
const quickAsset = computed(() => (quickSymbol.value ? watchlistAssets.value.find((asset) => asset.symbol === quickSymbol.value) : null));
const rangeLoading = computed(() => trendLoading.value && !trend.value.length);
const heatmapTiles = computed(() => {
  const amounts = visibleAssets.value.map((asset) => {
    const amount = quoteFor(asset.symbol)?.amount;
    return amount != null && Number.isFinite(amount) ? amount : 0;
  });
  const maxAmount = Math.max(...amounts, 1);
  return visibleAssets.value.map((asset, index) => {
    const current = quoteFor(asset.symbol);
    const changePct = current?.changePct ?? 0;
    return {
      asset,
      quote: current,
      large: amounts[index] / maxAmount >= 0.55,
      tone: toneOf(changePct),
      strength: `${Math.round(8 + Math.min(1, Math.abs(changePct) / 5) * 22)}%`,
    };
  });
});

function rowAlertState(symbol: string) {
  return rowAlertStates.value.get(symbol) ?? { ruleCount: 0, triggeredCount: 0, unreadCount: 0 };
}

function openComparison() {
  compareOpen.value = true;
}

function closeComparison() {
  compareOpen.value = false;
  void nextTick(() => compareTrigger.value?.focus());
}

function openStockAi() {
  stockAiOpen.value = true;
}

function closeStockAi() {
  stockAiOpen.value = false;
  void nextTick(() => stockAiTrigger.value?.focus());
}

function inspectStockAiCandidate(symbol: string) {
  const asset = visibleAssets.value.find((item) => item.symbol === symbol);
  stockAiOpen.value = false;
  if (asset) selectRow(asset);
}

function rowAlertLabel(symbol: string) {
  const summary = rowAlertState(symbol);
  if (!summary.ruleCount) return "";
  const triggered =
    summary.triggeredCount > 0 ? `，${summary.triggeredCount} 条当前满足条件` : "";
  const unread = summary.unreadCount > 0 ? `，${summary.unreadCount} 条未读触发` : "";
  return `${summary.ruleCount} 条提醒${triggered}${unread}`;
}

function rowRange(asset: Asset) {
  const current = quoteFor(asset.symbol);
  if (
    !current ||
    current.price == null ||
    current.high == null ||
    current.low == null ||
    !Number.isFinite(current.price) ||
    !Number.isFinite(current.high) ||
    !Number.isFinite(current.low)
  ) {
    return null;
  }
  const span = current.high - current.low;
  if (!Number.isFinite(span) || span <= 0) return null;
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  const startValue = current.open ?? current.previousClose ?? current.low;
  const start = clamp(((startValue - current.low) / span) * 100);
  const end = clamp(((current.price - current.low) / span) * 100);
  return {
    left: Math.min(start, end),
    width: Math.max(1.5, Math.abs(end - start)),
    position: end,
    low: current.low,
    high: current.high,
  };
}

function rowRangeStyle(asset: Asset) {
  const range = rowRange(asset);
  if (!range) return {};
  return {
    "--range-left": `${range.left}%`,
    "--range-width": `${range.width}%`,
    "--range-position": `${range.position}%`,
  };
}

function rowRangeLabel(asset: Asset) {
  const range = rowRange(asset);
  const current = quoteFor(asset.symbol);
  if (!range || !current) return "";
  return `${asset.name}，日内区间 ${formatPrice(range.low, priceDigits(asset.kind, range.low))} 至 ${formatPrice(
    range.high,
    priceDigits(asset.kind, range.high),
  )}，现价 ${formatPrice(current.price, priceDigits(asset.kind, current.price))}`;
}

function openChartLevel(level: PriceAlertLevel) {
  const rule = state.alerts.find((item) => item.id === level.ruleId);
  if (rule) openAlertDialog(rule.symbol, rule);
}

function rowSignal(symbol: string) {
  return rowSignals.value.get(symbol);
}

const stats = computed(() => {
  const asset = detailAsset.value;
  const current = quote.value;
  if (!asset || !current) return [];
  if (asset.market === "jj") {
    return [
      { label: "单位净值", value: formatPrice(current.price, digits.value) },
      { label: "日涨跌", value: `${formatPercent(current.changePct)} ${directionMark(current.changePct)}` },
      { label: "昨净值", value: formatPrice(current.previousClose, digits.value) },
      { label: "净值日期", value: current.navDate ?? "--" },
      { label: "标的类型", value: asset.typeLabel },
      { label: "数据来源", value: current.source },
    ];
  }
  return [
    { label: "今开", value: formatPrice(current.open, digits.value) },
    { label: "最高", value: formatPrice(current.high, digits.value) },
    { label: "最低", value: formatPrice(current.low, digits.value) },
    { label: "昨收", value: formatPrice(current.previousClose, digits.value) },
    { label: "成交量", value: formatVolume(current.volume) },
    { label: "成交额", value: formatCompactMoney(current.amount) },
  ];
});

const chartTone = computed(() => {
  if (!quote.value) return "flat" as const;
  return toneOf(quote.value.changePct);
});

const rangeLabel = computed(() => ranges.find((range) => range.key === state.detailRange)?.label ?? "近期");
const chartSummary = computed(() => {
  if (!trend.value.length) return `${rangeLabel.value}价格走势`;
  const first = trend.value[0]?.value;
  const last = trend.value[trend.value.length - 1]?.value;
  const values = trend.value.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const change = first ? ((last - first) / first) * 100 : 0;
  const amplitude = min ? ((max - min) / min) * 100 : 0;
  return `${rangeLabel.value} · 区间 ${formatPercent(change)} ${directionMark(change)} · 振幅 ${amplitude.toFixed(2)}%`;
});

async function loadTrend() {
  const asset = detailAsset.value;
  if (!asset) {
    trend.value = [];
    return;
  }
  const token = ++requestToken;
  trendLoading.value = true;
  const points = await fetchTrend(asset, state.detailRange);
  if (token !== requestToken) return;
  trend.value = points;
  trendLoading.value = false;
}

watch(
  () => [detailAsset.value?.symbol, state.detailRange],
  () => {
    void loadTrend();
  },
  { immediate: true },
);

watch(
  () => state.quotes,
  () => {
    if (detailAsset.value && !quote.value) void loadTrend();
  },
  { deep: true },
);

watch(
  () => Object.fromEntries(Object.entries(state.quotes).map(([symbol, item]) => [symbol, item.price])),
  (prices) => {
    for (const symbol of state.watchlist) {
      const price = prices[symbol];
      if (price == null || !Number.isFinite(price)) continue;
      const previous = lastPrices.get(symbol);
      if (previous != null && price !== previous) {
        const tone = price > previous ? "up" : "down";
        tickFlashes.value = {
          ...tickFlashes.value,
          [symbol]: { tone, token: ++flashToken },
        };
        window.clearTimeout(flashTimers.get(symbol));
        flashTimers.set(
          symbol,
          window.setTimeout(() => {
            const next = { ...tickFlashes.value };
            delete next[symbol];
            tickFlashes.value = next;
            flashTimers.delete(symbol);
          }, 320),
        );
      }
      lastPrices.set(symbol, price);
    }
  },
  { immediate: true },
);

function setRange(range: TrendRange) {
  state.detailRange = range;
}

function selectGroup(id: string | null) {
  setActiveWatchlistGroup(id);
  const group = state.watchlistGroups.find((item) => item.id === id);
  const symbols = group?.symbols ?? state.watchlist;
  if (state.selectedSymbol && symbols.includes(state.selectedSymbol)) return;
  const next = symbols[0];
  if (next) {
    selectAsset(next);
    void nextTick(() => rowButtons.get(next)?.focus());
  }
}

function selectAssetClass(filter: "all" | "stock" | "fund" | "jj") {
  assetClassFilter.value = filter;
  const next =
    visibleAssets.value.find((asset) => asset.symbol === state.selectedSymbol) ??
    visibleAssets.value[0];
  if (next && next.symbol !== state.selectedSymbol) selectAsset(next.symbol);
}

function onSortChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as WatchlistSort;
  if (sortOptions.some((option) => option.value === value)) {
    updateSettings({ watchlistSort: value });
  }
}

function openCreateGroup() {
  editingGroupId.value = null;
  groupName.value = "";
  groupDeleteArmed.value = false;
  groupEditorOpen.value = true;
  void nextTick(() => groupNameEl.value?.focus());
}

function openRenameGroup() {
  if (!activeGroup.value) return;
  editingGroupId.value = activeGroup.value.id;
  groupName.value = activeGroup.value.name;
  groupDeleteArmed.value = false;
  groupEditorOpen.value = true;
  void nextTick(() => groupNameEl.value?.focus());
}

function closeGroupEditor() {
  groupEditorOpen.value = false;
  editingGroupId.value = null;
  groupName.value = "";
  groupDeleteArmed.value = false;
  window.clearTimeout(groupDeleteTimer);
}

function saveGroup() {
  if (editingGroupId.value) {
    if (renameWatchlistGroup(editingGroupId.value, groupName.value)) closeGroupEditor();
    return;
  }
  if (createWatchlistGroup(groupName.value)) closeGroupEditor();
}

function requestDeleteGroup() {
  if (!editingGroupId.value) return;
  window.clearTimeout(groupDeleteTimer);
  if (groupDeleteArmed.value) {
    deleteWatchlistGroup(editingGroupId.value);
    closeGroupEditor();
    return;
  }
  groupDeleteArmed.value = true;
  groupDeleteTimer = window.setTimeout(() => {
    groupDeleteArmed.value = false;
  }, 4000);
}

function selectRow(asset: Asset) {
  if (suppressRowClick) {
    suppressRowClick = false;
    return;
  }
  selectAsset(asset.symbol);
  if (mobileViewport.value) {
    detailSheetTrigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : rowButtons.get(asset.symbol) ?? null;
    detailSheetOpen.value = true;
    document.documentElement.classList.add("detail-sheet-open");
    void nextTick(() => detailSheetClose.value?.focus());
  }
}

function selectBriefAsset(symbol: string) {
  const asset = visibleAssets.value.find((item) => item.symbol === symbol);
  if (asset) selectRow(asset);
}

function closeDetailSheet() {
  detailSheetOpen.value = false;
  document.documentElement.classList.remove("detail-sheet-open");
  void nextTick(() => {
    detailSheetTrigger?.focus();
    detailSheetTrigger = null;
  });
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && detailSheetOpen.value) closeDetailSheet();
}

function syncMobileViewport(event: MediaQueryListEvent | MediaQueryList) {
  mobileViewport.value = event.matches;
  if (!event.matches && detailSheetOpen.value) closeDetailSheet();
}

function tickFlashClass(symbol: string) {
  const flash = tickFlashes.value[symbol];
  return flash ? `tick-${flash.tone}` : "";
}

function tickFlashToken(symbol: string) {
  return tickFlashes.value[symbol]?.token ?? 0;
}

function removeWatchAsset(symbol: string) {
  removeFromWatchlist(symbol);
  void nextTick(() => {
    const next = visibleAssets.value[0];
    if (next) selectAsset(next.symbol);
  });
}

function openQuickActions(symbol: string) {
  quickSymbol.value = symbol;
  void nextTick(() => quickPrimary.value?.focus());
}

function closeQuickActions() {
  quickSymbol.value = null;
  suppressRowClick = false;
}

function startLongPress(event: PointerEvent, symbol: string) {
  if (event.pointerType === "mouse") return;
  window.clearTimeout(longPressTimer);
  longPressTimer = window.setTimeout(() => {
    suppressRowClick = true;
    openQuickActions(symbol);
  }, 480);
}

function cancelLongPress() {
  window.clearTimeout(longPressTimer);
}

function isQuickInGroup(groupId: string) {
  return Boolean(
    quickSymbol.value &&
      state.watchlistGroups.find((group) => group.id === groupId)?.symbols.includes(quickSymbol.value),
  );
}

function setRowButton(symbol: string, element: unknown) {
  if (element instanceof HTMLButtonElement) rowButtons.set(symbol, element);
  else rowButtons.delete(symbol);
}

function moveRowFocus(symbol: string, step: -1 | 1) {
  const items = visibleAssets.value;
  if (!items.length) return;
  const index = items.findIndex((item) => item.symbol === symbol);
  const next = items[(index + step + items.length) % items.length];
  selectAsset(next.symbol);
  void nextTick(() => rowButtons.get(next.symbol)?.focus());
}

function onRowKeydown(event: KeyboardEvent, symbol: string) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveRowFocus(symbol, event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (
    event.key.toLowerCase() === "r" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    event.preventDefault();
    openAlertDialog(symbol);
    return;
  }
  if (
    event.key.toLowerCase() === "g" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    event.preventDefault();
    openQuickActions(symbol);
  }
}

function toggleWatch() {
  const asset = detailAsset.value;
  if (!asset) return;
  if (inWatchlist.value) {
    removeFromWatchlist(asset.symbol);
  } else {
    addToWatchlist({
      symbol: asset.symbol,
      code: asset.code,
      name: asset.name,
      kind: asset.kind,
      market: asset.market,
      typeLabel: asset.typeLabel,
    });
  }
}

function stateLabel(symbol: string) {
  const current = quoteFor(symbol);
  if (!current) return "等待";
  if (state.marketFromCache) return "缓存";
  if (current.state === "nav") return "净值";
  if (current.state === "close") return "收盘";
  if (current.state === "demo") return marketPhase() === "交易中" ? "示例" : "收盘";
  return "实时";
}

onBeforeUnmount(() => {
  window.clearInterval(healthTimer);
  window.clearTimeout(longPressTimer);
  window.clearTimeout(groupDeleteTimer);
  for (const timer of flashTimers.values()) window.clearTimeout(timer);
  window.removeEventListener("keydown", onWindowKeydown);
  mobileMedia?.removeEventListener("change", syncMobileViewport);
  document.documentElement.classList.remove("detail-sheet-open");
});

onMounted(() => {
  mobileMedia = window.matchMedia("(max-width: 720px)");
  syncMobileViewport(mobileMedia);
  mobileMedia.addEventListener("change", syncMobileViewport);
  window.addEventListener("keydown", onWindowKeydown);
});
</script>

<template>
  <section class="view-page view-watchlist">
    <div class="view-head">
      <div>
        <p class="eyebrow">Watchlist</p>
        <h1>自选观察</h1>
        <p class="view-sub">
          <span>{{ visibleAssets.length }} 只标的</span>
          <i class="sub-dot" />
          <span>行情缓存于本机</span>
          <i class="sub-dot" />
          <span>{{ state.settings.refreshSeconds }} 秒自动刷新</span>
        </p>
      </div>
      <div class="view-actions">
        <button class="btn" type="button" @click="state.searchOpen = true">
          <Search :size="14" />
          搜索标的
        </button>
        <button class="btn btn-primary" type="button" @click="state.searchOpen = true">
          <Plus :size="14" />
          添加自选
        </button>
      </div>
    </div>

    <MarketBrief
      v-if="visibleAssets.length"
      :assets="visibleAssets"
      :data-delayed="dataDelayed"
      @select="selectBriefAsset"
      @show-alerts="setView('alerts')"
      @create-alert="openAlertDialog"
      @refresh="refreshAll"
    />

    <section v-if="state.indices.length" class="market-index-deck" aria-labelledby="market-index-title">
      <div class="market-index-head">
        <h2 id="market-index-title">市场指数</h2>
        <span>A股 · {{ state.indices.length }} 项</span>
      </div>
      <div class="market-index-rail">
        <article
          v-for="index in state.indices"
          :key="index.symbol"
          class="market-index-card"
        >
          <div class="market-index-meta">
            <span>A股 · <i class="mono">{{ index.symbol.slice(-6) }}</i></span>
            <span class="market-change-pill" :class="toneOf(index.changePct)">
              {{ formatPercent(index.changePct) }}
              <i class="trend-mark" aria-hidden="true">{{ directionMark(index.changePct) }}</i>
            </span>
          </div>
          <strong>{{ index.name }}</strong>
          <div class="market-index-values">
            <b>{{ formatPrice(index.price, 2) }}</b>
          </div>
        </article>
      </div>
    </section>

    <div class="watch-layout" :class="{ 'is-stale': dataDelayed }">
      <div class="panel watch-list" :inert="detailSheetOpen || undefined">
        <div v-if="state.watchlistGroups.length" class="watch-groups">
          <div class="watch-group-tabs" role="tablist" aria-label="自选分组">
            <button
              v-for="group in groupSummaries"
              :key="group.id ?? 'all'"
              type="button"
              role="tab"
              :class="{ active: state.activeWatchlistGroupId === group.id }"
              :aria-selected="state.activeWatchlistGroupId === group.id"
              :aria-label="`${group.name}，${group.count} 只标的，等权平均涨跌 ${group.change == null ? '暂无' : formatPercent(group.change)}`"
              @click="selectGroup(group.id)"
            >
              <span>{{ group.name }}</span>
              <small :class="toneOf(group.change)">
                {{ group.change == null ? "--" : formatPercent(group.change) }}
                <i v-if="group.change != null" class="trend-mark" aria-hidden="true">{{ directionMark(group.change) }}</i>
              </small>
            </button>
          </div>
          <div class="watch-group-tools">
            <button type="button" title="新建分组" aria-label="新建自选分组" @click="openCreateGroup">
              <Plus :size="13" />
            </button>
            <button
              v-if="activeGroup"
              type="button"
              title="管理当前分组"
              aria-label="管理当前分组"
              @click="openRenameGroup"
            >
              <Pencil :size="12" />
            </button>
          </div>
        </div>
        <form v-if="groupEditorOpen" class="group-editor" @submit.prevent="saveGroup">
          <input
            ref="groupNameEl"
            v-model="groupName"
            maxlength="20"
            autocomplete="off"
            :placeholder="editingGroupId ? '分组名称' : '例如：科技 / 消费 / 持仓'"
            aria-label="分组名称"
            @keydown.esc="closeGroupEditor"
          />
          <button class="btn btn-small btn-gold" type="submit">{{ editingGroupId ? "保存" : "创建" }}</button>
          <button
            v-if="editingGroupId"
            class="mini-icon danger"
            type="button"
            :title="groupDeleteArmed ? '再次点击确认删除' : '删除分组'"
            :aria-label="groupDeleteArmed ? '确认删除分组' : '删除分组'"
            @click="requestDeleteGroup"
          >
            <Trash2 :size="13" />
          </button>
          <button class="mini-icon" type="button" aria-label="关闭分组编辑" @click="closeGroupEditor">
            <X :size="13" />
          </button>
        </form>
        <div class="asset-class-tabs" role="tablist" aria-label="标的类型">
          <button
            v-for="item in assetClassTabs"
            :key="item.key"
            type="button"
            role="tab"
            :class="{ active: assetClassFilter === item.key }"
            :aria-selected="assetClassFilter === item.key"
            @click="selectAssetClass(item.key)"
          >
            <span>{{ item.label }}</span>
            <small>{{ item.count }}</small>
          </button>
        </div>
        <div class="list-head">
          <span class="list-head-copy">
            <span class="eyebrow">自选行情</span>
            <span class="muted mono">{{ visibleAssets.length }}</span>
          </span>
          <div class="list-head-tools">
            <span v-if="dataDelayed" class="list-delay">数据延迟</span>
            <span class="list-keyboard-hint">↑↓ 切换 · R 提醒 · G 更多</span>
            <button
              v-if="!state.watchlistGroups.length"
              class="watch-view-toggle"
              type="button"
              title="新建自选分组"
              aria-label="新建自选分组"
              @click="openCreateGroup"
            >
              <FolderPlus :size="13" />
            </button>
            <button
              ref="stockAiTrigger"
              class="watch-view-toggle stock-ai-trigger"
              type="button"
              :disabled="!visibleAssets.some((asset) => asset.kind === 'stock')"
              :title="visibleAssets.some((asset) => asset.kind === 'stock') ? 'AI 选股研判' : '自选池暂无 A 股'"
              aria-label="打开 AI 选股研判"
              @click="openStockAi"
            >
              <Sparkles :size="13" />
            </button>
            <button
              ref="compareTrigger"
              class="watch-view-toggle"
              type="button"
              :disabled="visibleAssets.length < 2"
              :title="visibleAssets.length < 2 ? '至少选择两只标的进行对比' : '多标的对比'"
              aria-label="打开多标的对比"
              @click="openComparison"
            >
              <GitCompareArrows :size="13" />
            </button>
            <button
              class="watch-view-toggle"
              type="button"
              :title="watchMode === 'list' ? '切换热力图' : '切换列表'"
              :aria-label="watchMode === 'list' ? '切换自选热力图' : '切换自选列表'"
              :aria-pressed="watchMode === 'heatmap'"
              @click="watchMode = watchMode === 'list' ? 'heatmap' : 'list'"
            >
              <LayoutGrid v-if="watchMode === 'list'" :size="13" />
              <List v-else :size="13" />
            </button>
            <select
              class="watch-sort"
              :value="state.settings.watchlistSort"
              aria-label="自选排序"
              @change="onSortChange"
            >
              <option v-for="option in sortOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </div>
        </div>
        <div v-if="!visibleAssets.length" class="empty list-empty">
          <Star :size="22" :stroke-width="1.5" />
          <strong>{{ emptyTitle }}</strong>
          <p>{{ emptyDescription }}</p>
          <span class="empty-actions">
            <button
              v-if="assetClassFilter !== 'all'"
              class="btn"
              type="button"
              @click="selectAssetClass('all')"
            >
              查看全部品类
            </button>
            <button v-if="activeGroup" class="btn" type="button" @click="selectGroup(null)">浏览全部</button>
            <button class="btn btn-gold" type="button" @click="state.searchOpen = true">添加标的</button>
          </span>
        </div>
        <template v-if="watchMode === 'list'">
          <div
            v-for="asset in visibleAssets"
            :key="asset.symbol"
            class="list-row"
            :class="{ active: detailAsset?.symbol === asset.symbol }"
            @contextmenu.prevent="openQuickActions(asset.symbol)"
          >
            <button
              :ref="(element) => setRowButton(asset.symbol, element)"
              class="list-row-select"
              :class="{ 'has-range': Boolean(rowRange(asset)) }"
              type="button"
              :aria-current="detailAsset?.symbol === asset.symbol ? 'true' : undefined"
              @click="selectRow(asset)"
              @keydown="onRowKeydown($event, asset.symbol)"
              @pointerdown="startLongPress($event, asset.symbol)"
              @pointerup="cancelLongPress"
              @pointercancel="cancelLongPress"
              @pointerleave="cancelLongPress"
              @pointermove="cancelLongPress"
            >
              <span class="row-main">
                <span class="row-name">
                  <span class="row-name-text">{{ asset.name }}</span>
                  <span class="chip">{{ asset.typeLabel }}</span>
                </span>
                <span class="row-meta">
                  <span class="mono">{{ asset.code }}</span>
                  <span class="row-state-label">{{ stateLabel(asset.symbol) }}</span>
                  <span
                    v-if="rowSignal(asset.symbol)"
                    class="row-signal-dot"
                    :class="rowSignal(asset.symbol)?.tone"
                    :title="rowSignal(asset.symbol)?.label"
                    :aria-label="rowSignal(asset.symbol)?.label"
                  />
                  <span
                    v-if="rowAlertState(asset.symbol).ruleCount"
                    class="row-alert-status"
                    :class="{
                      hot: rowAlertState(asset.symbol).triggeredCount > 0,
                      unread: rowAlertState(asset.symbol).unreadCount > 0,
                    }"
                    :title="rowAlertLabel(asset.symbol)"
                    :aria-label="rowAlertLabel(asset.symbol)"
                    role="status"
                  >
                    <BellRing :size="10" aria-hidden="true" />
                    <span aria-hidden="true">
                      {{
                        rowAlertState(asset.symbol).unreadCount ||
                        rowAlertState(asset.symbol).ruleCount
                      }}
                    </span>
                  </span>
                </span>
              </span>
              <span
                v-if="rowRange(asset)"
                class="row-range"
                :class="toneOf(quoteFor(asset.symbol)?.changePct)"
                :style="rowRangeStyle(asset)"
                role="img"
                :aria-label="rowRangeLabel(asset)"
              >
                <span class="row-range-track" aria-hidden="true">
                  <i class="row-range-fill" />
                  <i class="row-range-marker" />
                </span>
              </span>
              <span class="row-price">
                <strong
                  :key="tickFlashToken(asset.symbol)"
                  :class="[toneOf(quoteFor(asset.symbol)?.changePct), tickFlashClass(asset.symbol)]"
                >
                  {{ formatPrice(quoteFor(asset.symbol)?.price, priceDigits(asset.kind, quoteFor(asset.symbol)?.price)) }}
                </strong>
                <span class="market-change-pill row-change-pill" :class="toneOf(quoteFor(asset.symbol)?.changePct)">
                  {{ formatPercent(quoteFor(asset.symbol)?.changePct) }}
                  <i class="trend-mark" aria-hidden="true">{{ directionMark(quoteFor(asset.symbol)?.changePct) }}</i>
                </span>
              </span>
            </button>
            <span class="watch-row-tools">
              <button
                class="watch-row-tool"
                type="button"
                title="更多操作"
                :aria-label="`${asset.name} 的更多操作`"
                @click="openQuickActions(asset.symbol)"
              >
                <MoreHorizontal :size="14" />
              </button>
              <button
                class="watch-row-tool"
                type="button"
                title="设置提醒"
                :aria-label="`为 ${asset.name} 设置提醒`"
                @click="openAlertDialog(asset.symbol)"
              >
                <BellPlus :size="13" />
              </button>
            </span>
          </div>
        </template>
        <div v-else class="watch-heatmap-shell">
          <div class="watch-heatmap" role="group" aria-label="自选池热力图">
            <button
              v-for="tile in heatmapTiles"
              :key="tile.asset.symbol"
              class="heatmap-tile"
              :class="[`heat-${tile.tone}`, { large: tile.large }]"
              :style="{ '--heat-strength': tile.strength }"
              type="button"
              :title="`${tile.asset.name} ${formatPercent(tile.quote?.changePct)}`"
              :aria-label="`${tile.asset.name}，${formatPercent(tile.quote?.changePct)}，点击查看详情`"
              @click="selectRow(tile.asset)"
            >
              <span class="heatmap-code mono">{{ tile.asset.code }}</span>
              <strong :class="toneOf(tile.quote?.changePct)">
                {{ formatPercent(tile.quote?.changePct) }}
                <i class="trend-mark" aria-hidden="true">{{ directionMark(tile.quote?.changePct) }}</i>
              </strong>
              <span class="heatmap-name">{{ tile.asset.name }}</span>
            </button>
          </div>
          <p class="heatmap-caption">面积按今日成交额分层，颜色映射涨跌幅</p>
        </div>
      </div>

      <p class="mobile-list-hint">轻点标的，查看走势与提醒</p>

      <Transition name="detail-backdrop">
        <div
          v-if="detailSheetOpen"
          class="mobile-detail-backdrop"
          aria-hidden="true"
          @click="closeDetailSheet"
        />
      </Transition>

      <div
        v-if="detailAsset"
        class="panel detail"
        :class="{ 'sheet-open': detailSheetOpen }"
        :role="detailSheetOpen && mobileViewport ? 'dialog' : undefined"
        :aria-modal="detailSheetOpen && mobileViewport ? 'true' : undefined"
        :aria-label="detailSheetOpen && mobileViewport ? `${detailAsset.name} 详情` : undefined"
      >
        <div class="mobile-sheet-handle">
          <span aria-hidden="true" />
          <button
            ref="detailSheetClose"
            class="icon-btn"
            type="button"
            aria-label="收起详情"
            @click="closeDetailSheet"
          >
            <X :size="16" />
          </button>
        </div>
        <div class="detail-head">
          <div class="detail-title">
            <p class="eyebrow">{{ detailAsset.market === "jj" ? "Fund" : "Security" }}</p>
            <h2>{{ detailAsset.name }}</h2>
            <div class="detail-tags">
              <span class="chip mono">{{ detailAsset.code }}</span>
              <span class="chip">{{ detailAsset.typeLabel }}</span>
              <span v-if="quote" class="chip" :class="quote.state === 'demo' ? 'chip-gold' : 'chip-live'">
                <i class="dot" />
                {{ quote.source }}
              </span>
            </div>
          </div>
          <div class="detail-actions">
            <button class="icon-btn" type="button" :title="inWatchlist ? '移出自选' : '加入自选'" @click="toggleWatch">
              <Star :size="16" :fill="inWatchlist ? 'currentColor' : 'none'" />
            </button>
            <button class="btn" type="button" @click="openAlertDialog(detailAsset.symbol)">
              <BellPlus :size="14" />
              设置提醒
            </button>
          </div>
        </div>

        <div class="price-block">
          <strong
            :key="detailAsset ? tickFlashToken(detailAsset.symbol) : 0"
            class="price-main"
            :class="[toneOf(quote?.changePct), detailAsset ? tickFlashClass(detailAsset.symbol) : '']"
          >
            {{ formatPrice(quote?.price, digits) }}
          </strong>
          <div class="price-change" :class="toneOf(quote?.changePct)">
            <span>{{ formatSigned(quote?.change, digits) }}</span>
            <span>
              {{ formatPercent(quote?.changePct) }}
              <i class="trend-mark" aria-hidden="true">{{ directionMark(quote?.changePct) }}</i>
            </span>
          </div>
          <div class="price-meta">
            <span>{{ quote?.state === "nav" ? "净值日期" : "行情时间" }}</span>
            <strong class="mono">{{ quote?.state === "nav" ? quote?.navDate ?? "--" : quote?.updatedAt?.replace("T", " ") ?? "--" }}</strong>
          </div>
        </div>

        <div v-if="detailSignal" class="detail-signal" :class="detailSignal.tone">
          <span class="detail-signal-dot" aria-hidden="true" />
          <span>{{ detailSignal.label }}</span>
        </div>

        <div class="stat-grid">
          <div v-for="item in stats" :key="item.label" class="stat">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>

        <div class="chart-block">
          <div class="chart-head">
            <div class="chart-heading">
              <h3>走势</h3>
              <p>{{ chartSummary }}</p>
            </div>
            <div class="chart-controls">
              <div class="segmented range-tabs">
                <button
                  v-for="range in ranges"
                  :key="range.key"
                  type="button"
                  :class="{ active: state.detailRange === range.key }"
                  @click="setRange(range.key)"
                >
                  {{ range.label }}
                </button>
              </div>
              <button
                class="btn btn-small btn-ghost chart-table-toggle"
                type="button"
                :aria-pressed="showChartTable"
                @click="showChartTable = !showChartTable"
              >
                {{ showChartTable ? "查看图表" : "查看数据表" }}
              </button>
            </div>
          </div>
          <div
            v-if="!showChartTable && visibleChartLevels.length"
            class="chart-level-legend"
            aria-label="图表中的价格提醒"
          >
            <button
              v-for="level in visibleChartLevels"
              :key="level.id"
              class="chart-level-chip"
              :class="[`is-${level.tone}`, { triggered: level.triggered }]"
              type="button"
              :aria-label="`${level.label} ${formatPrice(level.threshold, digits)}，${level.triggered ? '当前已满足条件' : '监控中'}，点击编辑提醒`"
              @click="openChartLevel(level)"
            >
              <i aria-hidden="true" />
              <span>{{ level.label }}</span>
              <strong class="mono">{{ formatPrice(level.threshold, digits) }}</strong>
            </button>
            <span v-if="hiddenChartLevelCount" class="chart-level-more">
              另有 {{ hiddenChartLevelCount }} 条
            </span>
          </div>
          <TrendChart
            v-if="!showChartTable"
            :points="trend"
            :loading="rangeLoading"
            :tone="chartTone"
            :digits="digits"
            :label="`${detailAsset.name} ${chartSummary}`"
            :levels="visibleChartLevels"
          />
          <div v-else class="chart-table-shell">
            <div v-if="rangeLoading" class="chart-table-empty">正在加载{{ rangeLabel }}数据…</div>
            <table v-else-if="trend.length" class="chart-table">
              <caption class="sr-only">{{ detailAsset.name }} {{ rangeLabel }}走势数据</caption>
              <thead>
                <tr>
                  <th scope="col">时间 / 日期</th>
                  <th scope="col">价格</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="point in trend" :key="point.label">
                  <th scope="row">{{ point.label }}</th>
                  <td>{{ formatPrice(point.value, digits) }}</td>
                </tr>
              </tbody>
            </table>
            <div v-else class="chart-table-empty">当前区间暂无走势数据</div>
          </div>
        </div>

        <div class="alert-strip">
          <div class="alert-strip-head">
            <span class="eyebrow">Alerts on this symbol</span>
            <button class="btn btn-ghost btn-small" type="button" @click="openAlertDialog(detailAsset.symbol)">
              <Plus :size="12" />
              新建
            </button>
          </div>
          <div v-if="!relatedAlerts.length" class="alert-strip-empty">
            暂无提醒。价格、涨跌幅与成交额可组合检查，触发后记录并推送通知。
          </div>
          <div v-else class="alert-mini-list">
            <button
              v-for="rule in relatedAlerts"
              :key="rule.id"
              class="alert-mini"
              type="button"
              @click="openAlertDialog(rule.symbol, rule)"
            >
              <span class="rule-state" :class="{ hot: isTriggered(rule, quote) }">
                <i class="dot" />
                {{ rule.enabled ? (isTriggered(rule, quote) ? "已触发" : "监控中") : "已暂停" }}
              </span>
              <span>{{ alertRuleSummary(rule) }}</span>
              <strong v-if="alertConditions(rule).length > 1" class="mono">
                {{ alertConditions(rule).length }} 项
              </strong>
            </button>
          </div>
        </div>
      </div>

      <div v-else class="panel empty detail-empty">
        <Star :size="24" :stroke-width="1.4" />
        <strong>{{ activeGroup ? "当前分组暂无标的" : "选择一只标的" }}</strong>
        <p>
          {{
            activeGroup
              ? "从全部自选中为这个分组添加标的，或直接搜索并添加。"
              : "左侧点选自选，查看最新价格、区间走势和提醒状态。"
          }}
        </p>
      </div>
    </div>

    <Transition name="sheet">
      <div v-if="quickSymbol && quickAsset" class="quick-sheet-backdrop" @mousedown.self="closeQuickActions">
        <div
          class="quick-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-sheet-title"
          @keydown.esc="closeQuickActions"
        >
          <div class="quick-sheet-head">
            <div>
              <span class="eyebrow">Quick actions</span>
              <h2 id="quick-sheet-title">{{ quickAsset.name }}</h2>
              <p>{{ quickAsset.code }} · {{ quickAsset.typeLabel }}</p>
            </div>
            <button class="icon-btn" type="button" aria-label="关闭快速操作" @click="closeQuickActions">
              <X :size="16" />
            </button>
          </div>
          <button
            ref="quickPrimary"
            class="quick-sheet-action"
            type="button"
            @click="openAlertDialog(quickAsset.symbol); closeQuickActions()"
          >
            <BellPlus :size="15" />
            <span>
              <strong>设置提醒</strong>
              <small>价格、涨跌幅或成交额条件</small>
            </span>
          </button>
          <div class="quick-sheet-group">
            <div class="quick-sheet-label">
              <span>加入分组</span>
              <button v-if="!state.watchlistGroups.length" type="button" @click="closeQuickActions(); openCreateGroup()">
                新建分组
              </button>
            </div>
            <div v-if="state.watchlistGroups.length" class="quick-group-list">
              <button
                v-for="group in state.watchlistGroups"
                :key="group.id"
                type="button"
                :class="{ active: isQuickInGroup(group.id) }"
                :aria-pressed="isQuickInGroup(group.id)"
                @click="toggleWatchlistGroupSymbol(group.id, quickAsset.symbol)"
              >
                <Check v-if="isQuickInGroup(group.id)" :size="12" />
                <span>{{ group.name }}</span>
              </button>
            </div>
          </div>
          <button
            class="quick-sheet-action danger"
            type="button"
            @click="removeWatchAsset(quickAsset.symbol); closeQuickActions()"
          >
            <StarOff :size="15" />
            <span>
              <strong>移出自选</strong>
              <small>持仓与提醒记录会保留</small>
            </span>
          </button>
        </div>
      </div>
    </Transition>
    <ComparisonDialog
      v-if="compareOpen"
      :assets="visibleAssets"
      :initial-symbol="detailAsset?.symbol"
      @close="closeComparison"
    />
    <StockAiDialog
      v-if="stockAiOpen"
      :assets="visibleAssets"
      @select="inspectStockAiCandidate"
      @close="closeStockAi"
    />
  </section>
</template>

<style scoped>
.stock-ai-trigger:not(:disabled) {
  border-color: rgba(194, 58, 52, 0.18);
  color: var(--up);
}

.market-index-deck {
  margin: 0 0 var(--space-4);
}

.market-index-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 9px;
  padding: 0 2px;
}

.market-index-head h2 {
  margin: 0;
  color: var(--ink);
  font-size: 15px;
  font-weight: 640;
  letter-spacing: -0.02em;
}

.market-index-head > span {
  color: var(--ink-3);
  font-family: var(--font-data);
  font-size: 9px;
}

.market-index-rail {
  display: grid;
  grid-auto-columns: minmax(138px, 1fr);
  grid-auto-flow: column;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 3px;
  scroll-snap-type: x proximity;
  scrollbar-width: none;
}

.market-index-rail::-webkit-scrollbar {
  display: none;
}

.market-index-card {
  display: grid;
  min-height: 104px;
  min-width: 0;
  overflow: hidden;
  scroll-snap-align: start;
  align-content: space-between;
  gap: 7px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background:
    radial-gradient(140px 90px at 110% -10%, rgba(194, 58, 52, 0.26), transparent 72%),
    linear-gradient(145deg, #191818 0%, #101010 100%);
  box-shadow: 0 16px 30px -28px rgba(0, 0, 0, 0.7);
  color: #f7f3eb;
}

.market-index-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #9f9b93;
  font-size: 8px;
}

.market-index-meta .mono {
  font-style: normal;
  letter-spacing: 0.04em;
}

.market-index-card > strong {
  overflow: hidden;
  color: #f0ece4;
  font-size: 11.5px;
  font-weight: 580;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.market-index-values {
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.market-index-values > b {
  color: #f7f3eb;
  font-family: var(--font-data);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  font-weight: 620;
  letter-spacing: -0.025em;
}

.market-change-pill {
  display: inline-flex;
  flex: none;
  min-height: 22px;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 0 6px;
  border-radius: 999px;
  font-family: var(--font-data);
  font-size: 8.5px;
  font-variant-numeric: tabular-nums;
  font-weight: 650;
  white-space: nowrap;
}

.market-change-pill.up {
  background: #c9342e;
  color: #fff7f3 !important;
}

.market-change-pill.down {
  background: #087a3b;
  color: #f4fff8 !important;
}

.market-change-pill.flat {
  background: #5d5d62;
  color: #ffffff !important;
}

.asset-class-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 3px;
  margin: 1px 2px 10px;
  padding: 4px;
  border: 1px solid rgba(60, 60, 67, 0.08);
  border-radius: 11px;
  background: #efeff2;
}

.asset-class-tabs button {
  display: inline-flex;
  min-width: 0;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 5px;
  border-radius: 8px;
  color: var(--ink-3);
  font-size: 9.5px;
  font-weight: 560;
  white-space: nowrap;
}

.asset-class-tabs button small {
  color: var(--ink-4);
  font-family: var(--font-data);
  font-size: 8px;
  font-variant-numeric: tabular-nums;
}

.asset-class-tabs button.active {
  background: #1d1d1f;
  box-shadow: 0 4px 12px -8px rgba(0, 0, 0, 0.7);
  color: #ffffff;
}

.asset-class-tabs button.active small {
  color: #c7c7cc;
}

.list-row-select {
  grid-template-columns: minmax(0, 1fr) minmax(84px, auto);
  gap: 9px;
}

.list-row-select .row-main {
  grid-column: 1;
}

.list-row-select.has-range {
  grid-template-columns: minmax(0, 1fr) 52px minmax(72px, auto);
}

.row-range {
  grid-column: 2;
  width: 52px;
  min-width: 0;
  color: var(--trend-up);
}

.row-range.down {
  color: var(--trend-down);
}

.row-range.flat {
  color: #8e8e93;
}

.row-range-track {
  position: relative;
  display: block;
  width: 100%;
  height: 3px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(8, 122, 59, 0.2), rgba(215, 0, 21, 0.2));
}

.row-range-fill {
  position: absolute;
  top: 1px;
  left: var(--range-left);
  width: var(--range-width);
  height: 1px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.82;
}

.row-range-marker {
  position: absolute;
  top: 50%;
  left: var(--range-position);
  width: 5px;
  height: 5px;
  border: 1px solid #ffffff;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
  transform: translate(-50%, -50%);
}

.row-price {
  grid-column: 2;
  min-width: 72px;
  gap: 4px;
}

.list-row-select.has-range .row-price {
  grid-column: 3;
}

.row-price strong {
  font-size: 13px;
}

.row-change-pill {
  min-width: 56px;
  min-height: 20px;
  padding: 0 6px;
  font-size: 9px;
}

@media (max-width: 720px) {
  .market-index-deck {
    margin-bottom: var(--space-3);
  }

  .market-index-head {
    margin-bottom: 7px;
  }

  .market-index-head h2 {
    font-size: 13.5px;
  }

  .market-index-rail {
    grid-auto-columns: minmax(136px, 40vw);
    gap: 6px;
  }

  .market-index-card {
    min-height: 84px;
    gap: 5px;
    padding: 9px 10px;
    border-radius: 12px;
  }

  .market-index-card > strong {
    font-size: 10.5px;
  }

  .market-index-values > b {
    font-size: 12.5px;
  }

  .asset-class-tabs button {
    min-height: 36px;
    font-size: 9px;
  }

  .list-row-select {
    grid-template-columns: minmax(0, 1fr) minmax(82px, auto);
    gap: 7px;
    padding-top: 10px;
    padding-bottom: 10px;
  }

  .list-row-select.has-range {
    grid-template-columns: minmax(0, 1fr) 42px minmax(70px, auto);
  }

  .row-range {
    width: 42px;
  }

  .row-price strong {
    font-size: 12.5px;
  }

  .row-change-pill {
    min-width: 54px;
    min-height: 21px;
    font-size: 8.8px;
  }
}

@media (max-width: 360px) {
  .list-row-select {
    grid-template-columns: minmax(0, 1fr) minmax(68px, auto);
  }

  .row-range {
    display: none;
  }

  .list-row-select.has-range .row-price {
    grid-column: 2;
  }
}
</style>
