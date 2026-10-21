<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { AlertCircle, Check, Info, Search, X } from "lucide-vue-next";
import type { Asset, SearchResult } from "../types";
import {
  addHolding,
  assetForSymbol,
  closeHoldingDialog,
  ensureAsset,
  quoteFor,
  state,
  watchlistAssets,
} from "../lib/store";
import { searchAssets } from "../lib/backend";
import {
  formatMoney,
  formatPercent,
  formatPrice,
  formatSigned,
  priceDigits,
  toneOf,
} from "../lib/format";

const initial = state.holdingDialog.holding;
const editing = Boolean(initial);

const symbol = ref(initial?.symbol ?? state.selectedSymbol ?? state.watchlist[0] ?? "");
const sharesInput = ref(initial ? String(initial.shares) : "");
const costInput = ref(
  initial ? String(initial.cost) : String(quoteFor(symbol.value)?.price ?? ""),
);
const note = ref(initial?.note ?? "");
const error = ref("");

const pickerQuery = ref("");
const pickerResults = ref<SearchResult[]>([]);
const pickerLoading = ref(false);
let pickerToken = 0;
let pickerTimer: number | undefined;

const asset = computed<Asset | null>(() => (symbol.value ? assetForSymbol(symbol.value) : null));
const quote = computed(() => (symbol.value ? quoteFor(symbol.value) : undefined));
const shares = computed(() => Number(sharesInput.value));
const cost = computed(() => Number(costInput.value));
const digits = computed(() => priceDigits(asset.value?.kind ?? "stock", quote.value?.price ?? cost.value));
const estimateValue = computed(() =>
  Number.isFinite(shares.value) && Number.isFinite(cost.value) ? shares.value * cost.value : 0,
);
const estimatePnl = computed(() => {
  const price = quote.value?.price;
  if (price == null || !Number.isFinite(shares.value) || !Number.isFinite(cost.value)) return null;
  return (price - cost.value) * shares.value;
});

watch(pickerQuery, (value) => {
  window.clearTimeout(pickerTimer);
  const term = value.trim();
  if (!term) {
    pickerResults.value = [];
    pickerLoading.value = false;
    return;
  }
  pickerLoading.value = true;
  pickerTimer = window.setTimeout(async () => {
    const token = ++pickerToken;
    const found = await searchAssets(term);
    if (token !== pickerToken) return;
    pickerResults.value = found;
    pickerLoading.value = false;
  }, 220);
});

function selectSymbol(next: string) {
  if (next === symbol.value) return;
  symbol.value = next;
  costInput.value = String(quoteFor(next)?.price ?? "");
  error.value = "";
}

function pick(result: SearchResult) {
  ensureAsset(result);
  selectSymbol(result.symbol);
  pickerQuery.value = "";
  pickerResults.value = [];
}

function submit() {
  error.value = "";
  if (!symbol.value) {
    error.value = "请先选择要记录的标的";
    return;
  }
  if (!Number.isFinite(shares.value) || shares.value <= 0) {
    error.value = "持有份额需要大于 0";
    return;
  }
  if (!Number.isFinite(cost.value) || cost.value <= 0) {
    error.value = "成本价需要大于 0";
    return;
  }
  addHolding({
    symbol: symbol.value,
    shares: shares.value,
    cost: cost.value,
    note: note.value.trim(),
  });
  closeHoldingDialog();
}

onBeforeUnmount(() => {
  window.clearTimeout(pickerTimer);
  pickerToken += 1;
});
</script>

<template>
  <div class="modal-backdrop" @mousedown.self="closeHoldingDialog">
    <form class="modal" @submit.prevent="submit">
      <div class="modal-head">
        <div>
          <h2>{{ editing ? "编辑持仓" : "添加持仓" }}</h2>
          <p>{{ editing ? "更新份额与成本后，盈亏会立即重算" : "记录份额与成本，市值随行情自动更新" }}</p>
        </div>
        <button class="icon-btn" type="button" aria-label="关闭" @click="closeHoldingDialog">
          <X :size="16" />
        </button>
      </div>

      <div class="modal-body">
        <div v-if="asset" class="dialog-symbol">
          <span class="dialog-symbol-main">
            <span class="result-mark">{{ asset.name.slice(0, 1) }}</span>
            <span class="dialog-symbol-copy">
              <strong>{{ asset.name }}</strong>
              <small>{{ asset.code }} · {{ asset.typeLabel }}</small>
            </span>
          </span>
          <span v-if="quote" class="dialog-symbol-price">
            <strong :class="toneOf(quote.changePct)">{{ formatPrice(quote.price, digits) }}</strong>
            <small :class="toneOf(quote.changePct)">{{ formatPercent(quote.changePct) }}</small>
          </span>
        </div>

        <div v-if="!editing" class="field">
          <span>切换标的</span>
          <div class="picker-chips">
            <button
              v-for="item in watchlistAssets"
              :key="item.symbol"
              class="picker-chip"
              :class="{ active: item.symbol === symbol }"
              type="button"
              @click="selectSymbol(item.symbol)"
            >
              <Check v-if="item.symbol === symbol" :size="10" />
              {{ item.name }}
            </button>
          </div>
          <div class="input-suffix">
            <input
              v-model="pickerQuery"
              type="text"
              spellcheck="false"
              placeholder="搜索其他股票、ETF 或基金代码"
            />
            <em><Search :size="13" /></em>
          </div>
          <div v-if="pickerQuery.trim()" class="picker-results">
            <p v-if="pickerLoading" class="picker-empty">查询中…</p>
            <p v-else-if="!pickerResults.length" class="picker-empty">没有找到匹配的标的</p>
            <button
              v-for="result in pickerResults"
              :key="result.symbol"
              class="picker-result"
              type="button"
              @click="pick(result)"
            >
              <span>
                <strong>{{ result.name }}</strong>
                <small class="mono">{{ result.code }}</small>
              </span>
              <small>{{ result.typeLabel }}</small>
            </button>
          </div>
        </div>

        <div class="field-grid">
          <label class="field">
            <span>持有份额</span>
            <input
              v-model="sharesInput"
              inputmode="decimal"
              autocomplete="off"
              placeholder="0"
            />
            <small>{{ asset?.kind === "fund" ? "场外基金按份额记录" : "股票、ETF 按股数记录" }}</small>
          </label>
          <label class="field">
            <span>成本价</span>
            <div class="input-suffix">
              <input v-model="costInput" inputmode="decimal" autocomplete="off" placeholder="0.00" />
              <em>元</em>
            </div>
            <small>含手续费后的平均成本</small>
          </label>
        </div>

        <label class="field">
          <span>备注</span>
          <input v-model="note" type="text" maxlength="40" placeholder="例如：定投账户 / 2026 年建仓" />
        </label>

        <div class="estimate-line">
          <span>按成本估算市值</span>
          <strong>¥{{ formatMoney(estimateValue) }}</strong>
        </div>
        <div v-if="estimatePnl != null" class="estimate-line">
          <span>按现价估算浮动盈亏</span>
          <strong :class="toneOf(estimatePnl)">{{ formatSigned(estimatePnl) }}</strong>
        </div>

        <p v-if="error" class="dialog-note">
          <AlertCircle :size="13" />
          <span class="up">{{ error }}</span>
        </p>
        <p v-else class="dialog-note">
          <Info :size="13" />
          <span>盈亏未计手续费、分红与税费，仅用于日常观察。</span>
        </p>
      </div>

      <div class="modal-foot">
        <button class="btn btn-ghost" type="button" @click="closeHoldingDialog">取消</button>
        <button class="btn btn-gold" type="submit">{{ editing ? "保存修改" : "保存持仓" }}</button>
      </div>
    </form>
  </div>
</template>
