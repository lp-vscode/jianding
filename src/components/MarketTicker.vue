<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { RefreshCw } from "lucide-vue-next";
import { refreshAll, state } from "../lib/store";
import { formatPercent, formatPrice, formatTime, toneOf } from "../lib/format";
import { marketPhase } from "../lib/market";

const now = ref(new Date());
const timer = window.setInterval(() => {
  now.value = new Date();
}, 20_000);
onBeforeUnmount(() => window.clearInterval(timer));

const phase = computed(() => marketPhase(now.value));
const updatedText = computed(() => {
  if (!state.lastUpdated) return "等待首次刷新";
  return formatTime(new Date(state.lastUpdated).toISOString()).slice(11);
});

async function refresh() {
  if (state.refreshing) return;
  await refreshAll();
}
</script>

<template>
  <header class="topbar">
    <div class="index-strip">
      <div v-for="index in state.indices" :key="index.symbol" class="index-item">
        <span class="index-name">{{ index.name }}</span>
        <span class="index-row">
          <b class="index-price" :class="toneOf(index.changePct)">{{ formatPrice(index.price, 2) }}</b>
          <span class="index-pct" :class="toneOf(index.changePct)">{{ formatPercent(index.changePct) }}</span>
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
      <span class="updated">{{ updatedText }} 更新</span>
      <button class="icon-btn" type="button" title="立即刷新" :disabled="state.refreshing" @click="refresh">
        <RefreshCw :size="15" :class="{ spinning: state.refreshing }" />
      </button>
    </div>
  </header>
</template>
