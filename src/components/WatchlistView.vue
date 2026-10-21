<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { BellPlus, Plus, Search, Star, StarOff } from "lucide-vue-next";
import type { TrendPoint, TrendRange } from "../types";
import {
  addToWatchlist,
  openAlertDialog,
  quoteFor,
  removeFromWatchlist,
  selectAsset,
  selectedAsset,
  state,
  watchlistAssets,
} from "../lib/store";
import { fetchTrend } from "../lib/backend";
import {
  formatCompactMoney,
  formatPercent,
  formatPrice,
  formatSigned,
  formatVolume,
  priceDigits,
  toneOf,
} from "../lib/format";
import { isTriggered } from "../lib/alerts";
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
let requestToken = 0;

const quote = computed(() => (selectedAsset.value ? quoteFor(selectedAsset.value.symbol) : undefined));
const digits = computed(() =>
  selectedAsset.value ? priceDigits(selectedAsset.value.kind, quote.value?.price ?? null) : 2,
);
const inWatchlist = computed(
  () => Boolean(selectedAsset.value && state.watchlist.includes(selectedAsset.value.symbol)),
);
const relatedAlerts = computed(() =>
  selectedAsset.value ? state.alerts.filter((alert) => alert.symbol === selectedAsset.value?.symbol) : [],
);
const rangeLoading = computed(() => trendLoading.value && !trend.value.length);

const stats = computed(() => {
  const asset = selectedAsset.value;
  const current = quote.value;
  if (!asset || !current) return [];
  if (asset.market === "jj") {
    return [
      { label: "单位净值", value: formatPrice(current.price, digits.value) },
      { label: "日涨跌", value: formatPercent(current.changePct) },
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

async function loadTrend() {
  const asset = selectedAsset.value;
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
  () => [selectedAsset.value?.symbol, state.detailRange],
  () => {
    void loadTrend();
  },
  { immediate: true },
);

watch(
  () => state.quotes,
  () => {
    if (selectedAsset.value && !quote.value) void loadTrend();
  },
  { deep: true },
);

function setRange(range: TrendRange) {
  state.detailRange = range;
}

function toggleWatch() {
  const asset = selectedAsset.value;
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
  if (current.state === "nav") return "净值";
  if (current.state === "demo") return "示例";
  return "实时";
}

</script>

<template>
  <section>
    <div class="view-head">
      <div>
        <p class="eyebrow">Watchlist</p>
        <h1>自选观察</h1>
        <p class="view-sub">
          <span>{{ watchlistAssets.length }} 只标的</span>
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

    <div class="watch-layout">
      <div class="panel watch-list">
        <div class="list-head">
          <span class="eyebrow">My list</span>
          <span class="muted mono">{{ watchlistAssets.length }}</span>
        </div>
        <div v-if="!watchlistAssets.length" class="empty list-empty">
          <Star :size="22" :stroke-width="1.5" />
          <strong>自选还是空的</strong>
          <p>添加股票、ETF 或场外基金，首页会汇总价格、涨跌与提醒状态。</p>
          <button class="btn btn-gold" type="button" @click="state.searchOpen = true">添加第一只</button>
        </div>
        <button
          v-for="asset in watchlistAssets"
          :key="asset.symbol"
          class="list-row"
          :class="{ active: state.selectedSymbol === asset.symbol }"
          type="button"
          @click="selectAsset(asset.symbol)"
        >
          <span class="row-main">
            <span class="row-name">
              {{ asset.name }}
              <span class="chip">{{ asset.typeLabel }}</span>
            </span>
            <span class="row-meta">
              <span class="mono">{{ asset.code }}</span>
              <span>{{ stateLabel(asset.symbol) }}</span>
            </span>
          </span>
          <span class="row-price">
            <strong :class="toneOf(quoteFor(asset.symbol)?.changePct)">
              {{ formatPrice(quoteFor(asset.symbol)?.price, priceDigits(asset.kind, quoteFor(asset.symbol)?.price)) }}
            </strong>
            <span :class="toneOf(quoteFor(asset.symbol)?.changePct)">
              {{ formatPercent(quoteFor(asset.symbol)?.changePct) }}
            </span>
          </span>
          <span
            class="row-remove"
            role="button"
            tabindex="0"
            title="移出自选"
            @click.stop="removeFromWatchlist(asset.symbol)"
            @keydown.enter.stop="removeFromWatchlist(asset.symbol)"
          >
            <StarOff :size="13" />
          </span>
        </button>
      </div>

      <div v-if="selectedAsset" class="panel detail">
        <div class="detail-head">
          <div class="detail-title">
            <p class="eyebrow">{{ selectedAsset.market === "jj" ? "Fund" : "Security" }}</p>
            <h2>{{ selectedAsset.name }}</h2>
            <div class="detail-tags">
              <span class="chip mono">{{ selectedAsset.code }}</span>
              <span class="chip">{{ selectedAsset.typeLabel }}</span>
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
            <button class="btn" type="button" @click="openAlertDialog(selectedAsset.symbol)">
              <BellPlus :size="14" />
              设置提醒
            </button>
          </div>
        </div>

        <div class="price-block">
          <strong class="price-main" :class="toneOf(quote?.changePct)">
            {{ formatPrice(quote?.price, digits) }}
          </strong>
          <div class="price-change" :class="toneOf(quote?.changePct)">
            <span>{{ formatSigned(quote?.change, digits) }}</span>
            <span>{{ formatPercent(quote?.changePct) }}</span>
          </div>
          <div class="price-meta">
            <span>{{ quote?.state === "nav" ? "净值日期" : "行情时间" }}</span>
            <strong class="mono">{{ quote?.state === "nav" ? quote?.navDate ?? "--" : quote?.updatedAt?.replace("T", " ") ?? "--" }}</strong>
          </div>
        </div>

        <div class="stat-grid">
          <div v-for="item in stats" :key="item.label" class="stat">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>

        <div class="chart-block">
          <div class="chart-head">
            <h3>走势</h3>
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
          </div>
          <TrendChart :points="trend" :loading="rangeLoading" :tone="chartTone" :digits="digits" />
        </div>

        <div class="alert-strip">
          <div class="alert-strip-head">
            <span class="eyebrow">Alerts on this symbol</span>
            <button class="btn btn-ghost btn-small" type="button" @click="openAlertDialog(selectedAsset.symbol)">
              <Plus :size="12" />
              新建
            </button>
          </div>
          <div v-if="!relatedAlerts.length" class="alert-strip-empty">
            暂无提醒。价格涨破、跌破或涨跌幅达到条件时会记录并推送通知。
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
              <span>{{ rule.type === "priceAbove" ? "涨破" : rule.type === "priceBelow" ? "跌破" : rule.type === "pctAbove" ? "涨幅超过" : "跌幅超过" }}</span>
              <strong class="mono">
                {{ rule.type.startsWith("pct") ? `${rule.threshold.toFixed(2)}%` : formatPrice(rule.threshold, digits) }}
              </strong>
            </button>
          </div>
        </div>
      </div>

      <div v-else class="panel empty detail-empty">
        <Star :size="24" :stroke-width="1.4" />
        <strong>选择一只标的</strong>
        <p>左侧点选自选，查看最新价格、区间走势和提醒状态。</p>
      </div>
    </div>
  </section>
</template>
