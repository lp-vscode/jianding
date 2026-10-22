<script setup lang="ts">
import { computed } from "vue";
import { ArrowUpRight, EyeOff, RefreshCw } from "lucide-vue-next";
import { invoke } from "@tauri-apps/api/core";
import {
  quoteFor,
  refreshAll,
  selectAsset,
  selectedAsset,
  state,
  watchlistAssets,
} from "../lib/store";
import { directionMark, formatPercent, formatPrice, priceDigits, toneOf } from "../lib/format";
import { marketPhase } from "../lib/market";

const current = computed(() => (selectedAsset.value ? quoteFor(selectedAsset.value.symbol) : undefined));
const digits = computed(() =>
  selectedAsset.value ? priceDigits(selectedAsset.value.kind, current.value?.price ?? null) : 2,
);
const status = computed(() => marketPhase());
const rows = computed(() => watchlistAssets.value.slice(0, 4));

async function hideCompact() {
  await invoke("hide_compact_window");
}

async function openMain() {
  await invoke("focus_main_window");
}
</script>

<template>
  <div class="compact-window">
    <header class="compact-titlebar" data-tauri-drag-region @dblclick="hideCompact">
      <span class="compact-brand">
        <i />
        简盯
      </span>
      <span class="compact-market">{{ status }}</span>
      <div class="compact-actions">
        <button type="button" title="刷新行情" aria-label="刷新行情" @click="refreshAll">
          <RefreshCw :size="13" :class="{ spinning: state.refreshing }" />
        </button>
        <button type="button" title="返回主窗口" aria-label="返回主窗口" @click="openMain">
          <ArrowUpRight :size="14" />
        </button>
        <button type="button" title="隐藏浮窗" aria-label="隐藏浮窗" @click="hideCompact">
          <EyeOff :size="14" />
        </button>
      </div>
    </header>

    <button
      v-if="selectedAsset"
      class="compact-hero"
      type="button"
      title="打开主窗口"
      @click="openMain"
    >
      <span class="compact-security">
        <strong>{{ selectedAsset.name }}</strong>
        <small>{{ selectedAsset.code }} · {{ selectedAsset.typeLabel }}</small>
      </span>
      <span class="compact-price">
        <strong :class="toneOf(current?.changePct)">
          {{ formatPrice(current?.price, digits) }}
        </strong>
        <small :class="toneOf(current?.changePct)">
          {{ formatPercent(current?.changePct) }}
          <i class="trend-mark" aria-hidden="true">{{ directionMark(current?.changePct) }}</i>
        </small>
      </span>
    </button>

    <div class="compact-list">
      <button
        v-for="asset in rows"
        :key="asset.symbol"
        class="compact-row"
        :class="{ active: selectedAsset?.symbol === asset.symbol }"
        type="button"
        @click="selectAsset(asset.symbol)"
      >
        <span>{{ asset.name }}</span>
        <strong :class="toneOf(quoteFor(asset.symbol)?.changePct)">
          {{ formatPercent(quoteFor(asset.symbol)?.changePct) }}
          <i class="trend-mark" aria-hidden="true">{{ directionMark(quoteFor(asset.symbol)?.changePct) }}</i>
        </strong>
      </button>
    </div>
  </div>
</template>
