<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Check, Copy, Download, History, X } from "lucide-vue-next";
import type { TradingBacktestResult, TradingRiskConfig } from "../types";
import { calculateTrendPerformance } from "../lib/comparison";
import { backtestReportFilename, buildFullBacktestReport } from "../lib/backtest-report";
import { buildBacktestSummary } from "../lib/backtest-summary";
import { isHarmonyWebView, saveHarmonyTextFile } from "../lib/backend";
import { directionMark, formatPercent, formatShanghaiTime, toneOf } from "../lib/format";
import { showToast } from "../lib/store";
import ComparisonChart, { type ComparisonSeries } from "./ComparisonChart.vue";

const props = defineProps<{
  versions: TradingBacktestResult[];
  assetName: string;
  risk: TradingRiskConfig;
}>();

const emit = defineEmits<{ close: [] }>();
const palette = ["#f46b63", "#e6be73", "#65b8a6"];
const dashPatterns = ["", "7 5", "2 4"];
const selected = ref<string[]>([]);
const dialog = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);

const selectedVersions = computed(() =>
  selected.value
    .map((id) => props.versions.find((version) => version.id === id))
    .filter((version): version is TradingBacktestResult => Boolean(version)),
);
const compactVersionTime = (ranAt: number) => formatShanghaiTime(ranAt).slice(5);

const series = computed<ComparisonSeries[]>(() =>
  selectedVersions.value.flatMap((version, index) => {
    const performance = calculateTrendPerformance(version.equityCurve);
    if (!performance.points.length) return [];
    return [{
      symbol: version.id,
      name: `SMA ${version.shortWindow}/${version.longWindow}`,
      code: compactVersionTime(version.ranAt),
      color: palette[index % palette.length],
      dash: dashPatterns[index % dashPatterns.length],
      points: performance.points,
      totalReturn: version.totalReturn,
      maxDrawdown: version.maxDrawdown,
    }];
  }),
);

const ranked = computed(() =>
  [...selectedVersions.value].sort((left, right) => right.totalReturn - left.totalReturn),
);
const leader = computed(() => ranked.value[0] ?? null);

function toggleVersion(id: string) {
  if (selected.value.includes(id)) {
    selected.value = selected.value.filter((item) => item !== id);
    return;
  }
  if (selected.value.length >= 3) {
    selected.value = [...selected.value.slice(1), id];
    return;
  }
  selected.value = [...selected.value, id];
}

function close() {
  emit("close");
}

async function copySummary() {
  if (!selectedVersions.value.length) return;
  try {
    await navigator.clipboard.writeText(
      buildBacktestSummary(
        selectedVersions.value,
        props.assetName,
        selectedVersions.value[0].symbol,
      ),
    );
    showToast("策略回放复盘已复制", "success");
  } catch {
    showToast("复制失败，请检查剪贴板权限", "error");
  }
}

async function exportReport() {
  if (!selectedVersions.value.length) return;
  const generatedAt = Date.now();
  const report = buildFullBacktestReport({
    assetName: props.assetName,
    symbol: selectedVersions.value[0].symbol,
    versions: selectedVersions.value,
    risk: props.risk,
    generatedAt,
  });
  const filename = backtestReportFilename(selectedVersions.value[0].symbol, generatedAt);
  if (isHarmonyWebView() && window.JiandingNative?.saveTextFile) {
    const saved = await saveHarmonyTextFile(filename, report);
    showToast(
      saved ? "完整回测报告已保存" : "报告未保存",
      saved ? "success" : "info",
    );
    return;
  }
  try {
    const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
    showToast("完整回测报告已导出", "success");
  } catch (error) {
    console.warn("回测报告导出失败", error);
    void navigator.clipboard
      .writeText(report)
      .then(() => showToast("当前环境无法下载，完整报告已复制", "success"))
      .catch(() => showToast("报告导出失败，请检查文件或剪贴板权限", "error"));
  }
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

onMounted(() => {
  selected.value = props.versions.slice(0, 2).map((version) => version.id);
  window.addEventListener("keydown", onKeydown);
  void nextTick(() => closeButton.value?.focus());
});

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <div class="history-backdrop" @mousedown.self="close">
      <section
        ref="dialog"
        class="history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-dialog-title"
      >
        <header class="history-head">
          <div>
            <h2 id="history-dialog-title">策略版本回放</h2>
            <p>使用已保存的历史回测，不重新拉取行情</p>
          </div>
          <button ref="closeButton" class="icon-btn" type="button" aria-label="关闭策略版本回放" @click="close">
            <X :size="17" />
          </button>
        </header>

        <div class="history-body">
          <section class="history-picker" aria-labelledby="history-picker-title">
            <div class="history-section-head">
              <div>
                <h3 id="history-picker-title">选择版本</h3>
                <p>最多同时回放 3 个版本</p>
              </div>
              <span>{{ selected.length }} / 3</span>
            </div>
            <div class="history-versions">
              <button
                v-for="version in versions"
                :key="version.id"
                type="button"
                :class="{ selected: selected.includes(version.id) }"
                :aria-pressed="selected.includes(version.id)"
                @click="toggleVersion(version.id)"
              >
                <span class="history-check">
                  <Check v-if="selected.includes(version.id)" :size="12" aria-hidden="true" />
                </span>
                <span>
                  <strong>SMA {{ version.shortWindow }} / {{ version.longWindow }}</strong>
                  <small>{{ compactVersionTime(version.ranAt) }}</small>
                </span>
                <b :class="toneOf(version.totalReturn)">{{ formatPercent(version.totalReturn) }}</b>
              </button>
            </div>
          </section>

          <section v-if="series.length >= 2" class="history-stage">
            <div class="history-section-head">
              <div>
                <h3>归一化权益回放</h3>
                <p>{{ leader ? `${leader.shortWindow}/${leader.longWindow} 版本区间收益最高` : "" }}</p>
              </div>
              <span>起点 0%</span>
            </div>
            <ComparisonChart :series="series" />
            <div class="history-legend" aria-hidden="true">
              <span v-for="item in series" :key="item.symbol">
                <i :style="{ background: item.color }" />
                {{ item.name }} · {{ item.code }}
              </span>
            </div>
          </section>

          <section v-else class="history-empty">
            <History :size="22" :stroke-width="1.5" aria-hidden="true" />
            <strong>至少选择两个版本</strong>
            <p>运行不同蓝图或均线参数的回测后，可在这里对照权益曲线与回撤。</p>
          </section>

          <section v-if="selectedVersions.length" class="history-score">
            <div class="history-score-head" aria-hidden="true">
              <span>版本</span>
              <span>收益</span>
              <span>回撤</span>
              <span>胜率</span>
            </div>
            <div v-for="version in selectedVersions" :key="version.id" class="history-score-row">
              <span>
                <strong>SMA {{ version.shortWindow }} / {{ version.longWindow }}</strong>
                <small>{{ compactVersionTime(version.ranAt) }}</small>
              </span>
              <strong :class="toneOf(version.totalReturn)">
                {{ formatPercent(version.totalReturn) }}
                <i class="trend-mark" aria-hidden="true">{{ directionMark(version.totalReturn) }}</i>
              </strong>
              <span class="history-drawdown">{{ formatPercent(-version.maxDrawdown) }}</span>
              <span class="history-winrate">{{ version.winRate == null ? "--" : formatPercent(version.winRate) }}</span>
            </div>
          </section>
        </div>

        <footer class="history-foot">
          <span>回放只比较历史结果，不代表未来表现。</span>
          <div class="history-foot-actions">
            <button
              class="btn btn-small btn-ghost"
              type="button"
              :disabled="!selectedVersions.length"
              @click="copySummary"
            >
              <Copy :size="12" />
              复制复盘
            </button>
            <button
              class="btn btn-small btn-ghost"
              type="button"
              :disabled="!selectedVersions.length"
              title="导出所选版本的完整 Markdown 报告"
              @click="exportReport"
            >
              <Download :size="12" />
              导出报告
            </button>
            <button class="btn btn-small" type="button" @click="close">完成</button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.history-backdrop {
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

.history-dialog {
  display: flex;
  width: min(820px, 100%);
  max-height: min(820px, calc(100vh - 48px));
  flex-direction: column;
  overflow: hidden;
  border-radius: 22px;
  background: var(--panel);
  box-shadow: 0 34px 90px -44px rgba(0, 0, 0, 0.72);
}

.history-head,
.history-foot {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--line);
}

.history-head {
  background:
    radial-gradient(320px 170px at 100% -20%, rgba(194, 58, 52, 0.1), transparent 72%),
    var(--panel);
}

.history-head h2 {
  margin: 0;
  color: var(--ink);
  font-size: 23px;
  font-weight: 680;
  letter-spacing: -0.035em;
}

.history-head p,
.history-section-head p {
  margin: 3px 0 0;
  color: var(--ink-3);
  font-size: 9.5px;
}

.history-body {
  min-height: 0;
  overflow: auto;
  padding: 16px 20px 18px;
}

.history-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.history-section-head h3 {
  margin: 0;
  color: var(--ink);
  font-size: 12px;
  font-weight: 650;
}

.history-section-head > span {
  color: var(--ink-3);
  font-family: var(--font-data);
  font-size: 9px;
}

.history-versions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
  margin-top: 9px;
}

.history-versions button {
  display: grid;
  min-width: 0;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  padding: 9px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel-soft);
  text-align: left;
}

.history-versions button.selected {
  border-color: rgba(194, 58, 52, 0.23);
  background: rgba(194, 58, 52, 0.055);
}

.history-check {
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  color: #ffffff;
}

.selected .history-check {
  border-color: #d8413a;
  background: #d8413a;
}

.history-versions button > span:nth-child(2) {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.history-versions strong,
.history-versions small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-versions strong {
  color: var(--ink);
  font-size: 9.5px;
  font-weight: 600;
}

.history-versions small {
  color: var(--ink-3);
  font-family: var(--font-data);
  font-size: 8px;
}

.history-versions b {
  font-family: var(--font-data);
  font-size: 9px;
  font-weight: 620;
  white-space: nowrap;
}

.history-stage {
  margin-top: 14px;
  overflow: hidden;
  padding: 13px 14px 10px;
  border-radius: 16px;
  background:
    radial-gradient(340px 190px at 100% -10%, rgba(194, 58, 52, 0.2), transparent 72%),
    linear-gradient(145deg, #191817 0%, #101010 72%);
  color: #f7f3eb;
}

.history-stage .history-section-head h3 {
  color: #f7f3eb;
}

.history-stage .history-section-head p,
.history-stage .history-section-head > span {
  color: #b6b1a8;
}

.history-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  color: #b6b1a8;
  font-size: 8.5px;
}

.history-foot-actions {
  display: flex;
  flex: none;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.history-legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.history-legend i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.history-score {
  margin-top: 14px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 13px;
}

.history-score-head,
.history-score-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) repeat(3, minmax(68px, 0.6fr));
  gap: 10px;
  align-items: center;
  padding: 8px 12px;
}

.history-score-head {
  background: var(--panel-soft);
  color: var(--ink-3);
  font-size: 8px;
  text-align: right;
}

.history-score-head span:first-child {
  text-align: left;
}

.history-score-row {
  border-top: 1px solid var(--line);
}

.history-score-row > span:first-child {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.history-score-row > span:first-child strong {
  color: var(--ink);
  font-size: 9.5px;
}

.history-score-row > span:first-child small {
  color: var(--ink-3);
  font-family: var(--font-data);
  font-size: 8px;
}

.history-score-row > strong,
.history-drawdown,
.history-winrate {
  font-family: var(--font-data);
  font-size: 9.5px;
  text-align: right;
  white-space: nowrap;
}

.history-drawdown,
.history-winrate {
  color: var(--ink-2);
}

.history-empty {
  display: grid;
  min-height: 220px;
  place-items: center;
  align-content: center;
  gap: 7px;
  margin-top: 14px;
  color: var(--ink-3);
  text-align: center;
}

.history-empty strong {
  color: var(--ink);
  font-size: 12px;
}

.history-empty p {
  max-width: 320px;
  margin: 0;
  font-size: 10px;
  line-height: 1.55;
}

.history-foot {
  align-items: center;
  padding-top: 11px;
  padding-bottom: 11px;
  border-top: 1px solid var(--line);
  border-bottom: 0;
  color: var(--ink-3);
  font-size: 8.5px;
}

@media (max-width: 720px) {
  .history-backdrop {
    align-items: end;
    padding: 0;
  }

  .history-dialog {
    width: 100%;
    max-height: 92vh;
    border-radius: 22px 22px 0 0;
  }

  .history-head,
  .history-foot {
    padding-right: 16px;
    padding-left: 16px;
  }

  .history-foot {
    align-items: flex-start;
    flex-direction: column;
  }

  .history-foot-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .history-body {
    padding: 14px 16px 16px;
  }

  .history-versions {
    grid-template-columns: minmax(0, 1fr);
  }

  .history-versions button {
    min-height: 54px;
  }

  .history-score-head,
  .history-score-row {
    grid-template-columns: minmax(0, 1.3fr) repeat(3, minmax(58px, 0.6fr));
    gap: 7px;
    padding-right: 10px;
    padding-left: 10px;
  }
}
</style>
