<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { AlertCircle, BellRing, Info, Trash2, X } from "lucide-vue-next";
import type { AlertType } from "../types";
import {
  assetForSymbol,
  closeAlertDialog,
  createAlert,
  deleteAlert,
  quoteFor,
  showToast,
  state,
  updateAlert,
  watchlistAssets,
} from "../lib/store";
import { ALERT_LABELS, ALERT_SHORT_LABELS } from "../lib/alerts";
import { formatPercent, formatPrice, priceDigits, toneOf } from "../lib/format";

const rule = state.alertDialog.rule;
const editing = Boolean(rule);

const symbol = ref(state.alertDialog.symbol ?? state.selectedSymbol ?? state.watchlist[0] ?? "");
const type = ref<AlertType>(rule?.type ?? "priceAbove");
const thresholdInput = ref(rule ? String(rule.threshold) : "0");
const error = ref("");
const deleteArmed = ref(false);
let deleteTimer: number | undefined;

const asset = computed(() => (symbol.value ? assetForSymbol(symbol.value) : null));
const quote = computed(() => (symbol.value ? quoteFor(symbol.value) : undefined));
const isPct = computed(() => type.value.startsWith("pct"));
const digits = computed(() => priceDigits(asset.value?.kind ?? "stock", quote.value?.price ?? null));
const threshold = computed(() => Number(thresholdInput.value));

const typeOptions: { key: AlertType; label: string; hint: string }[] = [
  { key: "priceAbove", label: "涨破", hint: "目标价" },
  { key: "priceBelow", label: "跌破", hint: "目标价" },
  { key: "pctAbove", label: "涨幅超过", hint: "百分比" },
  { key: "pctBelow", label: "跌幅超过", hint: "百分比" },
];

function defaultPrice(next: AlertType) {
  const price = quote.value?.price;
  if (price == null) return "";
  const factor = next === "priceAbove" ? 1.03 : 0.97;
  return price < 1 ? (price * factor).toFixed(4) : price < 10 ? (price * factor).toFixed(3) : (price * factor).toFixed(2);
}

function setType(next: AlertType) {
  const fromPct = type.value.startsWith("pct");
  const toPct = next.startsWith("pct");
  type.value = next;
  if (fromPct !== toPct) {
    thresholdInput.value = toPct ? "5" : defaultPrice(next);
  }
  error.value = "";
}

const quickOptions = computed(() => {
  if (isPct.value) {
    return [3, 5, 8].map((value) => ({ label: `${value}%`, value }));
  }
  const price = quote.value?.price;
  if (price == null) return [];
  const options = [{ label: "现价", value: Number(price.toFixed(digits.value)) }];
  for (const pct of [-5, -3, 3, 5]) {
    const value = price * (1 + pct / 100);
    options.push({
      label: `${pct > 0 ? "+" : ""}${pct}%`,
      value: Number(value.toFixed(digits.value)),
    });
  }
  return options;
});

const preview = computed(() => {
  if (!asset.value) return "先选择一个标的";
  if (!Number.isFinite(threshold.value) || threshold.value <= 0) return "填写一个有效的提醒值";
  const value = isPct.value
    ? `${Math.abs(threshold.value).toFixed(2)}%`
    : formatPrice(threshold.value, digits.value);
  return `当 ${asset.value.name} ${ALERT_LABELS[type.value]} ${value} 时提醒`;
});

function pickSymbol(next: string) {
  symbol.value = next;
  if (!rule) {
    thresholdInput.value = isPct.value ? "5" : defaultPrice(type.value);
  }
}

function save() {
  error.value = "";
  if (!symbol.value) {
    error.value = "请先选择要设置提醒的标的";
    return;
  }
  if (!Number.isFinite(threshold.value) || threshold.value <= 0) {
    error.value = "提醒值需要是大于 0 的数字";
    return;
  }
  if (rule) {
    updateAlert(rule.id, {
      symbol: symbol.value,
      type: type.value,
      threshold: threshold.value,
      lastTriggeredAt: null,
    });
    showToast("提醒规则已更新", "success");
  } else {
    createAlert({ symbol: symbol.value, type: type.value, threshold: threshold.value });
  }
  closeAlertDialog();
}

function requestDelete() {
  if (!rule) return;
  window.clearTimeout(deleteTimer);
  if (deleteArmed.value) {
    deleteAlert(rule.id);
    showToast("提醒已删除", "info");
    closeAlertDialog();
    return;
  }
  deleteArmed.value = true;
  deleteTimer = window.setTimeout(() => {
    deleteArmed.value = false;
  }, 4000);
}

watch(
  () => quote.value?.price,
  (price) => {
    if (!editing && price != null && thresholdInput.value === "0") {
      thresholdInput.value = defaultPrice(type.value);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => window.clearTimeout(deleteTimer));
</script>

<template>
  <div class="modal-backdrop" @mousedown.self="closeAlertDialog">
    <form class="modal" @submit.prevent="save">
      <div class="modal-head">
        <div>
          <h2>{{ editing ? "编辑提醒" : "新建提醒" }}</h2>
          <p>行情刷新后自动检查，同一规则 30 分钟内不重复提醒</p>
        </div>
        <button class="icon-btn" type="button" aria-label="关闭" @click="closeAlertDialog">
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

        <div v-if="!asset" class="field">
          <span>选择标的</span>
          <div class="picker-chips">
            <button
              v-for="item in watchlistAssets"
              :key="item.symbol"
              class="picker-chip"
              type="button"
              @click="pickSymbol(item.symbol)"
            >
              {{ item.name }}
            </button>
          </div>
        </div>

        <div class="field">
          <span>触发条件</span>
          <div class="type-grid">
            <button
              v-for="option in typeOptions"
              :key="option.key"
              class="type-option"
              :class="{ active: type === option.key }"
              type="button"
              @click="setType(option.key)"
            >
              {{ option.label }}
              <small>{{ option.hint }}</small>
            </button>
          </div>
        </div>

        <label class="field">
          <span>{{ isPct ? "涨跌幅阈值" : "目标价格" }}</span>
          <div class="input-suffix">
            <input
              v-model="thresholdInput"
              inputmode="decimal"
              autocomplete="off"
              :placeholder="isPct ? '5.00' : '0.00'"
            />
            <em>{{ isPct ? "%" : "元" }}</em>
          </div>
        </label>

        <div v-if="quickOptions.length" class="picker-chips">
          <button
            v-for="option in quickOptions"
            :key="option.label"
            class="picker-chip"
            :class="{ active: Math.abs(threshold - option.value) < 0.000001 }"
            type="button"
            @click="thresholdInput = String(option.value)"
          >
            {{ option.label }}
          </button>
        </div>

        <div class="alert-preview">
          <BellRing :size="13" />
          {{ preview }}
        </div>

        <p v-if="error" class="dialog-note">
          <AlertCircle :size="13" />
          <span class="up">{{ error }}</span>
        </p>
        <p v-else class="dialog-note">
          <Info :size="13" />
          <span>提醒只在本机检查，</span>
          <span>{{ ALERT_SHORT_LABELS[type] }}条件触发后写入触发记录。</span>
        </p>
      </div>

      <div class="modal-foot">
        <span v-if="editing" class="foot-left">
          <button class="btn btn-ghost btn-small" type="button" @click="requestDelete">
            <Trash2 :size="13" />
            {{ deleteArmed ? "确认删除" : "删除规则" }}
          </button>
        </span>
        <button class="btn btn-ghost" type="button" @click="closeAlertDialog">取消</button>
        <button class="btn btn-gold" type="submit">{{ editing ? "保存修改" : "创建提醒" }}</button>
      </div>
    </form>
  </div>
</template>
