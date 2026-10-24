<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { BarChart3, Bell, PanelTop, Plus, Search, Settings, Star, Wallet } from "lucide-vue-next";
import { invoke } from "@tauri-apps/api/core";
import type { ViewKey } from "../types";
import { dataMode, setView, showToast, state, unreadAlertCount, watchlistAssets } from "../lib/store";
import { marketClock, marketPhase } from "../lib/market";
import { isTauri } from "../lib/backend";

const navItems: { key: ViewKey; label: string; icon: typeof Star }[] = [
  { key: "watchlist", label: "自选观察", icon: Star },
  { key: "holdings", label: "我的持仓", icon: Wallet },
  { key: "trading", label: "量化交易", icon: BarChart3 },
  { key: "alerts", label: "价格提醒", icon: Bell },
  { key: "settings", label: "偏好设置", icon: Settings },
];

const now = ref(new Date());
const openingCompact = ref(false);
const timer = window.setInterval(() => {
  now.value = new Date();
}, 20_000);
onBeforeUnmount(() => window.clearInterval(timer));

const phase = computed(() => marketPhase(now.value));
const clock = computed(() => marketClock(now.value));
const modeText = computed(() => {
  if (dataMode.value === "live") return "实时行情";
  if (dataMode.value === "mixed") return "实时 / 净值";
  if (dataMode.value === "demo") return "示例数据";
  if (dataMode.value === "cached") return "本地快照";
  return "连接中";
});

async function openCompact() {
  if (openingCompact.value) return;
  if (!isTauri()) {
    showToast("浮窗模式仅在桌面版可用", "info");
    return;
  }
  openingCompact.value = true;
  try {
    await invoke("show_compact_window");
  } catch (error) {
    console.warn("打开浮窗失败", error);
    showToast("浮窗打开失败，请稍后重试", "error");
  } finally {
    openingCompact.value = false;
  }
}
</script>

<template>
  <aside class="app-sidebar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path d="M6 24V12.5c0-.8.7-1.5 1.5-1.5H25" stroke="currentColor" stroke-opacity=".32" stroke-width="1.6" />
          <path d="M7 22.5l5.2-4.4 3.4 1.9 4.5-6.2 5 2.8" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" />
          <circle cx="25.2" cy="16.6" r="1.5" fill="#f4e5c8" />
        </svg>
      </span>
      <span class="brand-copy">
        <strong>简盯</strong>
        <small>MARKET WATCH</small>
      </span>
    </div>

    <nav class="side-nav" aria-label="主导航">
      <button
        v-for="item in navItems"
        :key="item.key"
        class="nav-item"
        :class="{ active: state.view === item.key }"
        type="button"
        @click="setView(item.key)"
      >
        <component :is="item.icon" :size="16" :stroke-width="1.8" />
        <span>{{ item.label }}</span>
        <span v-if="item.key === 'alerts' && unreadAlertCount" class="nav-badge">{{ unreadAlertCount }}</span>
        <span v-else-if="item.key === 'watchlist'" class="nav-count">{{ watchlistAssets.length }}</span>
      </button>
    </nav>

    <button class="side-action" type="button" @click="state.searchOpen = true">
      <Plus :size="15" :stroke-width="2" />
      <span>添加自选</span>
      <kbd>⌘K</kbd>
    </button>

    <button
      class="side-action side-action-quiet"
      type="button"
      :disabled="openingCompact"
      :aria-busy="openingCompact"
      @click="openCompact"
    >
      <PanelTop :size="14" :stroke-width="1.8" />
      <span>置顶浮窗</span>
      <kbd>{{ openingCompact ? "打开中" : "Mini" }}</kbd>
    </button>

    <div class="side-hint">
      <Search :size="13" />
      <span>股票、ETF 与场外基金统一盯盘</span>
    </div>

    <div class="side-foot">
      <div class="side-stat">
        <span>市场状态</span>
        <strong class="market-pulse" :class="{ live: phase === '交易中' }">
          <i class="phase-dot" />
          {{ phase }}
        </strong>
      </div>
      <div class="side-stat">
        <span>本机时间</span>
        <strong class="mono">{{ clock }}</strong>
      </div>
      <div class="side-stat">
        <span>数据模式</span>
        <strong>{{ modeText }}</strong>
      </div>
      <p class="side-note">数据保存在本机，行情仅供参考，不构成投资建议。</p>
    </div>
  </aside>
</template>
