<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { Moon, Sun } from "lucide-vue-next";
import { dataMode, quoteFor, selectedAsset, state, updateSettings } from "../lib/store";
import {
  directionMark,
  formatCompactMoney,
  formatPercent,
  formatPrice,
  formatTime,
  formatVolume,
  priceDigits,
  toneOf,
} from "../lib/format";
import { dataDelayLimitMs, intradaySignal, marketPhase } from "../lib/market";

const now = ref(new Date());
const timer = window.setInterval(() => {
  now.value = new Date();
}, 5_000);
onBeforeUnmount(() => window.clearInterval(timer));

const phase = computed(() => marketPhase(now.value));
const quote = computed(() => (selectedAsset.value ? quoteFor(selectedAsset.value.symbol) : undefined));
const digits = computed(() =>
  selectedAsset.value ? priceDigits(selectedAsset.value.kind, quote.value?.price) : 2,
);
const signal = computed(() => intradaySignal(quote.value));
const isDarkTheme = computed(() => {
  const mode = state.settings.themeMode;
  return (
    mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  );
});
const sourceLabel = computed(() => {
  if (dataMode.value === "demo") return phase.value === "交易中" ? "示例数据" : "收盘快照";
  if (dataMode.value === "close") return "最近收盘";
  if (dataMode.value === "cached") return "本地快照";
  if (phase.value !== "交易中") return "收盘快照";
  return "";
});
const closedSnapshotLabel = computed(() => {
  const date = quote.value?.navDate ?? quote.value?.updatedAt?.slice(0, 10) ?? "";
  return date ? `${date.slice(5).replace("-", "/")} 收盘` : "最近收盘";
});
function shanghaiStamp(timestamp: number) {
  return formatTime(new Date(timestamp + 8 * 60 * 60 * 1000).toISOString());
}
const statusVolume = computed(() =>
  quote.value?.state === "nav"
    ? formatCompactMoney(quote.value?.amount)
    : formatVolume(quote.value?.volume),
);
const statusUpdated = computed(() => {
  if (quote.value?.state === "nav") return quote.value.navDate ?? "--";
  const clock = formatTime(quote.value?.updatedAt).slice(11);
  return clock || "--";
});
const freshness = computed(() => {
  if (!state.lastUpdated) {
    return { tone: "waiting", text: state.refreshing ? "正在同步" : "等待刷新", detail: "尚未取得行情数据" };
  }
  const seconds = Math.max(0, Math.floor((now.value.getTime() - state.lastUpdated) / 1000));
  const delayLimit = dataDelayLimitMs(state.settings.refreshSeconds, now.value) / 1000;
  const updatedAt = shanghaiStamp(state.lastUpdated).slice(11);
  const snapshotAt = shanghaiStamp(state.lastUpdated).slice(5);
  if (phase.value !== "交易中") {
    return {
      tone: "closed",
      text: closedSnapshotLabel.value,
      detail: "休市期间显示最近交易日收盘数据，联网后会同步最近收盘",
    };
  }
  if (!state.online || state.marketFromCache) {
    return {
      tone: "cached",
      text: `快照 ${snapshotAt}`,
      detail: `${state.online ? "行情接口不可用" : "当前离线"}，显示最近一次成功快照`,
    };
  }
  if (dataMode.value === "demo") {
    const text = seconds < 10 ? "示例 · 刚刚" : `示例 · ${seconds} 秒前`;
    return { tone: "demo", text, detail: `当前为示例行情，最近同步于 ${updatedAt}` };
  }
  if (seconds > delayLimit) {
    const delay = seconds < 120 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${Math.floor(seconds / 60)} 分钟`;
    return { tone: "delayed", text: `延迟 ${delay}`, detail: `最近成功更新于 ${updatedAt}` };
  }
  const text = seconds < 10 ? "刚刚更新" : `${seconds} 秒前`;
  return { tone: "fresh", text, detail: `最近成功更新于 ${updatedAt}` };
});

function toggleTheme() {
  updateSettings({ themeMode: isDarkTheme.value ? "light" : "dark" });
}

</script>

<template>
  <header class="topbar market-statusbar">
    <div class="status-security">
      <span class="status-code">
        {{ selectedAsset ? `${selectedAsset.code} · ${selectedAsset.typeLabel}` : "当前标的" }}
      </span>
      <span class="status-name">
        {{ selectedAsset?.name ?? "等待选择" }}
        <span
          v-if="signal"
          class="status-signal"
          :class="signal.tone"
          :title="signal.label"
          :aria-label="signal.label"
        >
          {{ signal.label }}
        </span>
      </span>
    </div>

    <div class="status-quote">
      <strong :class="toneOf(quote?.changePct)">{{ formatPrice(quote?.price, digits) }}</strong>
      <span :class="toneOf(quote?.changePct)">
        {{ formatPercent(quote?.changePct) }}
        <i class="trend-mark" aria-hidden="true">{{ directionMark(quote?.changePct) }}</i>
      </span>
    </div>

    <dl class="status-metrics">
      <div>
        <dt>{{ quote?.state === "nav" ? "成交额" : "成交量" }}</dt>
        <dd>{{ statusVolume }}</dd>
      </div>
      <div>
        <dt>{{ quote?.state === "nav" ? "净值日" : "更新" }}</dt>
        <dd>{{ statusUpdated }}</dd>
      </div>
    </dl>

    <div
      class="index-strip"
      aria-label="指数概览"
      :class="{ stale: freshness.tone === 'delayed' || freshness.tone === 'cached' }"
    >
      <div v-for="index in state.indices" :key="index.symbol" class="index-item">
        <span class="index-name">{{ index.name }}</span>
        <span class="index-row">
          <b class="index-price" :class="toneOf(index.changePct)">{{ formatPrice(index.price, 2) }}</b>
          <span class="index-pct" :class="toneOf(index.changePct)">
            {{ formatPercent(index.changePct) }}
            <i class="trend-mark" aria-hidden="true">{{ directionMark(index.changePct) }}</i>
          </span>
        </span>
      </div>
      <div v-if="!state.indices.length" class="index-item">
        <span class="index-name">指数行情</span>
        <span class="index-row"><b class="index-price flat">连接中…</b></span>
      </div>
    </div>

    <div class="statusbar-health">
      <span class="status-context">
        <span
          v-if="sourceLabel"
          class="status-source"
          :class="`is-${dataMode}`"
        >
          {{ sourceLabel }}
        </span>
        <span class="status-phase">{{ phase }}</span>
        <button
          class="theme-quick-toggle"
          type="button"
          :title="isDarkTheme ? '切换到浅色模式' : '切换到深色模式'"
          :aria-label="isDarkTheme ? '切换到浅色模式' : '切换到深色模式'"
          :aria-pressed="isDarkTheme"
          @click="toggleTheme"
        >
          <Sun v-if="isDarkTheme" :size="13" :stroke-width="1.8" aria-hidden="true" />
          <Moon v-else :size="13" :stroke-width="1.8" aria-hidden="true" />
        </button>
      </span>
      <span
        class="data-health"
        :class="freshness.tone"
        :title="freshness.detail"
        role="status"
        aria-live="polite"
      >
        <i :key="state.lastUpdated ?? 'waiting'" class="health-dot" />
        {{ freshness.text }}
      </span>
    </div>
  </header>
</template>
