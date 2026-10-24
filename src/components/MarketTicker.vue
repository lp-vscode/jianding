<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { RefreshCw } from "lucide-vue-next";
import { dataMode, refreshAll, state } from "../lib/store";
import { directionMark, formatPercent, formatPrice, formatTime, toneOf } from "../lib/format";
import { dataDelayLimitMs, marketPhase } from "../lib/market";

const now = ref(new Date());
const timer = window.setInterval(() => {
  now.value = new Date();
}, 5_000);
onBeforeUnmount(() => window.clearInterval(timer));

const phase = computed(() => marketPhase(now.value));
const freshness = computed(() => {
  if (!state.lastUpdated) {
    return { tone: "waiting", text: state.refreshing ? "正在同步" : "等待刷新", detail: "尚未取得行情数据" };
  }
  const seconds = Math.max(0, Math.floor((now.value.getTime() - state.lastUpdated) / 1000));
  const delayLimit = dataDelayLimitMs(state.settings.refreshSeconds, now.value) / 1000;
  const updatedAt = formatTime(new Date(state.lastUpdated).toISOString()).slice(11);
  const snapshotAt = formatTime(new Date(state.lastUpdated).toISOString()).slice(5);
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

async function refresh() {
  if (state.refreshing) return;
  await refreshAll();
}
</script>

<template>
  <header class="topbar">
    <div class="index-strip" :class="{ stale: freshness.tone === 'delayed' || freshness.tone === 'cached' }">
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

    <div class="topbar-right">
      <span class="chip" :class="{ 'chip-live': phase === '交易中' }">
        <i class="dot" />
        {{ phase }}
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
      <button
        class="icon-btn"
        type="button"
        title="立即刷新"
        aria-label="立即刷新行情"
        :aria-busy="state.refreshing"
        :disabled="state.refreshing"
        @click="refresh"
      >
        <RefreshCw :size="15" :class="{ spinning: state.refreshing }" />
      </button>
    </div>
  </header>
</template>
