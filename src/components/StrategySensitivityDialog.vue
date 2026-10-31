<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Activity,
  Check,
  Info,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-vue-next";
import type { Asset, TrendPoint, TrendRange } from "../types";
import { fetchTrend } from "../lib/backend";
import { formatPercent } from "../lib/format";
import {
  runMonteCarloBacktest,
  type MonteCarloResult,
} from "../lib/monte-carlo";
import { showToast, state, storeTradingBacktest, updateTradingStrategy } from "../lib/store";
import {
  buildSensitivityGrid,
  sensitivityValue,
  type SensitivityCell,
  type SensitivityMetric,
} from "../lib/trading-sensitivity";
import MonteCarloFanChart from "./MonteCarloFanChart.vue";

type ScanRange = Extract<TrendRange, "3m" | "day" | "1y">;
type LabTab = "map" | "robustness";

const props = defineProps<{ asset: Asset }>();
const emit = defineEmits<{ close: [] }>();

const points = ref<TrendPoint[]>([]);
const loading = ref(true);
const error = ref("");
const metric = ref<SensitivityMetric>("score");
const scanRange = ref<ScanRange>("1y");
const activeTab = ref<LabTab>("map");
const selectedKey = ref<string | null>(null);
const monteCarlo = ref<MonteCarloResult | null>(null);
const monteCarloRunning = ref(false);
const monteCarloSeed = ref(20_261_031);
const dialog = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
let loadRequest = 0;
let monteCarloRequest = 0;

const rangeOptions: { key: ScanRange; label: string }[] = [
  { key: "3m", label: "3 个月" },
  { key: "day", label: "6 个月" },
  { key: "1y", label: "1 年" },
];
const metricOptions: { key: SensitivityMetric; label: string }[] = [
  { key: "return", label: "收益" },
  { key: "drawdown", label: "回撤" },
  { key: "score", label: "综合分" },
];

const grid = computed(() =>
  points.value.length
    ? buildSensitivityGrid(
        points.value,
        state.trading.strategy,
        props.asset,
        state.trading.risk,
        state.trading.initialCapital,
      )
    : null,
);
const rankedCells = computed(() =>
  [...(grid.value?.cells ?? [])]
    .filter((cell) => cell.valid)
    .sort(
      (left, right) =>
        (sensitivityValue(right, metric.value) ?? Number.NEGATIVE_INFINITY) -
        (sensitivityValue(left, metric.value) ?? Number.NEGATIVE_INFINITY),
    ),
);
const bestCell = computed(() => rankedCells.value[0] ?? null);
const selectedCell = computed(() =>
  grid.value?.cells.find((cell) => cellKey(cell) === selectedKey.value) ?? null,
);
const maxMagnitude = computed(() =>
  Math.max(
    ...(grid.value?.cells.flatMap((cell) => {
      const value = sensitivityValue(cell, metric.value);
      return value == null ? [] : [Math.abs(value)];
    }) ?? [1]),
    0.01,
  ),
);
const monteCarloTone = computed(() => {
  if (monteCarlo.value?.grade === "稳健") return "steady";
  if (monteCarlo.value?.grade === "观察") return "watch";
  return "fragile";
});

function cellKey(cell: SensitivityCell) {
  return `${cell.shortWindow}:${cell.longWindow}`;
}

function cellValue(cell: SensitivityCell) {
  return sensitivityValue(cell, metric.value);
}

function cellHeat(cell: SensitivityCell) {
  const value = cellValue(cell);
  if (value == null) return 0;
  return Math.min(1, Math.abs(value) / maxMagnitude.value);
}

function cellTone(cell: SensitivityCell) {
  const value = cellValue(cell);
  if (value == null) return "invalid";
  if (metric.value === "drawdown") return "risk";
  return value > 0 ? "up" : value < 0 ? "down" : "flat";
}

function selectCell(cell: SensitivityCell) {
  if (!cell.valid) return;
  selectedKey.value = cellKey(cell);
  if (activeTab.value === "robustness") void runMonteCarlo();
}

async function loadGrid() {
  const request = ++loadRequest;
  loading.value = true;
  error.value = "";
  monteCarlo.value = null;
  try {
    const nextPoints = await fetchTrend(props.asset, scanRange.value);
    if (request !== loadRequest) return;
    points.value = nextPoints;
    await nextTick();
    if (request !== loadRequest) return;
    selectedKey.value = bestCell.value ? cellKey(bestCell.value) : null;
    if (activeTab.value === "robustness") void runMonteCarlo();
  } catch (cause) {
    if (request !== loadRequest) return;
    console.warn("参数敏感性分析加载失败", cause);
    points.value = [];
    selectedKey.value = null;
    error.value = "该区间走势暂时无法加载";
  } finally {
    if (request === loadRequest) loading.value = false;
  }
}

function setRange(range: ScanRange) {
  if (range === scanRange.value) return;
  scanRange.value = range;
  void loadGrid();
}

function setTab(tab: LabTab) {
  activeTab.value = tab;
  if (tab === "robustness") void runMonteCarlo();
}

async function runMonteCarlo() {
  const cell = selectedCell.value;
  if (!cell?.result) {
    monteCarlo.value = null;
    return;
  }
  const request = ++monteCarloRequest;
  const selected = cellKey(cell);
  monteCarloRunning.value = true;
  await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
  if (request !== monteCarloRequest) return;
  const next = runMonteCarloBacktest(cell.result, {
    simulations: 1_000,
    horizon: cell.result.equityCurve.length - 1,
    seed: monteCarloSeed.value,
    riskDrawdownPct: state.trading.risk.maxDrawdownPct,
  });
  if (request === monteCarloRequest && selectedKey.value === selected) {
    monteCarlo.value = next;
    monteCarloRunning.value = false;
  }
}

function rerunMonteCarlo() {
  monteCarloSeed.value += 7_919;
  void runMonteCarlo();
}

function applySelected() {
  const cell = selectedCell.value;
  if (!cell?.result) return;
  updateTradingStrategy({
    symbol: props.asset.symbol,
    shortWindow: cell.shortWindow,
    longWindow: cell.longWindow,
  });
  storeTradingBacktest(cell.result);
  showToast(
    `已应用 SMA ${cell.shortWindow}/${cell.longWindow}，并保存本次样本内回测`,
    "success",
  );
  emit("close");
}

function close() {
  emit("close");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== "Tab" || !dialog.value) return;
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>(
    'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(bestCell, (best) => {
  if (best && !selectedCell.value) selectedKey.value = cellKey(best);
});

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  void loadGrid();
  void nextTick(() => closeButton.value?.focus());
});

onBeforeUnmount(() => {
  loadRequest += 1;
  monteCarloRequest += 1;
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div class="sensitivity-backdrop" @mousedown.self="close">
      <section
        ref="dialog"
        class="sensitivity-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sensitivity-title"
      >
        <header class="sensitivity-head">
          <div>
            <div class="sensitivity-title-row">
              <Activity :size="15" aria-hidden="true" />
              <h2 id="sensitivity-title">策略参数实验室</h2>
            </div>
            <p>{{ asset.name }} · {{ scanRange === "3m" ? "近 3 个月" : scanRange === "day" ? "近 6 个月" : "近一年" }} · 本地复算</p>
          </div>
          <button ref="closeButton" class="icon-btn" type="button" aria-label="关闭策略参数实验室" @click="close">
            <X :size="17" />
          </button>
        </header>

        <div class="sensitivity-commandbar">
          <div class="segmented scan-ranges" role="group" aria-label="参数扫描区间">
            <button
              v-for="option in rangeOptions"
              :key="option.key"
              type="button"
              :class="{ active: scanRange === option.key }"
              :aria-pressed="scanRange === option.key"
              @click="setRange(option.key)"
            >
              {{ option.label }}
            </button>
          </div>
          <div class="lab-tabs" role="tablist" aria-label="策略研究视图">
            <button
              type="button"
              role="tab"
              :aria-selected="activeTab === 'map'"
              :class="{ active: activeTab === 'map' }"
              @click="setTab('map')"
            >
              <SlidersHorizontal :size="12" aria-hidden="true" />
              参数地图
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="activeTab === 'robustness'"
              :class="{ active: activeTab === 'robustness' }"
              @click="setTab('robustness')"
            >
              <ShieldCheck :size="12" aria-hidden="true" />
              稳健性
            </button>
          </div>
        </div>

        <div class="sensitivity-body">
          <div v-if="loading" class="sensitivity-loading" role="status" aria-live="polite">
            <span>正在扫描 {{ scanRange === "3m" ? "3 个月" : scanRange === "day" ? "6 个月" : "一年" }}均线组合</span>
            <i /><i /><i />
          </div>
          <div v-else-if="error" class="sensitivity-empty" role="alert">
            <strong>暂时无法分析</strong>
            <p>{{ error }}</p>
            <button class="btn btn-small" type="button" @click="loadGrid">重试</button>
          </div>
          <template v-else-if="grid">
            <template v-if="activeTab === 'map'">
              <div class="sensitivity-toolbar">
                <div>
                  <strong>短均线 × 长均线</strong>
                  <span v-if="bestCell">当前最优 SMA {{ bestCell.shortWindow }} / {{ bestCell.longWindow }}</span>
                </div>
                <div class="segmented sensitivity-metrics" role="group" aria-label="热力图指标">
                  <button
                    v-for="option in metricOptions"
                    :key="option.key"
                    type="button"
                    :class="{ active: metric === option.key }"
                    :aria-pressed="metric === option.key"
                    @click="metric = option.key"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>

              <div
                class="sensitivity-matrix"
                :style="{ '--long-count': grid.longWindows.length }"
                role="group"
                aria-label="均线参数敏感性矩阵"
              >
                <span class="matrix-corner" aria-hidden="true">短 / 长</span>
                <span v-for="longWindow in grid.longWindows" :key="`col-${longWindow}`" class="matrix-axis">
                  {{ longWindow }}
                </span>
                <template v-for="shortWindow in grid.shortWindows" :key="`row-${shortWindow}`">
                  <span class="matrix-axis">{{ shortWindow }}</span>
                  <button
                    v-for="cell in grid.cells.filter((item) => item.shortWindow === shortWindow)"
                    :key="cellKey(cell)"
                    class="sensitivity-cell"
                    :class="[
                      cellTone(cell),
                      {
                        selected: selectedKey === cellKey(cell),
                        best: bestCell?.shortWindow === cell.shortWindow && bestCell?.longWindow === cell.longWindow,
                      },
                    ]"
                    :style="{ '--heat': cellHeat(cell) }"
                    type="button"
                    :disabled="!cell.valid"
                    :aria-pressed="selectedKey === cellKey(cell)"
                    :aria-label="
                      cell.result
                        ? `SMA ${cell.shortWindow}/${cell.longWindow}，收益 ${formatPercent(cell.result.totalReturn)}，最大回撤 ${cell.result.maxDrawdown.toFixed(2)}%，综合分 ${cell.score.toFixed(2)}`
                        : `SMA ${cell.shortWindow}/${cell.longWindow} 参数无效`
                    "
                    @click="selectCell(cell)"
                  >
                    <template v-if="cell.result">
                      <strong>{{ formatPercent(cellValue(cell) ?? 0) }}</strong>
                      <small>回撤 {{ cell.result.maxDrawdown.toFixed(1) }}%</small>
                      <Check
                        v-if="bestCell?.shortWindow === cell.shortWindow && bestCell?.longWindow === cell.longWindow"
                        :size="11"
                        aria-hidden="true"
                      />
                    </template>
                    <span v-else aria-hidden="true">—</span>
                  </button>
                </template>
              </div>

              <p class="sensitivity-note">
                <Info :size="13" aria-hidden="true" />
                综合分 = 样本内收益 − 0.5 × 最大回撤。相邻格差异越小，参数敏感度通常越低。
              </p>
            </template>

            <template v-else>
              <section class="mc-head">
                <div>
                  <span>当前检验</span>
                  <strong v-if="selectedCell">SMA {{ selectedCell.shortWindow }} / {{ selectedCell.longWindow }}</strong>
                  <p>历史权益日收益有放回重抽样，同周期运行 1,000 次</p>
                </div>
                <button
                  class="btn btn-small btn-ghost"
                  type="button"
                  :disabled="monteCarloRunning || !selectedCell"
                  @click="rerunMonteCarlo"
                >
                  <RefreshCw :size="12" :class="{ spinning: monteCarloRunning }" />
                  重新抽样
                </button>
              </section>

              <div v-if="monteCarloRunning" class="mc-loading" role="status" aria-live="polite">
                <i />
                <strong>正在生成 1,000 条稳健性路径</strong>
                <span>从 {{ selectedCell?.result?.equityCurve.length ?? 0 }} 个权益节点中重抽样</span>
              </div>
              <div v-else-if="monteCarlo" class="mc-results">
                <div class="mc-verdict" :class="monteCarloTone">
                  <div>
                    <span>稳健性判断</span>
                    <strong>{{ monteCarlo.grade }}</strong>
                  </div>
                  <p>
                    {{ monteCarlo.probabilityPositive >= 0.62
                      ? "多数重抽样路径保持正收益，但仍需关注尾部回撤。"
                      : monteCarlo.probabilityPositive >= 0.45
                        ? "结果对收益顺序较敏感，适合继续缩小仓位观察。"
                        : "多数重抽样路径未能保持正收益，参数稳定性偏弱。" }}
                  </p>
                </div>

                <div class="mc-kpis">
                  <div>
                    <span>正收益概率</span>
                    <strong>{{ formatPercent(monteCarlo.probabilityPositive * 100, 1) }}</strong>
                  </div>
                  <div>
                    <span>中位收益</span>
                    <strong>{{ formatPercent(monteCarlo.medianReturn) }}</strong>
                  </div>
                  <div>
                    <span>5–95% 区间</span>
                    <strong>{{ formatPercent(monteCarlo.p05Return) }} 至 {{ formatPercent(monteCarlo.p95Return) }}</strong>
                  </div>
                  <div>
                    <span>回撤内概率</span>
                    <strong>{{ monteCarlo.probabilityWithinRisk == null ? "--" : formatPercent(monteCarlo.probabilityWithinRisk * 100, 1) }}</strong>
                  </div>
                </div>

                <MonteCarloFanChart :bands="monteCarlo.bands" />

                <div class="mc-tail">
                  <span>中位最大回撤 <strong>{{ monteCarlo.medianMaxDrawdown.toFixed(2) }}%</strong></span>
                  <span>95 分位最大回撤 <strong>{{ monteCarlo.p95MaxDrawdown.toFixed(2) }}%</strong></span>
                  <span>{{ monteCarlo.observations }} 个历史收益样本 · {{ monteCarlo.horizon }} 日周期</span>
                </div>
                <p class="mc-disclaimer">
                  <Info :size="13" aria-hidden="true" />
                  重抽样检验收益顺序的脆弱性，不模拟新的均线信号，也不预测未来收益。
                </p>
              </div>
              <div v-else class="sensitivity-empty mc-empty">
                <strong>暂无可检验的权益路径</strong>
                <p>请先在参数地图选择有效参数；至少需要 20 个权益变化样本。</p>
              </div>
            </template>

            <section v-if="selectedCell?.result" class="sensitivity-selection">
              <div>
                <span>已选参数</span>
                <strong>SMA {{ selectedCell.shortWindow }} / {{ selectedCell.longWindow }}</strong>
                <small>
                  收益 {{ formatPercent(selectedCell.result.totalReturn) }} ·
                  回撤 {{ selectedCell.result.maxDrawdown.toFixed(2) }}% ·
                  胜率 {{ selectedCell.result.winRate == null ? "--" : formatPercent(selectedCell.result.winRate) }}
                </small>
              </div>
              <button class="btn btn-small" type="button" @click="applySelected">应用并保存回测</button>
            </section>
          </template>
        </div>

        <footer class="sensitivity-foot">
          <span>样本内扫描与重抽样都可能过拟合；请同时查看区间和尾部风险。</span>
          <button class="btn btn-small btn-ghost" type="button" @click="close">完成</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.sensitivity-backdrop {
  position: fixed;
  z-index: 110;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 14, 14, 0.38);
  backdrop-filter: blur(16px) saturate(1.15);
  -webkit-backdrop-filter: blur(16px) saturate(1.15);
}

.sensitivity-dialog {
  display: flex;
  width: min(820px, 100%);
  max-height: min(880px, calc(100vh - 48px));
  flex-direction: column;
  overflow: hidden;
  border-radius: 22px;
  background: var(--panel);
  box-shadow: 0 34px 90px -44px rgba(0, 0, 0, 0.72);
}

.sensitivity-head,
.sensitivity-foot {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--line);
}

.sensitivity-head {
  background:
    radial-gradient(320px 170px at 100% -20%, rgba(194, 58, 52, 0.1), transparent 72%),
    var(--panel);
}

.sensitivity-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--up);
}

.sensitivity-title-row h2 {
  margin: 0;
  color: var(--ink);
  font-size: 23px;
  font-weight: 680;
  letter-spacing: -0.035em;
}

.sensitivity-head p {
  margin: 5px 0 0;
  color: var(--ink-3);
  font-size: 10.5px;
}

.sensitivity-commandbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--line);
  background: var(--panel-soft);
}

.scan-ranges {
  padding: 2px;
}

.scan-ranges button {
  min-height: 30px;
  padding: 0 11px;
  font-size: 9.5px;
}

.lab-tabs {
  display: flex;
  align-items: center;
  gap: 3px;
}

.lab-tabs button {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  border-radius: 8px;
  color: var(--ink-3);
  font-size: 9.5px;
  transition: background 150ms ease, color 150ms ease;
}

.lab-tabs button:hover {
  color: var(--ink);
}

.lab-tabs button.active {
  background: var(--panel);
  box-shadow: 0 1px 5px rgba(32, 28, 24, 0.08);
  color: var(--ink);
}

.lab-tabs button.active svg {
  color: var(--up);
}

.sensitivity-body {
  min-height: 0;
  overflow: auto;
  padding: 16px 20px 18px;
}

.sensitivity-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.sensitivity-toolbar > div:first-child {
  display: grid;
  gap: 2px;
}

.sensitivity-toolbar strong {
  color: var(--ink);
  font-size: 11px;
  font-weight: 650;
}

.sensitivity-toolbar span {
  color: var(--ink-3);
  font-size: 9px;
}

.sensitivity-metrics {
  padding: 2px;
}

.sensitivity-metrics button {
  min-height: 28px;
  padding: 0 10px;
  font-size: 9px;
}

.sensitivity-matrix {
  display: grid;
  grid-template-columns: 42px repeat(var(--long-count), minmax(0, 1fr));
  gap: 5px;
}

.matrix-corner,
.matrix-axis {
  display: grid;
  min-height: 31px;
  place-items: center;
  color: var(--ink-3);
  font-family: var(--font-data);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}

.sensitivity-cell {
  position: relative;
  display: grid;
  min-height: 68px;
  align-content: center;
  justify-items: center;
  gap: 4px;
  padding: 8px 4px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel-soft);
  color: var(--ink-2);
  transition:
    border-color 150ms ease,
    filter 150ms ease,
    transform 150ms ease;
}

.sensitivity-cell.up {
  border-color: rgba(194, 58, 52, calc(0.1 + var(--heat) * 0.18));
  background: rgba(194, 58, 52, calc(0.035 + var(--heat) * 0.12));
}

.sensitivity-cell.down {
  border-color: rgba(40, 131, 88, calc(0.1 + var(--heat) * 0.18));
  background: rgba(40, 131, 88, calc(0.03 + var(--heat) * 0.1));
}

.sensitivity-cell.risk {
  border-color: rgba(164, 127, 67, calc(0.12 + var(--heat) * 0.2));
  background: rgba(164, 127, 67, calc(0.035 + var(--heat) * 0.13));
}

.sensitivity-cell.flat {
  background: var(--panel-soft);
}

.sensitivity-cell:hover:not(:disabled),
.sensitivity-cell:focus-visible {
  filter: brightness(1.02);
  transform: translateY(-1px);
}

.sensitivity-cell.selected {
  box-shadow: inset 0 0 0 2px var(--ink);
}

.sensitivity-cell.best::after {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--gold-strong);
  content: "";
}

.sensitivity-cell:disabled {
  cursor: default;
  opacity: 0.35;
}

.sensitivity-cell strong {
  color: var(--ink);
  font-family: var(--font-data);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-weight: 650;
}

.sensitivity-cell small {
  color: var(--ink-3);
  font-family: var(--font-data);
  font-size: 8px;
}

.sensitivity-cell.risk strong {
  color: var(--gold-strong);
}

.sensitivity-cell svg {
  position: absolute;
  right: 5px;
  bottom: 5px;
  color: var(--gold-strong);
}

.sensitivity-note,
.mc-disclaimer {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 11px 2px 0;
  color: var(--ink-3);
  font-size: 9px;
  line-height: 1.55;
}

.sensitivity-note svg,
.mc-disclaimer svg {
  flex: none;
  margin-top: 1px;
  color: var(--gold-strong);
}

.sensitivity-selection {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 13px;
  padding: 11px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel-soft);
}

.sensitivity-selection > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.sensitivity-selection span,
.sensitivity-selection small {
  color: var(--ink-3);
  font-size: 9px;
}

.sensitivity-selection strong {
  color: var(--ink);
  font-family: var(--font-data);
  font-size: 11px;
}

.mc-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.mc-head > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.mc-head span {
  color: var(--ink-3);
  font-size: 9px;
}

.mc-head strong {
  color: var(--ink);
  font-family: var(--font-data);
  font-size: 13px;
}

.mc-head p {
  margin: 1px 0 0;
  color: var(--ink-3);
  font-size: 9px;
}

.mc-loading {
  display: grid;
  min-height: 280px;
  place-items: center;
  align-content: center;
  gap: 8px;
  color: var(--ink-3);
  text-align: center;
}

.mc-loading i {
  width: 220px;
  height: 5px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--paper-deep), rgba(194, 58, 52, 0.35), var(--paper-deep));
  background-size: 200% 100%;
  animation: sensitivity-loading 1.2s linear infinite;
}

.mc-loading strong {
  margin-top: 8px;
  color: var(--ink);
  font-size: 11px;
}

.mc-loading span {
  font-size: 9px;
}

.mc-results {
  display: grid;
  gap: 11px;
  margin-top: 12px;
}

.mc-verdict {
  display: grid;
  grid-template-columns: minmax(120px, 0.32fr) minmax(0, 1fr);
  gap: 14px;
  align-items: center;
  padding: 12px 13px;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: var(--panel-soft);
}

.mc-verdict > div {
  display: grid;
  gap: 1px;
}

.mc-verdict span {
  color: var(--ink-3);
  font-size: 9px;
}

.mc-verdict strong {
  color: var(--ink);
  font-size: 22px;
  font-weight: 680;
  letter-spacing: -0.03em;
}

.mc-verdict p {
  margin: 0;
  color: var(--ink-2);
  font-size: 10px;
  line-height: 1.55;
}

.mc-verdict.steady strong {
  color: var(--up);
}

.mc-verdict.watch strong {
  color: var(--gold-strong);
}

.mc-verdict.fragile strong {
  color: var(--down);
}

.mc-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 13px;
}

.mc-kpis > div {
  display: grid;
  gap: 4px;
  padding: 11px 10px;
  border-right: 1px solid var(--line);
}

.mc-kpis > div:last-child {
  border-right: 0;
}

.mc-kpis span {
  color: var(--ink-3);
  font-size: 9px;
}

.mc-kpis strong {
  color: var(--ink);
  font-family: var(--font-data);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.mc-tail {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 16px;
  color: var(--ink-3);
  font-size: 9px;
}

.mc-tail strong {
  color: var(--ink-2);
  font-family: var(--font-data);
}

.mc-disclaimer {
  margin-top: -2px;
}

.sensitivity-loading,
.sensitivity-empty {
  display: grid;
  min-height: 300px;
  place-items: center;
  align-content: center;
  gap: 9px;
  color: var(--ink-3);
  text-align: center;
}

.sensitivity-loading > span {
  color: var(--ink-2);
  font-size: 11px;
}

.sensitivity-loading i {
  width: 180px;
  height: 5px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--paper-deep), rgba(194, 58, 52, 0.35), var(--paper-deep));
  background-size: 200% 100%;
  animation: sensitivity-loading 1.2s linear infinite;
}

.sensitivity-loading i:nth-child(3) {
  width: 130px;
  animation-delay: 100ms;
}

.sensitivity-loading i:nth-child(4) {
  width: 210px;
  animation-delay: 200ms;
}

.sensitivity-empty strong {
  color: var(--ink);
  font-size: 12px;
}

.sensitivity-empty p {
  max-width: 360px;
  margin: 0;
  font-size: 10px;
  line-height: 1.55;
}

.mc-empty {
  min-height: 300px;
}

.sensitivity-foot {
  align-items: center;
  padding-top: 11px;
  padding-bottom: 11px;
  border-top: 1px solid var(--line);
  border-bottom: 0;
  color: var(--ink-3);
  font-size: 9px;
}

.spinning {
  animation: spin 700ms linear infinite;
}

@keyframes sensitivity-loading {
  to {
    background-position: -200% 0;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 720px) {
  .sensitivity-backdrop {
    align-items: end;
    padding: 0;
  }

  .sensitivity-dialog {
    width: 100%;
    max-height: 94vh;
    border-radius: 22px 22px 0 0;
  }

  .sensitivity-head,
  .sensitivity-foot {
    padding-right: 16px;
    padding-left: 16px;
  }

  .sensitivity-commandbar {
    align-items: flex-start;
    flex-direction: column;
    padding-right: 16px;
    padding-left: 16px;
  }

  .scan-ranges,
  .lab-tabs {
    width: 100%;
  }

  .scan-ranges button,
  .lab-tabs button {
    flex: 1;
    justify-content: center;
  }

  .sensitivity-body {
    padding: 14px 16px 16px;
  }

  .sensitivity-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .sensitivity-metrics {
    width: 100%;
  }

  .sensitivity-metrics button {
    flex: 1;
  }

  .sensitivity-matrix {
    grid-template-columns: 32px repeat(var(--long-count), minmax(0, 1fr));
    gap: 4px;
  }

  .sensitivity-cell {
    min-height: 65px;
    padding-right: 2px;
    padding-left: 2px;
  }

  .sensitivity-cell strong {
    font-size: 9.5px;
  }

  .sensitivity-cell small {
    font-size: 7.5px;
  }

  .sensitivity-selection {
    align-items: flex-start;
    flex-direction: column;
  }

  .sensitivity-selection .btn {
    width: 100%;
  }

  .mc-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .mc-verdict {
    grid-template-columns: minmax(0, 1fr);
    gap: 7px;
  }

  .mc-kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .mc-kpis > div:nth-child(2) {
    border-right: 0;
  }

  .mc-kpis > div:nth-child(-n + 2) {
    border-bottom: 1px solid var(--line);
  }

  .sensitivity-foot {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 360px) {
  .sensitivity-cell small {
    display: none;
  }

  .sensitivity-title-row h2 {
    font-size: 21px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sensitivity-loading i,
  .mc-loading i {
    animation: none;
  }

  .spinning {
    animation: none;
  }
}
</style>
