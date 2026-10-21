<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Check, Plus, Search } from "lucide-vue-next";
import type { SearchResult } from "../types";
import { searchAssets } from "../lib/backend";
import { addToWatchlist, selectAsset, state } from "../lib/store";

const query = ref("");
const results = ref<SearchResult[]>([]);
const active = ref(0);
const loading = ref(false);
const inputEl = ref<HTMLInputElement | null>(null);

let requestToken = 0;
let debounceTimer: number | undefined;

function close() {
  state.searchOpen = false;
}

function isAdded(symbol: string) {
  return state.watchlist.includes(symbol);
}

async function runSearch(value: string) {
  const token = ++requestToken;
  loading.value = true;
  try {
    const found = await searchAssets(value);
    if (token !== requestToken) return;
    results.value = found;
    active.value = 0;
  } finally {
    if (token === requestToken) loading.value = false;
  }
}

watch(query, (value) => {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    void runSearch(value);
  }, 180);
});

function choose(result: SearchResult) {
  if (isAdded(result.symbol)) {
    selectAsset(result.symbol);
    state.searchOpen = false;
    return;
  }
  addToWatchlist(result);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!results.value.length) return;
    const step = event.key === "ArrowDown" ? 1 : -1;
    active.value = (active.value + step + results.value.length) % results.value.length;
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    const result = results.value[active.value];
    if (result) choose(result);
  }
}

onMounted(() => {
  inputEl.value?.focus();
  void runSearch("");
});

onBeforeUnmount(() => {
  window.clearTimeout(debounceTimer);
  requestToken += 1;
});
</script>

<template>
  <div class="modal-backdrop" @mousedown.self="close">
    <div class="modal search-modal" role="dialog" aria-modal="true" aria-label="搜索标的">
      <div class="search-box">
        <Search :size="16" />
        <input
          ref="inputEl"
          v-model="query"
          type="text"
          spellcheck="false"
          placeholder="搜索股票、ETF、场外基金，支持名称或代码"
          @keydown="onKeydown"
        />
        <kbd>Esc</kbd>
      </div>

      <div class="search-body">
        <div class="search-group-label">
          <span>{{ query.trim() ? "搜索结果" : "热门标的" }}</span>
          <span>{{ loading ? "查询中…" : `${results.length} 条` }}</span>
        </div>

        <p v-if="!loading && !results.length" class="picker-empty">
          没有找到匹配的标的，试试六位代码或完整名称。
        </p>

        <button
          v-for="(result, index) in results"
          :key="result.symbol"
          class="search-result"
          :class="{
            active: index === active,
            added: isAdded(result.symbol),
            fund: result.kind === 'fund',
          }"
          type="button"
          @mouseenter="active = index"
          @click="choose(result)"
        >
          <span class="result-mark">{{ result.name.slice(0, 1) }}</span>
          <span class="result-main">
            <strong>{{ result.name }}</strong>
            <small>
              <span class="mono">{{ result.code }}</span>
              {{ result.typeLabel }} · {{ result.symbol.slice(0, 2).toUpperCase() }}
            </small>
          </span>
          <span class="result-action">
            <Check v-if="isAdded(result.symbol)" :size="12" />
            <Plus v-else :size="12" />
            {{ isAdded(result.symbol) ? "已添加" : "加入自选" }}
          </span>
        </button>
      </div>

      <div class="search-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
        <span><kbd>↵</kbd> 加入自选</span>
        <span>行情来自腾讯与天天基金</span>
      </div>
    </div>
  </div>
</template>
