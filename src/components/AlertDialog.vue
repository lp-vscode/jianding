<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { AlertCircle, BellRing, Info, Plus, Trash2, X } from "lucide-vue-next";
import type { AlertLogic, AlertType } from "../types";
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
import { ALERT_SHORT_LABELS, alertConditions } from "../lib/alerts";
import { directionMark, formatPercent, formatPrice, priceDigits, toneOf } from "../lib/format";

interface ConditionDraft {
  type: AlertType;
  value: string;
}

type AlertTemplateKey = "breakout" | "volume" | "pullback" | "volatility";

const rule = state.alertDialog.rule;
const editing = Boolean(rule);

const symbol = ref(state.alertDialog.symbol ?? state.selectedSymbol ?? state.watchlist[0] ?? "");
const initialConditions = rule ? alertConditions(rule) : [{ type: "priceAbove" as const, threshold: 0 }];
const conditions = ref<ConditionDraft[]>(
  initialConditions.map((condition) => ({ type: condition.type, value: condition.threshold ? String(condition.threshold) : "0" })),
);
const logic = ref<AlertLogic>(rule?.logic ?? "all");
const error = ref("");
const deleteArmed = ref(false);
let deleteTimer: number | undefined;

const asset = computed(() => (symbol.value ? assetForSymbol(symbol.value) : null));
const quote = computed(() => (symbol.value ? quoteFor(symbol.value) : undefined));
const digits = computed(() => priceDigits(asset.value?.kind ?? "stock", quote.value?.price ?? null));

const typeOptions: { key: AlertType; label: string; hint: string }[] = [
  { key: "priceAbove", label: "价格涨破", hint: "元" },
  { key: "priceBelow", label: "价格跌破", hint: "元" },
  { key: "pctAbove", label: "涨幅超过", hint: "%" },
  { key: "pctBelow", label: "跌幅超过", hint: "%" },
  { key: "amountAbove", label: "成交额达到", hint: "亿元" },
];

const templates = computed(() => {
  const price = quote.value?.price;
  return [
    {
      key: "breakout" as const,
      label: "突破上沿",
      description: price == null ? "当前价 +3%" : `现价 ${formatPrice(price * 1.03, digits.value)}`,
      disabled: price == null || asset.value?.market === "jj",
    },
    {
      key: "volume" as const,
      label: "放量上攻",
      description: "上涨 3% 且成交额 ≥ 10 亿",
      disabled: price == null || asset.value?.market === "jj",
    },
    {
      key: "pullback" as const,
      label: "回落观察",
      description: price == null ? "当前价 -3%" : `现价 ${formatPrice(price * 0.97, digits.value)}`,
      disabled: price == null || asset.value?.market === "jj",
    },
    {
      key: "volatility" as const,
      label: "双向异动",
      description: "涨跌任一方向达到 5%",
      disabled: false,
    },
  ];
});

function defaultPrice(next: AlertType) {
  const price = quote.value?.price;
  if (price == null) return "0";
  const factor = next === "priceBelow" ? 0.97 : 1.03;
  return price < 1 ? (price * factor).toFixed(4) : price < 10 ? (price * factor).toFixed(3) : (price * factor).toFixed(2);
}

function defaultValue(type: AlertType) {
  if (type === "pctAbove" || type === "pctBelow") return "5";
  if (type === "amountAbove") return "10";
  return defaultPrice(type);
}

function conditionDraft(type: AlertType, value = defaultValue(type)): ConditionDraft {
  return { type, value };
}

function unitFor(type: AlertType) {
  if (type === "pctAbove" || type === "pctBelow") return "%";
  if (type === "amountAbove") return "亿";
  return "元";
}

function placeholderFor(type: AlertType) {
  if (type === "pctAbove" || type === "pctBelow") return "5.00";
  if (type === "amountAbove") return "10.00";
  return "0.00";
}

function setConditionType(index: number, type: AlertType) {
  const current = conditions.value[index];
  if (!current) return;
  const unitChanged = unitFor(current.type) !== unitFor(type);
  current.type = type;
  if (unitChanged) current.value = defaultValue(type);
  error.value = "";
}

function onConditionTypeChange(index: number, event: Event) {
  setConditionType(index, (event.target as HTMLSelectElement).value as AlertType);
}

function addCondition() {
  if (conditions.value.length >= 3) return;
  conditions.value.push(conditionDraft(asset.value?.market === "jj" ? "pctAbove" : "amountAbove"));
}

function removeCondition(index: number) {
  if (conditions.value.length <= 1) return;
  conditions.value.splice(index, 1);
}

function applyTemplate(key: AlertTemplateKey) {
  const price = quote.value?.price;
  if ((key === "breakout" || key === "volume" || key === "pullback") && price == null) return;
  if (key === "breakout" && price != null) {
    conditions.value = [conditionDraft("priceAbove", String(Number((price * 1.03).toFixed(digits.value))))];
    logic.value = "all";
  } else if (key === "volume" && price != null) {
    conditions.value = [
      conditionDraft("priceAbove", String(Number((price * 1.03).toFixed(digits.value)))),
      conditionDraft("amountAbove", "10"),
    ];
    logic.value = "all";
  } else if (key === "pullback" && price != null) {
    conditions.value = [conditionDraft("priceBelow", String(Number((price * 0.97).toFixed(digits.value))))];
    logic.value = "all";
  } else {
    conditions.value = [conditionDraft("pctAbove", "5"), conditionDraft("pctBelow", "5")];
    logic.value = "any";
  }
  error.value = "";
}

function parsedConditions() {
  return conditions.value.map((condition) => ({
    type: condition.type,
    threshold: Number(condition.value),
  }));
}

function draftValueText(condition: ConditionDraft) {
  const value = Number(condition.value);
  if (!Number.isFinite(value) || value <= 0) return "待填写";
  if (condition.type === "pctAbove" || condition.type === "pctBelow") return `${Math.abs(value).toFixed(2)}%`;
  if (condition.type === "amountAbove") return `${value.toFixed(2)} 亿`;
  return `${formatPrice(value, digits.value)} 元`;
}

const preview = computed(() => {
  if (!asset.value) return "先选择一个标的";
  const invalid = conditions.value.some((condition) => !Number.isFinite(Number(condition.value)) || Number(condition.value) <= 0);
  if (invalid) return "补全全部条件后，这里会生成提醒预览";
  const joiner = conditions.value.length > 1 ? (logic.value === "all" ? " 且 " : " 或 ") : "";
  const summary = conditions.value
    .map((condition) => `${ALERT_SHORT_LABELS[condition.type]} ${draftValueText(condition)}`)
    .join(joiner);
  return `当 ${asset.value.name} ${summary} 时提醒`;
});

function pickSymbol(next: string) {
  symbol.value = next;
  if (!rule) {
    conditions.value = [conditionDraft("priceAbove", defaultValue("priceAbove"))];
    logic.value = "all";
  }
}

function save() {
  error.value = "";
  if (!symbol.value) {
    error.value = "请先选择要设置提醒的标的";
    return;
  }
  const parsed = parsedConditions();
  if (parsed.some((condition) => !Number.isFinite(condition.threshold) || condition.threshold <= 0)) {
    error.value = "每个提醒值都需要是大于 0 的数字";
    return;
  }
  if (parsed.some((condition) => condition.type === "amountAbove") && asset.value?.market === "jj") {
    error.value = "场外基金暂不提供盘中成交额条件";
    return;
  }
  const first = parsed[0];
  if (rule) {
    updateAlert(rule.id, {
      symbol: symbol.value,
      type: first.type,
      threshold: first.threshold,
      conditions: parsed,
      logic: parsed.length > 1 ? logic.value : "all",
      lastTriggeredAt: null,
    });
    showToast("提醒规则已更新", "success");
  } else {
    createAlert({
      symbol: symbol.value,
      type: first.type,
      threshold: first.threshold,
      conditions: parsed,
      logic: parsed.length > 1 ? logic.value : "all",
    });
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
    if (editing || price == null) return;
    for (const condition of conditions.value) {
      if (
        condition.value === "0" &&
        (condition.type === "priceAbove" || condition.type === "priceBelow")
      ) {
        condition.value = String(Number(defaultPrice(condition.type)));
      }
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => window.clearTimeout(deleteTimer));
onMounted(() => document.querySelector<HTMLInputElement>(".condition-row input")?.focus());
</script>

<template>
  <div class="modal-backdrop" @mousedown.self="closeAlertDialog">
    <form
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="alert-dialog-title"
      @submit.prevent="save"
    >
      <div class="modal-head">
        <div>
          <h2 id="alert-dialog-title">{{ editing ? "编辑提醒" : "新建提醒" }}</h2>
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
            <small :class="toneOf(quote.changePct)">
              {{ formatPercent(quote.changePct) }}
              <i class="trend-mark" aria-hidden="true">{{ directionMark(quote.changePct) }}</i>
            </small>
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
          <span>提醒模板</span>
          <div class="alert-template-grid">
            <button
              v-for="template in templates"
              :key="template.key"
              class="alert-template"
              type="button"
              :disabled="template.disabled"
              @click="applyTemplate(template.key)"
            >
              <strong>{{ template.label }}</strong>
              <small>{{ template.description }}</small>
            </button>
          </div>
        </div>

        <div class="field">
          <div class="condition-heading">
            <span>触发条件</span>
            <small>最多 3 项</small>
          </div>
          <div class="condition-list">
            <div v-for="(condition, index) in conditions" :key="index" class="condition-row">
              <select
                :value="condition.type"
                :aria-label="`第 ${index + 1} 个提醒条件`"
                @change="onConditionTypeChange(index, $event)"
              >
                <option
                  v-for="option in typeOptions"
                  :key="option.key"
                  :value="option.key"
                  :disabled="option.key === 'amountAbove' && asset?.market === 'jj'"
                >
                  {{ option.label }}
                </option>
              </select>
              <div class="input-suffix">
                <input
                  v-model="condition.value"
                  inputmode="decimal"
                  autocomplete="off"
                  :placeholder="placeholderFor(condition.type)"
                  :aria-label="`${typeOptions.find((option) => option.key === condition.type)?.label ?? '提醒'}阈值`"
                />
                <em>{{ unitFor(condition.type) }}</em>
              </div>
              <button
                v-if="conditions.length > 1"
                class="mini-icon danger"
                type="button"
                :aria-label="`删除第 ${index + 1} 个条件`"
                @click="removeCondition(index)"
              >
                <X :size="13" />
              </button>
            </div>
          </div>
          <div class="condition-actions">
            <button
              class="btn btn-small btn-ghost"
              type="button"
              :disabled="conditions.length >= 3"
              @click="addCondition"
            >
              <Plus :size="12" />
              添加条件
            </button>
            <div v-if="conditions.length > 1" class="condition-logic" role="group" aria-label="条件组合方式">
              <button
                type="button"
                :class="{ active: logic === 'all' }"
                :aria-pressed="logic === 'all'"
                @click="logic = 'all'"
              >
                满足全部
              </button>
              <button
                type="button"
                :class="{ active: logic === 'any' }"
                :aria-pressed="logic === 'any'"
                @click="logic = 'any'"
              >
                满足任一
              </button>
            </div>
          </div>
        </div>

        <div class="alert-preview">
          <BellRing :size="13" />
          {{ preview }}
        </div>

        <p v-if="error" class="dialog-note">
          <AlertCircle :size="13" />
          <span class="error-text">{{ error }}</span>
        </p>
        <p v-else class="dialog-note">
          <Info :size="13" />
          <span>提醒只在本机检查，</span>
          <span>
            {{ conditions.length > 1 ? "复合条件" : ALERT_SHORT_LABELS[conditions[0].type] }}触发后写入触发记录。
          </span>
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
