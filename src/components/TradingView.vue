<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import {
  Activity,
  AlertTriangle,
  Bot,
  CircleCheck,
  CircleDollarSign,
  Database,
  FlaskConical,
  Gauge,
  History,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from "lucide-vue-next";
import type { TradingOrderType, TradingSide, TrendPoint } from "../types";
import {
  assetForSymbol,
  cancelPendingTradingOrder,
  evaluateTradingStrategy,
  placeTradingOrder,
  quoteFor,
  resetTradingAccount,
  runTradingBacktest,
  state,
  updateTradingRisk,
  updateTradingStrategy,
  watchlistAssets,
} from "../lib/store";
import {
  calculateTradingStats,
  suggestedTradingQuantity,
} from "../lib/trading";
import { buildOrderPreflight } from "../lib/order-preflight";
import {
  directionMark,
  formatMoney,
  formatPercent,
  formatPrice,
  formatSigned,
  formatTime,
  priceDigits,
  toneOf,
} from "../lib/format";
import PositionValueToggle from "./PositionValueToggle.vue";
import StrategyBlueprints from "./StrategyBlueprints.vue";
import BacktestHistoryDialog from "./BacktestHistoryDialog.vue";
import StrategySensitivityDialog from "./StrategySensitivityDialog.vue";
import TrendChart from "./TrendChart.vue";

const strategyRunning = ref(false);
const backtestRunning = ref(false);
const resetArmed = ref(false);
const historyOpen = ref(false);
const historyTrigger = ref<HTMLButtonElement | null>(null);
const sensitivityOpen = ref(false);
const sensitivityTrigger = ref<HTMLButtonElement | null>(null);
let resetTimer: number | undefined;

const orderSymbol = ref(state.trading.strategy.symbol || watchlistAssets.value[0]?.symbol || "");
const orderSide = ref<TradingSide>("buy");
const orderType = ref<TradingOrderType>("market");
const orderQuantity = ref("");
const limitPrice = ref("");

const strategyAsset = computed(() => (state.trading.strategy.symbol ? assetForSymbol(state.trading.strategy.symbol) : null));
const strategyQuote = computed(() =>
  state.trading.strategy.symbol ? quoteFor(state.trading.strategy.symbol) : undefined,
);
const orderAsset = computed(() => (orderSymbol.value ? assetForSymbol(orderSymbol.value) : null));
const orderQuote = computed(() => (orderSymbol.value ? quoteFor(orderSymbol.value) : undefined));
const orderPosition = computed(() =>
  state.trading.positions.find((position) => position.symbol === orderSymbol.value),
);
const selectedStrategyAction = computed(() => state.trading.strategy.lastAction);
const strategyTone = computed(() => toneOf(selectedStrategyAction.value === "buy" ? 1 : selectedStrategyAction.value === "sell" ? -1 : 0));

const stats = computed(() => calculateTradingStats(state.trading, state.quotes));
const positions = computed(() =>
  state.trading.positions.map((position) => {
    const asset = assetForSymbol(position.symbol);
    const quote = quoteFor(position.symbol);
    const price = quote?.price ?? position.averageCost;
    const value = price * position.quantity;
    const pnl = (price - position.averageCost) * position.quantity;
    return {
      ...position,
      asset,
      quote,
      price,
      value,
      pnl,
      pnlPct: position.averageCost > 0 ? ((price - position.averageCost) / position.averageCost) * 100 : 0,
      digits: priceDigits(asset.kind, price),
    };
  }),
);
const pendingOrders = computed(() => state.trading.orders.filter((order) => order.status === "pending"));
const recentFills = computed(() => state.trading.fills.slice(0, 12));
const recentSignals = computed(() => state.trading.signals.slice(0, 8));
const recentDecisions = computed(() => state.trading.agentDecisions.slice(0, 10));

const equityPoints = computed<TrendPoint[]>(() => {
  const points = state.trading.equityCurve.slice(-160);
  return points.map((point) => ({
    label: formatTime(new Date(point.at).toISOString()).slice(5),
    value: point.equity,
  }));
});
const equityTone = computed(() => toneOf(stats.value.totalPnl));
const equityDigits = computed(() => (stats.value.equity < 10 ? 4 : 2));
const orderPreflight = computed(() => {
  if (!orderAsset.value) return null;
  return buildOrderPreflight({
    asset: orderAsset.value,
    quote: orderQuote.value,
    side: orderSide.value,
    type: orderType.value,
    quantity: Number(orderQuantity.value),
    limitPrice: orderType.value === "limit" ? Number(limitPrice.value) : null,
    ledger: state.trading,
    stats: stats.value,
  });
});
const hasOrderInput = computed(() => Number(orderQuantity.value) > 0);
const estimatedOrder = computed(() => orderPreflight.value?.gross || null);
const orderPreflightTone = computed(() => {
  if (!hasOrderInput.value) return "idle";
  if (!orderPreflight.value?.canSubmit) return "blocked";
  return orderPreflight.value.notes.some((note) => note.tone === "warning")
    ? "warning"
    : "ready";
});
const orderPreflightLabel = computed(() => {
  if (!hasOrderInput.value) return "等待数量";
  if (!orderPreflight.value?.canSubmit) return "需要调整";
  if (orderPreflight.value.notes.some((note) => note.tone === "warning")) return "可提交 · 留意提示";
  return "检查通过";
});
const maxBuyQuantity = computed(() =>
  orderAsset.value && orderQuote.value?.price
    ? suggestedTradingQuantity(orderAsset.value, state.trading.cash, orderQuote.value.price)
    : 0,
);
const quantityHint = computed(() =>
  orderAsset.value?.kind === "fund" ? "场外基金支持两位小数份额" : "股票与 ETF 按 100 股整数倍撮合",
);
const backtestPoints = computed<TrendPoint[]>(() =>
  (state.trading.backtest?.equityCurve ?? []).map((point) => ({
    label: point.label,
    value: point.value,
  })),
);
const backtestVersions = computed(() => {
  const versions = new Map<string, (typeof state.trading.backtestHistory)[number]>();
  if (state.trading.backtest?.symbol === state.trading.strategy.symbol) {
    versions.set(state.trading.backtest.id, state.trading.backtest);
  }
  for (const version of state.trading.backtestHistory) {
    if (version.symbol === state.trading.strategy.symbol) versions.set(version.id, version);
  }
  return [...versions.values()].sort((left, right) => right.ranAt - left.ranAt);
});
const backtestTone = computed(() => toneOf(state.trading.backtest?.totalReturn));
const pipeline = computed(() => [
  { key: "data", label: "数据", icon: Database, status: state.lastUpdated ? "就绪" : "同步中", ready: Boolean(state.lastUpdated) },
  { key: "strategy", label: "策略", icon: Activity, status: state.trading.strategy.lastEvaluatedAt ? "已评估" : "待评估", ready: Boolean(state.trading.strategy.lastEvaluatedAt) },
  { key: "backtest", label: "回测", icon: FlaskConical, status: state.trading.backtest ? "已验证" : "待运行", ready: Boolean(state.trading.backtest) },
  {
    key: "risk",
    label: "风控",
    icon: ShieldCheck,
    status: state.trading.backtest ? (state.trading.backtest.riskPassed ? "通过" : "未通过") : "待检查",
    ready: state.trading.backtest?.riskPassed === true,
  },
  { key: "execution", label: "执行", icon: Send, status: state.trading.strategy.enabled ? "自动" : "手动", ready: state.trading.strategy.enabled },
  { key: "agent", label: "智能体", icon: Bot, status: state.trading.strategy.agentEnabled ? "在线" : "关闭", ready: state.trading.strategy.agentEnabled },
]);
const pipelineReadyCount = computed(() => pipeline.value.filter((stage) => stage.ready).length);
const strategyStatusLabel = computed(() =>
  state.trading.strategy.enabled ? "自动执行" : "手动执行",
);
const positionValuesHidden = computed(() => state.settings.hidePositionValues);
const nextPipelineStage = computed(() =>
  pipeline.value.find((stage) => !stage.ready) ?? pipeline.value[pipeline.value.length - 1],
);

function formatWindowTitle(shortWindow: number, longWindow: number) {
  return `SMA ${shortWindow} / ${longWindow}`;
}

function setStrategyField(field: "shortWindow" | "longWindow" | "orderNotional", event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value)) updateTradingStrategy({ [field]: value });
}

function setStrategySymbol(event: Event) {
  const symbol = (event.target as HTMLSelectElement).value;
  updateTradingStrategy({ symbol });
  orderSymbol.value = symbol;
  if (orderType.value === "limit" && quoteFor(symbol)?.price) {
    limitPrice.value = String(quoteFor(symbol)?.price);
  }
}

function toggleStrategy() {
  updateTradingStrategy({ enabled: !state.trading.strategy.enabled });
}

async function runStrategy() {
  if (strategyRunning.value) return;
  strategyRunning.value = true;
  try {
    await evaluateTradingStrategy(true);
  } finally {
    strategyRunning.value = false;
  }
}

async function runBacktest() {
  if (backtestRunning.value) return;
  backtestRunning.value = true;
  try {
    await runTradingBacktest();
  } finally {
    backtestRunning.value = false;
  }
}

function toggleAgent() {
  updateTradingStrategy({ agentEnabled: !state.trading.strategy.agentEnabled });
}

function setRiskField(field: "maxPositionPct" | "maxDrawdownPct" | "dailyLossLimitPct" | "stopLossPct" | "takeProfitPct", event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value)) updateTradingRisk({ [field]: value });
}

function setOrderSymbol(event: Event) {
  orderSymbol.value = (event.target as HTMLSelectElement).value;
  if (orderType.value === "limit" && orderQuote.value?.price) {
    limitPrice.value = String(orderQuote.value.price);
  }
}

function setOrderType(type: TradingOrderType) {
  orderType.value = type;
  if (type === "limit" && orderQuote.value?.price) {
    limitPrice.value = String(orderQuote.value.price);
  }
}

function useSuggestedQuantity() {
  if (!orderAsset.value || !orderQuote.value?.price) return;
  const quantity = suggestedTradingQuantity(
    orderAsset.value,
    state.trading.strategy.orderNotional,
    orderQuote.value.price,
  );
  orderQuantity.value = String(quantity);
}

function useMaxBuyQuantity() {
  orderQuantity.value = String(maxBuyQuantity.value);
}

function submitOrder() {
  if (!orderSymbol.value) return;
  const result = placeTradingOrder({
    symbol: orderSymbol.value,
    side: orderSide.value,
    type: orderType.value,
    quantity: Number(orderQuantity.value),
    limitPrice: orderType.value === "limit" ? Number(limitPrice.value) : null,
  });
  if (!result.error) orderQuantity.value = "";
}

function requestReset() {
  window.clearTimeout(resetTimer);
  if (resetArmed.value) {
    resetArmed.value = false;
    resetTradingAccount();
    return;
  }
  resetArmed.value = true;
  resetTimer = window.setTimeout(() => {
    resetArmed.value = false;
  }, 4000);
}

function openBacktestHistory() {
  historyOpen.value = true;
}

function closeBacktestHistory() {
  historyOpen.value = false;
  void nextTick(() => historyTrigger.value?.focus());
}

function openSensitivity() {
  sensitivityOpen.value = true;
}

function closeSensitivity() {
  sensitivityOpen.value = false;
  void nextTick(() => sensitivityTrigger.value?.focus());
}

onBeforeUnmount(() => window.clearTimeout(resetTimer));
</script>

<template>
  <section class="trading-view view-page view-trading">
    <div class="view-head">
      <div>
        <p class="eyebrow">Paper Trading</p>
        <h1>量化交易</h1>
        <p class="view-sub">
          <span>本地模拟账户</span>
          <i class="sub-dot" />
          <span>信号与成交全部留痕</span>
          <i class="sub-dot" />
          <span>不连接真实券商</span>
        </p>
      </div>
      <div class="view-actions">
        <button class="btn btn-small btn-ghost" :class="{ 'btn-danger': resetArmed }" type="button" @click="requestReset">
          <RotateCcw :size="14" />
          {{ resetArmed ? "再次点击重置" : "重置模拟账户" }}
        </button>
      </div>
    </div>

    <div class="panel workspace-signal trading-signal">
      <div class="workspace-signal-meta">
        <span>{{ pipelineReadyCount }} / {{ pipeline.length }} 层链路就绪</span>
        <span class="workspace-signal-status"><i aria-hidden="true" />{{ strategyStatusLabel }}</span>
      </div>

      <div class="workspace-signal-board">
        <div class="workspace-signal-core">
          <div class="workspace-signal-core-head">
            <span>模拟权益</span>
            <small>{{ state.trading.strategy.enabled ? "策略运行中" : "本地模拟账户" }}</small>
          </div>
          <strong>¥{{ formatMoney(stats.equity) }}</strong>
          <div class="workspace-signal-core-foot">
            <span :class="toneOf(stats.totalPnl)">
              {{ formatSigned(stats.totalPnl) }}
              · {{ formatPercent(stats.totalReturn) }}
              {{ directionMark(stats.totalReturn) }}
            </span>
            <span>今日 {{ formatSigned(stats.todayPnl) }}</span>
          </div>
        </div>

        <div class="workspace-signal-side">
          <div class="workspace-signal-mini">
            <span>可用资金</span>
            <strong>¥{{ formatMoney(state.trading.cash) }}</strong>
            <small>初始 ¥{{ formatMoney(state.trading.initialCapital, 0) }}</small>
          </div>
          <div class="workspace-signal-mini">
            <span>最大回撤</span>
            <strong>{{ stats.maxDrawdown.toFixed(2) }}%</strong>
            <small>{{ state.trading.backtest?.riskPassed ? "风控已通过" : "待回测确认" }}</small>
          </div>
        </div>
      </div>

      <div class="workspace-signal-facts">
        <span>持仓市值</span>
        <strong :aria-label="positionValuesHidden ? '持仓市值已隐藏' : undefined">
          {{ positionValuesHidden ? "••••" : `¥${formatMoney(stats.marketValue)}` }}
        </strong>
        <i aria-hidden="true" />
        <span>胜率</span>
        <strong>{{ stats.winRate == null ? "--" : `${stats.winRate.toFixed(1)}%` }}</strong>
        <i aria-hidden="true" />
        <span>累计费用</span>
        <strong>¥{{ formatMoney(stats.fees) }}</strong>
      </div>

      <button
        class="workspace-signal-action"
        type="button"
        :disabled="strategyRunning"
        :aria-busy="strategyRunning"
        @click="runStrategy"
      >
        <span class="workspace-signal-action-icon" aria-hidden="true"><Play :size="17" /></span>
        <span>
          <strong>{{ strategyRunning ? "正在评估策略" : "立即评估当前策略" }}</strong>
          <small>{{ state.trading.strategy.lastReason }}</small>
        </span>
        <span class="workspace-signal-action-cta">{{ strategyRunning ? "计算中" : "运行策略" }}</span>
      </button>
    </div>

    <div
      class="panel quant-pipeline"
      :class="{ running: strategyRunning || backtestRunning }"
      :aria-busy="strategyRunning || backtestRunning"
      :aria-label="`量化系统六层链路，下一步${nextPipelineStage.label}`"
    >
      <div
        v-for="(stage, index) in pipeline"
        :key="stage.key"
        class="pipeline-stage"
        :class="{ ready: stage.ready, next: stage.key === nextPipelineStage.key }"
      >
        <span class="pipeline-icon"><component :is="stage.icon" :size="14" /></span>
        <span>
          <strong>{{ stage.label }}</strong>
          <small>{{ stage.status }}</small>
        </span>
        <i v-if="index < pipeline.length - 1" aria-hidden="true">→</i>
      </div>
    </div>

    <div class="trading-grid">
      <div class="panel strategy-panel">
        <div class="panel-head">
          <div>
            <h2>均线交叉策略</h2>
            <p>短均线上穿买入，下穿卖出；启用后随行情自动提交模拟市价单</p>
          </div>
          <div class="strategy-switches">
            <span>
              <small>自动执行</small>
              <button
                class="toggle"
                :class="{ on: state.trading.strategy.enabled }"
                type="button"
                role="switch"
                :aria-checked="state.trading.strategy.enabled"
                aria-label="自动执行策略信号"
                @click="toggleStrategy"
              />
            </span>
            <span>
              <small>智能体</small>
              <button
                class="toggle"
                :class="{ on: state.trading.strategy.agentEnabled }"
                type="button"
                role="switch"
                :aria-checked="state.trading.strategy.agentEnabled"
                aria-label="启用交易智能体"
                @click="toggleAgent"
              />
            </span>
          </div>
        </div>
        <StrategyBlueprints :disabled="strategyRunning" />
        <div class="strategy-body">
          <div class="strategy-summary">
            <span class="strategy-badge" :class="strategyTone">
              <TrendingUp v-if="selectedStrategyAction === 'buy'" :size="14" />
              <TrendingDown v-else-if="selectedStrategyAction === 'sell'" :size="14" />
              <Activity v-else :size="14" />
              {{ selectedStrategyAction === "buy" ? "买入信号" : selectedStrategyAction === "sell" ? "卖出信号" : "等待信号" }}
            </span>
            <strong>{{ formatWindowTitle(state.trading.strategy.shortWindow, state.trading.strategy.longWindow) }}</strong>
            <p>{{ state.trading.strategy.lastReason }}</p>
          </div>
          <div class="strategy-fields">
            <label class="field">
              <span>策略标的</span>
              <select :value="state.trading.strategy.symbol" aria-label="策略标的" @change="setStrategySymbol">
                <option v-for="asset in watchlistAssets" :key="asset.symbol" :value="asset.symbol">
                  {{ asset.name }}
                </option>
              </select>
            </label>
            <label class="field">
              <span>短均线</span>
              <input
                type="number"
                inputmode="numeric"
                min="2"
                max="60"
                :value="state.trading.strategy.shortWindow"
                aria-label="短均线窗口"
                @change="setStrategyField('shortWindow', $event)"
              />
            </label>
            <label class="field">
              <span>长均线</span>
              <input
                type="number"
                inputmode="numeric"
                min="3"
                max="240"
                :value="state.trading.strategy.longWindow"
                aria-label="长均线窗口"
                @change="setStrategyField('longWindow', $event)"
              />
            </label>
            <label class="field">
              <span>单次金额</span>
              <div class="input-suffix">
                <input
                  type="number"
                  inputmode="decimal"
                  min="1000"
                  :value="state.trading.strategy.orderNotional"
                  aria-label="单次委托金额"
                  @change="setStrategyField('orderNotional', $event)"
                />
                <em>元</em>
              </div>
            </label>
          </div>
          <div class="strategy-foot">
            <span v-if="strategyQuote?.price">
              现价 {{ formatPrice(strategyQuote.price, priceDigits(strategyAsset?.kind ?? "stock", strategyQuote.price)) }}
              · 短均线 {{ state.trading.strategy.lastShortMa?.toFixed(2) ?? "--" }}
              · 长均线 {{ state.trading.strategy.lastLongMa?.toFixed(2) ?? "--" }}
            </span>
            <button class="btn btn-small" type="button" :disabled="strategyRunning" @click="runStrategy">
              <Play :size="12" />
              {{ strategyRunning ? "计算中" : "立即评估" }}
            </button>
          </div>
        </div>
      </div>

      <div class="panel order-ticket">
        <div class="panel-head">
          <div>
            <h2>手动委托</h2>
            <p>市价单即时撮合，限价单等待行情触价</p>
          </div>
          <span class="chip">
            <ShieldCheck :size="11" />
            模拟
          </span>
        </div>
        <div class="order-body">
          <label class="field">
            <span>标的</span>
            <select :value="orderSymbol" aria-label="委托标的" @change="setOrderSymbol">
              <option v-for="asset in watchlistAssets" :key="asset.symbol" :value="asset.symbol">
                {{ asset.name }} · {{ asset.code }}
              </option>
            </select>
          </label>
          <div class="order-segments">
            <div class="segmented" role="group" aria-label="买卖方向">
              <button type="button" :class="{ active: orderSide === 'buy' }" @click="orderSide = 'buy'">买入</button>
              <button type="button" :class="{ active: orderSide === 'sell' }" @click="orderSide = 'sell'">卖出</button>
            </div>
            <div class="segmented" role="group" aria-label="委托类型">
              <button type="button" :class="{ active: orderType === 'market' }" @click="setOrderType('market')">市价</button>
              <button type="button" :class="{ active: orderType === 'limit' }" @click="setOrderType('limit')">限价</button>
            </div>
          </div>
          <label class="field">
            <span>数量</span>
            <div class="input-suffix">
              <input
                v-model="orderQuantity"
                inputmode="decimal"
                :placeholder="orderAsset?.kind === 'fund' ? '0.00' : '100'"
                aria-label="委托数量"
              />
              <em>{{ orderAsset?.kind === "fund" ? "份" : "股" }}</em>
            </div>
            <small>{{ quantityHint }}</small>
          </label>
          <label v-if="orderType === 'limit'" class="field">
            <span>限价</span>
            <div class="input-suffix">
              <input v-model="limitPrice" inputmode="decimal" aria-label="限价" />
              <em>元</em>
            </div>
          </label>
          <div class="order-quick">
            <button type="button" @click="useSuggestedQuantity">按策略金额</button>
            <button v-if="orderSide === 'buy'" type="button" @click="useMaxBuyQuantity">可用资金上限</button>
            <button v-else type="button" @click="orderQuantity = String(orderPosition?.quantity ?? 0)">全部持仓</button>
          </div>
          <div class="order-summary">
            <span>预计金额</span>
            <strong>¥{{ estimatedOrder == null ? "--" : formatMoney(estimatedOrder) }}</strong>
            <small v-if="orderSide === 'buy'">可用 ¥{{ formatMoney(state.trading.cash) }}</small>
            <small v-else>可卖 {{ orderPosition?.quantity ?? 0 }} {{ orderAsset?.kind === "fund" ? "份" : "股" }}</small>
          </div>
          <div class="order-preflight" :class="orderPreflightTone">
            <div class="order-preflight-head">
              <span>
                <CircleCheck v-if="orderPreflightTone === 'ready'" :size="13" aria-hidden="true" />
                <AlertTriangle v-else-if="orderPreflightTone !== 'idle'" :size="13" aria-hidden="true" />
                <ShieldCheck v-else :size="13" aria-hidden="true" />
                下单预检
              </span>
              <strong role="status" aria-live="polite">{{ orderPreflightLabel }}</strong>
            </div>
            <div v-if="hasOrderInput && orderPreflight" class="order-preflight-grid">
              <div>
                <span>预计手续费</span>
                <strong>¥{{ formatMoney(orderPreflight.fee) }}</strong>
              </div>
              <div>
                <span>成交后仓位</span>
                <strong>{{ orderPreflight.projectedExposurePct.toFixed(1) }}%</strong>
              </div>
              <div>
                <span>{{ orderSide === "buy" ? "成交后资金" : "成交后持仓" }}</span>
                <strong>
                  {{
                    orderSide === "buy"
                      ? `¥${formatMoney(Math.max(0, orderPreflight.cashAfter))}`
                      : `${orderPreflight.positionAfter} ${orderAsset?.kind === "fund" ? "份" : "股"}`
                  }}
                </strong>
              </div>
            </div>
            <p v-else class="order-preflight-hint">填写数量后检查资金、仓位和手续费。</p>
            <ul v-if="hasOrderInput && orderPreflight?.notes.length" class="order-preflight-notes">
              <li v-for="note in orderPreflight.notes" :key="`${note.tone}-${note.message}`" :class="note.tone">
                <AlertTriangle v-if="note.tone !== 'info'" :size="11" aria-hidden="true" />
                <span>{{ note.message }}</span>
              </li>
            </ul>
            <small>预检按当前价与模拟费率估算，限额单按限价计算。</small>
          </div>
          <button
            class="btn btn-gold order-submit"
            type="button"
            :disabled="!orderQuote?.price || !orderPreflight?.canSubmit"
            @click="submitOrder"
          >
            <Send :size="14" />
            提交{{ orderSide === "buy" ? "买入" : "卖出" }}
          </button>
        </div>
      </div>
    </div>

    <div class="quant-control-grid">
      <div class="panel backtest-panel">
        <div class="panel-head">
          <div>
            <h2>历史回测</h2>
            <p>使用近一年日线收盘价、当前均线窗口和费用模型，无未来数据</p>
          </div>
        </div>
        <div class="backtest-research-bar">
          <span>
            <SlidersHorizontal :size="12" aria-hidden="true" />
            研究工具
          </span>
          <div class="backtest-research-actions">
            <button
              ref="historyTrigger"
              class="btn btn-small btn-ghost"
              type="button"
              :disabled="backtestVersions.length < 2"
              :title="backtestVersions.length < 2 ? '至少保存两次回测后可对比' : '对比历史回测版本'"
              @click="openBacktestHistory"
            >
              <History :size="12" />
              版本 {{ backtestVersions.length }}
            </button>
            <button
              ref="sensitivityTrigger"
              class="btn btn-small btn-ghost"
              type="button"
              :disabled="!strategyAsset"
              @click="openSensitivity"
            >
              <SlidersHorizontal :size="12" />
              参数扫描
            </button>
            <button class="btn btn-small" type="button" :disabled="backtestRunning" @click="runBacktest">
              <FlaskConical :size="12" />
              {{ backtestRunning ? "回测中" : "运行回测" }}
            </button>
          </div>
        </div>
        <div v-if="!state.trading.backtest" class="empty backtest-empty">
          <FlaskConical :size="22" :stroke-width="1.5" />
          <strong>尚未运行回测</strong>
          <p>智能体在执行买入信号前，会先检查回测收益和最大回撤。</p>
        </div>
        <template v-else>
          <div class="backtest-metrics">
            <div>
              <span>总收益</span>
              <strong :class="backtestTone">{{ formatPercent(state.trading.backtest.totalReturn) }} {{ directionMark(state.trading.backtest.totalReturn) }}</strong>
            </div>
            <div>
              <span>最大回撤</span>
              <strong>{{ state.trading.backtest.maxDrawdown.toFixed(2) }}%</strong>
            </div>
            <div>
              <span>胜率</span>
              <strong>{{ state.trading.backtest.winRate == null ? "--" : `${state.trading.backtest.winRate.toFixed(1)}%` }}</strong>
            </div>
            <div>
              <span>交易次数</span>
              <strong>{{ state.trading.backtest.tradeCount }}</strong>
            </div>
            <div>
              <span>风控结论</span>
              <strong :class="state.trading.backtest.riskPassed ? 'down' : 'up'">
                {{ state.trading.backtest.riskPassed ? "通过" : "不通过" }}
              </strong>
            </div>
          </div>
          <TrendChart
            :points="backtestPoints"
            :tone="backtestTone"
            :digits="2"
            label="均线策略历史回测权益曲线"
          />
        </template>
      </div>

      <div class="panel risk-panel">
        <div class="panel-head">
          <div>
            <h2>风控参数</h2>
            <p>约束仓位、回撤、单日亏损和自动止盈止损</p>
          </div>
          <span class="chip">
            <Gauge :size="11" />
            实时
          </span>
        </div>
        <div class="risk-fields">
          <label class="field">
            <span>最大仓位</span>
            <div class="input-suffix">
              <input type="number" min="1" max="100" :value="state.trading.risk.maxPositionPct" aria-label="最大仓位百分比" @change="setRiskField('maxPositionPct', $event)" />
              <em>%</em>
            </div>
          </label>
          <label class="field">
            <span>最大回撤</span>
            <div class="input-suffix">
              <input type="number" min="1" max="80" :value="state.trading.risk.maxDrawdownPct" aria-label="最大回撤百分比" @change="setRiskField('maxDrawdownPct', $event)" />
              <em>%</em>
            </div>
          </label>
          <label class="field">
            <span>单日亏损上限</span>
            <div class="input-suffix">
              <input type="number" min="0.5" max="30" :value="state.trading.risk.dailyLossLimitPct" aria-label="单日亏损上限百分比" @change="setRiskField('dailyLossLimitPct', $event)" />
              <em>%</em>
            </div>
          </label>
          <label class="field">
            <span>止损线</span>
            <div class="input-suffix">
              <input type="number" min="0.5" max="50" :value="state.trading.risk.stopLossPct" aria-label="止损百分比" @change="setRiskField('stopLossPct', $event)" />
              <em>%</em>
            </div>
          </label>
          <label class="field">
            <span>止盈线</span>
            <div class="input-suffix">
              <input type="number" min="1" max="200" :value="state.trading.risk.takeProfitPct" aria-label="止盈百分比" @change="setRiskField('takeProfitPct', $event)" />
              <em>%</em>
            </div>
          </label>
        </div>
        <div class="risk-status">
          <ShieldCheck :size="14" />
          <span>
            当前回撤 {{ stats.maxDrawdown.toFixed(2) }}% ·
            {{ stats.todayPnl < -(stats.equity * state.trading.risk.dailyLossLimitPct) / 100 ? "单日亏损已触线" : "单日亏损未触线" }}
          </span>
        </div>
      </div>
    </div>

    <div class="panel trading-positions">
      <div class="panel-head">
        <div>
          <h2>模拟持仓</h2>
          <p>按最新行情估算；平均成本已包含买入费用</p>
        </div>
        <div class="panel-head-actions">
          <PositionValueToggle />
          <span class="chip">
            <Wallet :size="11" />
            {{ positions.length }} 个标的
          </span>
        </div>
      </div>
      <div v-if="!positions.length" class="empty trading-empty">
        <CircleDollarSign :size="22" :stroke-width="1.5" />
        <strong>暂无模拟持仓</strong>
        <p>运行策略或提交第一笔模拟委托后，持仓和盈亏会显示在这里。</p>
      </div>
      <div v-else class="trading-table">
        <div class="trading-row head">
          <span>标的</span>
          <span class="align-right">数量</span>
          <span class="align-right">均价</span>
          <span class="align-right">现价</span>
          <span class="align-right">市值</span>
          <span class="align-right">浮动盈亏</span>
        </div>
        <div v-for="row in positions" :key="row.symbol" class="trading-row">
          <span class="trading-symbol">
            <strong>{{ row.asset.name }}</strong>
            <small>{{ row.asset.code }} · {{ row.asset.typeLabel }}</small>
          </span>
          <span class="align-right mono" data-label="数量">{{ positionValuesHidden ? "••••" : row.quantity }}</span>
          <span class="align-right mono" data-label="均价">{{ formatPrice(row.averageCost, row.digits) }}</span>
          <span class="align-right mono" data-label="现价">{{ formatPrice(row.price, row.digits) }}</span>
          <span class="align-right mono" data-label="市值">{{ positionValuesHidden ? "••••" : `¥${formatMoney(row.value)}` }}</span>
          <span class="align-right mono" data-label="浮动盈亏" :class="positionValuesHidden ? undefined : toneOf(row.pnl)">
            {{ positionValuesHidden ? "••••" : formatSigned(row.pnl) }}
            <small>{{ formatPercent(row.pnlPct) }} {{ directionMark(row.pnlPct) }}</small>
          </span>
        </div>
      </div>
    </div>

    <div class="panel agent-panel">
      <div class="panel-head">
        <div>
          <h2>智能体决策</h2>
          <p>规则型交易代理结合信号、回测、仓位和回撤，对自动执行进行裁决</p>
        </div>
        <span class="chip">
          <Bot :size="11" />
          {{ state.trading.strategy.agentEnabled ? "在线" : "已关闭" }}
        </span>
      </div>
      <div v-if="!recentDecisions.length" class="empty agent-empty">
        <Bot :size="21" :stroke-width="1.5" />
        <strong>暂无智能体决策</strong>
        <p>启用自动执行后，交叉信号会先经过智能体与风控裁决。</p>
      </div>
      <div v-else class="agent-list">
        <div v-for="decision in recentDecisions" :key="decision.id" class="agent-row">
          <span class="agent-action" :class="decision.action">
            {{ decision.action === "execute" ? "执行" : decision.action === "reduce" ? "减仓" : decision.action === "block" ? "阻断" : "观察" }}
          </span>
          <span class="agent-copy">
            <strong>{{ assetForSymbol(decision.symbol).name }} · 置信度 {{ decision.confidence.toFixed(0) }}%</strong>
            <small>{{ decision.reason }}</small>
          </span>
          <span class="agent-flags">{{ decision.riskFlags.length ? decision.riskFlags.join(" · ") : "无风控告警" }}</span>
          <span class="mono">{{ formatTime(new Date(decision.at).toISOString()).slice(5) }}</span>
        </div>
      </div>
    </div>

    <div class="trading-lower-grid">
      <div class="panel equity-panel">
        <div class="panel-head">
          <div>
            <h2>权益曲线</h2>
            <p>账户总权益按行情刷新记录，最多保留最近 2000 个点</p>
          </div>
          <strong class="mono" :class="equityTone">¥{{ formatMoney(stats.equity) }}</strong>
        </div>
        <TrendChart
          :points="equityPoints"
          :tone="equityTone"
          :digits="equityDigits"
          label="模拟账户权益曲线"
        />
      </div>

      <div class="panel signal-panel">
        <div class="panel-head">
          <div>
            <h2>信号留痕</h2>
            <p>只记录实际交叉信号，空仓等待不会污染历史</p>
          </div>
        </div>
        <div v-if="!recentSignals.length" class="empty signal-empty">
          <Activity :size="20" :stroke-width="1.5" />
          <strong>暂无交叉信号</strong>
          <p>策略评估出现短长均线交叉后，会在这里留下记录。</p>
        </div>
        <div v-else class="signal-list">
          <div v-for="signal in recentSignals" :key="signal.id" class="signal-row">
            <span class="signal-action" :class="toneOf(signal.action === 'buy' ? 1 : -1)">
              {{ signal.action === "buy" ? "买" : "卖" }}
            </span>
            <span>
              <strong>{{ assetForSymbol(signal.symbol).name }}</strong>
              <small>{{ signal.reason }}</small>
            </span>
            <span class="mono">{{ formatTime(new Date(signal.at).toISOString()).slice(5) }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="trading-lower-grid">
      <div class="panel fills-panel">
        <div class="panel-head">
          <div>
            <h2>成交记录</h2>
            <p>最近 {{ recentFills.length }} 笔撮合</p>
          </div>
        </div>
        <div v-if="!recentFills.length" class="empty fills-empty">
          <CircleDollarSign :size="20" :stroke-width="1.5" />
          <strong>暂无成交</strong>
          <p>市价单或触价限价单成交后会记录价格、数量和费用。</p>
        </div>
        <div v-else class="fill-list">
          <div v-for="fill in recentFills" :key="fill.id" class="fill-row">
            <span class="fill-side" :class="toneOf(fill.side === 'buy' ? 1 : -1)">
              {{ fill.side === "buy" ? "买" : "卖" }}
            </span>
            <span>
              <strong>{{ assetForSymbol(fill.symbol).name }}</strong>
              <small>{{ fill.quantity }} {{ assetForSymbol(fill.symbol).kind === "fund" ? "份" : "股" }}</small>
            </span>
            <span class="mono">{{ formatPrice(fill.price, priceDigits(assetForSymbol(fill.symbol).kind, fill.price)) }}</span>
            <span class="mono">费 ¥{{ fill.fee.toFixed(2) }}</span>
            <span class="mono">{{ formatTime(new Date(fill.at).toISOString()).slice(5) }}</span>
          </div>
        </div>
      </div>

      <div class="panel pending-panel">
        <div class="panel-head">
          <div>
            <h2>待成交委托</h2>
            <p>行情刷新时自动检查限价条件</p>
          </div>
        </div>
        <div v-if="!pendingOrders.length" class="empty pending-empty">
          <Activity :size="20" :stroke-width="1.5" />
          <strong>没有待成交委托</strong>
          <p>提交限价单后，可在行情触价前撤销。</p>
        </div>
        <div v-else class="pending-list">
          <div v-for="order in pendingOrders" :key="order.id" class="pending-row">
            <span>
              <strong>{{ assetForSymbol(order.symbol).name }}</strong>
              <small>
                {{ order.side === "buy" ? "买入" : "卖出" }} {{ order.quantity }} @
                {{ formatPrice(order.limitPrice, priceDigits(assetForSymbol(order.symbol).kind, order.limitPrice)) }}
              </small>
            </span>
            <button class="mini-icon danger" type="button" aria-label="撤销委托" @click="cancelPendingTradingOrder(order.id)">
              <X :size="13" />
            </button>
          </div>
        </div>
      </div>
    </div>
    <BacktestHistoryDialog
      v-if="historyOpen"
      :versions="backtestVersions"
      :asset-name="strategyAsset?.name ?? '当前标的'"
      :risk="state.trading.risk"
      @close="closeBacktestHistory"
    />
    <StrategySensitivityDialog
      v-if="sensitivityOpen && strategyAsset"
      :asset="strategyAsset"
      @close="closeSensitivity"
    />
  </section>
</template>
