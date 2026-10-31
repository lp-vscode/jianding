<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Check, GitCompareArrows, X } from "lucide-vue-next";
import type { Asset, TrendRange } from "../types";
import { fetchTrend } from "../lib/backend";
import { calculateTrendPerformance } from "../lib/comparison";
import { directionMark, formatPercent, toneOf } from "../lib/format";
import ComparisonChart, { type ComparisonSeries } from "./ComparisonChart.vue";

const props = defineProps<{
  assets: Asset[];
  initialSymbol?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const ranges: { key: TrendRange; label: string }[] = [
  { key: "1m", label: "1月" },
  { key: "3m", label: "3月" },
  { key: "1y", label: "1年" },
];
const palette = ["#f46b63", "#e6be73", "#65b8a6", "#8fa7ff"];
const dashPatterns = ["", "7 5", "2 4", "10 4 2 4"];
const selected = ref<string[]>([]);
const range = ref<TrendRange>("3m");
const performance = ref<Record<string, ReturnType<typeof calculateTrendPerformance>>>({});
const loading = ref(false);
const error = ref("");
const dialog = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
let requestToken = 0;

const selectedAssets = computed(() =>
  selected.value
    .map((symbol) => props.assets.find((asset) => asset.symbol === symbol))
    .filter((asset): asset is Asset => Boolean(asset)),
);

const series = computed<ComparisonSeries[]>(() =>
  selectedAssets.value.flatMap((asset) => {
    const result = performance.value[asset.symbol];
    if (!result?.points.length) return [];
    const index = Math.max(0, props.assets.findIndex((item) => item.symbol === asset.symbol));
    return [{
      symbol: asset.symbol,
      name: asset.name,
      code: asset.code,
      color: palette[index % palette.length],
      dash: dashPatterns[index % dashPatterns.length],
      points: result.points,
      totalReturn: result.totalReturn,
      maxDrawdown: result.maxDrawdown,
    }];
  }),
);

const ranked = computed(() =>
  [...series.value].sort((left, right) => right.totalReturn - left.totalReturn),
);
const leader = computed(() => ranked.value[0] ?? null);
const laggard = computed(() => ranked.value[ranked.value.length - 1] ?? null);
const spread = computed(() =>
  leader.value && laggard.value ? leader.value.totalReturn - laggard.value.totalReturn : 0,
);
const emptyTitle = computed(() =>
  selected.value.length < 2
    ? `再选择 ${Math.max(1, 2 - selected.value.length)} 只标的`
    : "暂无可比较走势",
);

function toggleAsset(symbol: string) {
  if (selected.value.includes(symbol)) {
    selected.value = selected.value.filter((item) => item !== symbol);
    return;
  }
  if (selected.value.length >= 4) return;
  selected.value = [...selected.value, symbol];
}

async function loadComparison() {
  const token = ++requestToken;
  if (selectedAssets.value.length < 2) {
    performance.value = {};
    loading.value = false;
    error.value = "";
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const results = await Promise.all(
      selectedAssets.value.map(async (asset) => ({
        symbol: asset.symbol,
        points: await fetchTrend(asset, range.value),
      })),
    );
    if (token !== requestToken) return;
    performance.value = Object.fromEntries(
      results.map((result) => [result.symbol, calculateTrendPerformance(result.points)]),
    );
  } catch (cause) {
    if (token !== requestToken) return;
    console.warn("对比走势加载失败", cause);
    error.value = "走势暂时无法加载，请稍后重试";
  } finally {
    if (token === requestToken) loading.value = false;
  }
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
    'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
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

watch(
  () => [selected.value.join("|"), range.value],
  () => void loadComparison(),
);

onMounted(() => {
  const candidate = props.initialSymbol
    ? [props.initialSymbol, ...props.assets.map((asset) => asset.symbol)]
    : props.assets.map((asset) => asset.symbol);
  selected.value = [...new Set(candidate)].slice(0, Math.min(4, props.assets.length));
  window.addEventListener("keydown", onKeydown);
  void nextTick(() => closeButton.value?.focus());
});

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <div class="compare-backdrop" @mousedown.self="close">
      <section
        ref="dialog"
        class="compare-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="comparison-dialog-title"
      >
        <header class="compare-head">
          <div>
            <span class="compare-kicker"><GitCompareArrows :size="13" aria-hidden="true" /> Relative view</span>
            <h2 id="comparison-dialog-title">多标的对比</h2>
            <p>统一从区间起点归一化，消除价格量级差异</p>
          </div>
          <button ref="closeButton" class="icon-btn compare-close" type="button" aria-label="关闭多标的对比" @click="close">
            <X :size="17" />
          </button>
        </header>

        <div class="compare-body">
          <section class="compare-picker" aria-labelledby="compare-picker-title">
            <div class="compare-section-head">
              <div>
                <h3 id="compare-picker-title">选择标的</h3>
                <p>选择 2–4 只，保持同一时间窗口</p>
              </div>
              <span>{{ selected.length }} / 4</span>
            </div>
            <div class="compare-assets" role="group" aria-label="选择对比标的">
              <button
                v-for="asset in assets"
                :key="asset.symbol"
                type="button"
                :class="{ selected: selected.includes(asset.symbol) }"
                :aria-pressed="selected.includes(asset.symbol)"
                :disabled="!selected.includes(asset.symbol) && selected.length >= 4"
                @click="toggleAsset(asset.symbol)"
              >
                <span class="compare-asset-mark">
                  <Check v-if="selected.includes(asset.symbol)" :size="12" aria-hidden="true" />
                  <i v-else aria-hidden="true" />
                </span>
                <span class="compare-asset-copy">
                  <strong>{{ asset.name }}</strong>
                  <small>{{ asset.code }} · {{ asset.typeLabel }}</small>
                </span>
              </button>
            </div>
            <div class="compare-range-row">
              <span>比较区间</span>
              <div class="segmented compare-ranges" role="group" aria-label="比较区间">
                <button
                  v-for="option in ranges"
                  :key="option.key"
                  type="button"
                  :class="{ active: range === option.key }"
                  :aria-pressed="range === option.key"
                  @click="range = option.key"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
          </section>

          <div v-if="loading" class="compare-loading" role="status" aria-live="polite">
            <span>正在对齐 {{ selected.length }} 只标的的走势</span>
            <i /><i /><i />
          </div>
          <div v-else-if="error" class="compare-empty" role="alert">
            <strong>对比数据暂不可用</strong>
            <p>{{ error }}</p>
            <button class="btn btn-small" type="button" @click="loadComparison">重新加载</button>
          </div>
          <div v-else-if="series.length < 2" class="compare-empty">
            <GitCompareArrows :size="23" :stroke-width="1.5" aria-hidden="true" />
            <strong>{{ emptyTitle }}</strong>
            <p v-if="selected.length < 2">至少选择两只股票、ETF 或基金，才能看到相对强弱。</p>
            <p v-else>所选区间的走势数据不足，请切换时间范围后重试。</p>
          </div>
          <template v-else>
            <section class="compare-stage" aria-labelledby="compare-stage-title">
              <div class="compare-section-head">
                <div>
                  <h3 id="compare-stage-title">归一化表现</h3>
                  <p>
                    <template v-if="leader">
                      {{ leader.name }} 领跑，首尾相差 {{ Math.abs(spread).toFixed(2) }} 个百分点
                    </template>
                  </p>
                </div>
                <span>起点 0%</span>
              </div>
              <ComparisonChart :series="series" />
              <div class="compare-legend" aria-hidden="true">
                <span v-for="item in series" :key="item.symbol">
                  <i :style="{ '--series-color': item.color }" />
                  {{ item.name }}
                </span>
              </div>
            </section>

            <section class="compare-scoreboard" aria-labelledby="compare-scoreboard-title">
              <div class="compare-section-head">
                <div>
                  <h3 id="compare-scoreboard-title">区间成绩</h3>
                  <p>收益与回撤均按所选区间内数据计算</p>
                </div>
              </div>
              <div class="compare-score-head" aria-hidden="true">
                <span>标的</span>
                <span>区间收益</span>
                <span>最大回撤</span>
              </div>
              <div
                v-for="item in series"
                :key="item.symbol"
                class="compare-score-row"
              >
                <span class="compare-score-name">
                  <i :style="{ '--series-color': item.color }" />
                  <span>
                    <strong>{{ item.name }}</strong>
                    <small>{{ item.code }}</small>
                  </span>
                </span>
                <strong :class="toneOf(item.totalReturn)">
                  {{ formatPercent(item.totalReturn) }}
                  <i class="trend-mark" aria-hidden="true">{{ directionMark(item.totalReturn) }}</i>
                </strong>
                <span class="compare-drawdown">{{ formatPercent(item.maxDrawdown) }}</span>
              </div>
            </section>
          </template>
        </div>

        <footer class="compare-foot">
          <span>仅比较所选区间的相对表现，不构成投资建议。</span>
          <button class="btn btn-small" type="button" @click="close">完成</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.compare-backdrop {
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

.compare-dialog {
  display: flex;
  width: min(880px, 100%);
  max-height: min(840px, calc(100vh - 48px));
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 24px;
  background: var(--panel);
  box-shadow: 0 36px 90px -44px rgba(0, 0, 0, 0.72);
}

.compare-head,
.compare-foot {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid var(--line);
}

.compare-head {
  background:
    radial-gradient(360px 180px at 100% -20%, rgba(194, 58, 52, 0.11), transparent 72%),
    var(--panel);
}

.compare-kicker {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--up);
  font-family: var(--font-data);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.compare-head h2 {
  margin: 5px 0 0;
  color: var(--ink);
  font-family: var(--font-ui);
  font-size: 24px;
  font-weight: 680;
  letter-spacing: -0.035em;
}

.compare-head p,
.compare-section-head p {
  margin: 4px 0 0;
  color: var(--ink-3);
  font-size: 10px;
  line-height: 1.5;
}

.compare-close {
  flex: none;
}

.compare-body {
  min-height: 0;
  overflow: auto;
  padding: 18px 22px 20px;
}

.compare-picker {
  padding-bottom: 15px;
  border-bottom: 1px solid var(--line);
}

.compare-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.compare-section-head h3 {
  margin: 0;
  color: var(--ink);
  font-size: 12px;
  font-weight: 650;
}

.compare-section-head > span {
  flex: none;
  color: var(--ink-3);
  font-family: var(--font-data);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
}

.compare-assets {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  margin-top: 11px;
}

.compare-assets button {
  display: flex;
  min-width: 0;
  min-height: 48px;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel-soft);
  color: var(--ink-2);
  text-align: left;
  transition:
    border-color 150ms ease,
    background 150ms ease,
    color 150ms ease;
}

.compare-assets button:hover:not(:disabled),
.compare-assets button:focus-visible {
  border-color: var(--line-strong);
  background: var(--panel-raised);
}

.compare-assets button.selected {
  border-color: rgba(194, 58, 52, 0.24);
  background: rgba(194, 58, 52, 0.055);
  color: var(--ink);
}

.compare-assets button:disabled {
  cursor: not-allowed;
  opacity: 0.44;
}

.compare-asset-mark {
  display: grid;
  width: 20px;
  height: 20px;
  flex: none;
  place-items: center;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  background: var(--panel-raised);
}

.compare-asset-mark i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ink-4);
}

.selected .compare-asset-mark {
  border-color: #d8413a;
  background: #d8413a;
  color: #fff;
}

.compare-asset-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.compare-asset-copy strong,
.compare-asset-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compare-asset-copy strong {
  font-size: 10.5px;
  font-weight: 620;
}

.compare-asset-copy small {
  color: var(--ink-3);
  font-family: var(--font-data);
  font-size: 8.5px;
}

.compare-range-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 12px;
}

.compare-range-row > span {
  color: var(--ink-3);
  font-size: 10px;
}

.compare-ranges {
  padding: 2px;
}

.compare-ranges button {
  min-height: 28px;
  padding: 0 12px;
  font-size: 9.5px;
}

.compare-stage {
  margin-top: 16px;
  overflow: hidden;
  padding: 15px 16px 11px;
  border: 1px solid rgba(237, 94, 88, 0.16);
  border-radius: 17px;
  background:
    radial-gradient(360px 210px at 100% -10%, rgba(194, 58, 52, 0.22), transparent 70%),
    linear-gradient(145deg, #191817 0%, #101010 72%);
  color: #f7f3eb;
}

.compare-stage .compare-section-head h3 {
  color: #f7f3eb;
}

.compare-stage .compare-section-head p,
.compare-stage .compare-section-head > span {
  color: #b6b1a8;
}

.compare-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 7px 14px;
  margin-top: 7px;
  color: #b6b1a8;
  font-size: 9px;
}

.compare-legend span {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.compare-legend i,
.compare-score-name > i {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--series-color);
}

.compare-scoreboard {
  margin-top: 16px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 15px;
}

.compare-scoreboard > .compare-section-head {
  padding: 13px 14px 11px;
  border-bottom: 1px solid var(--line);
}

.compare-score-head,
.compare-score-row {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(88px, 0.7fr) minmax(88px, 0.7fr);
  align-items: center;
  gap: 12px;
  padding: 9px 14px;
}

.compare-score-head {
  background: var(--panel-soft);
  color: var(--ink-3);
  font-size: 8.5px;
  letter-spacing: 0.04em;
}

.compare-score-head span:not(:first-child) {
  text-align: right;
}

.compare-score-row {
  border-top: 1px solid var(--line);
}

.compare-score-row:first-of-type {
  border-top: 0;
}

.compare-score-name {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.compare-score-name > span {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.compare-score-name strong,
.compare-score-name small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compare-score-name strong {
  color: var(--ink);
  font-size: 10.5px;
  font-weight: 600;
}

.compare-score-name small {
  color: var(--ink-3);
  font-family: var(--font-data);
  font-size: 8.5px;
}

.compare-score-row > strong,
.compare-drawdown {
  font-family: var(--font-data);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

.compare-drawdown {
  color: var(--ink-2);
}

.compare-loading,
.compare-empty {
  display: grid;
  min-height: 250px;
  place-items: center;
  align-content: center;
  gap: 8px;
  color: var(--ink-3);
  text-align: center;
}

.compare-loading > span {
  color: var(--ink-2);
  font-size: 11px;
}

.compare-loading i {
  width: 70px;
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--paper-deep), rgba(194, 58, 52, 0.4), var(--paper-deep));
  background-size: 200% 100%;
  animation: compare-loading 1.2s linear infinite;
}

.compare-loading i:nth-child(2) {
  width: 112px;
  animation-delay: 80ms;
}

.compare-loading i:nth-child(3) {
  width: 56px;
  animation-delay: 160ms;
}

.compare-empty strong {
  color: var(--ink);
  font-size: 13px;
}

.compare-empty p {
  max-width: 320px;
  margin: 0;
  font-size: 10.5px;
  line-height: 1.55;
}

.compare-foot {
  align-items: center;
  padding-top: 12px;
  padding-bottom: 12px;
  border-top: 1px solid var(--line);
  border-bottom: 0;
  color: var(--ink-3);
  font-size: 9px;
}

@keyframes compare-loading {
  to {
    background-position: -200% 0;
  }
}

@media (max-width: 720px) {
  .compare-backdrop {
    align-items: end;
    padding: 0;
  }

  .compare-dialog {
    width: 100%;
    max-height: 92vh;
    border-radius: 22px 22px 0 0;
  }

  .compare-head,
  .compare-foot {
    padding-right: 16px;
    padding-left: 16px;
  }

  .compare-body {
    padding: 15px 16px 18px;
  }

  .compare-assets {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .compare-assets button,
  .compare-ranges button {
    min-height: 44px;
  }

  .compare-score-head,
  .compare-score-row {
    grid-template-columns: minmax(0, 1.35fr) minmax(76px, 0.7fr) minmax(76px, 0.7fr);
    gap: 8px;
    padding-right: 11px;
    padding-left: 11px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .compare-loading i {
    animation: none;
  }
}
</style>
