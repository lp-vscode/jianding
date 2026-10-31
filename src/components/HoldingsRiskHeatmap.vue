<script setup lang="ts">
import { computed, ref } from "vue";
import { Activity, Flame, Gauge } from "lucide-vue-next";
import { directionMark, formatPercent, toneOf } from "../lib/format";

export interface HoldingRiskRow {
  symbol: string;
  name: string;
  weight: number;
  changePct: number;
  amplitudePct: number;
}

const props = defineProps<{
  rows: HoldingRiskRow[];
}>();

const emit = defineEmits<{
  edit: [symbol: string];
}>();

const mode = ref<"change" | "risk">("change");
const sortedRows = computed(() => [...props.rows].sort((left, right) => right.weight - left.weight));
const mostExposed = computed(() => sortedRows.value[0] ?? null);
const riskLeader = computed(() =>
  [...props.rows].sort(
    (left, right) =>
      (right.weight / 100) * right.amplitudePct -
      (left.weight / 100) * left.amplitudePct,
  )[0] ?? null,
);

function tileStrength(row: HoldingRiskRow) {
  const value = mode.value === "change" ? Math.abs(row.changePct) : row.amplitudePct;
  return Math.min(1, value / (mode.value === "change" ? 6 : 8));
}

function tileTone(row: HoldingRiskRow) {
  return mode.value === "change" ? toneOf(row.changePct) : "risk";
}
</script>

<template>
  <section class="panel holdings-risk-panel" aria-labelledby="holdings-risk-title">
    <div class="panel-head">
      <div>
        <h2 id="holdings-risk-title">持仓风险热力图</h2>
        <p>色块面积按持仓权重，颜色按当前涨跌或日内振幅</p>
      </div>
      <div class="risk-mode-switch segmented" role="group" aria-label="风险热力图模式">
        <button
          type="button"
          :class="{ active: mode === 'change' }"
          :aria-pressed="mode === 'change'"
          @click="mode = 'change'"
        >
          涨跌
        </button>
        <button
          type="button"
          :class="{ active: mode === 'risk' }"
          :aria-pressed="mode === 'risk'"
          @click="mode = 'risk'"
        >
          振幅
        </button>
      </div>
    </div>

    <div v-if="rows.length" class="risk-heatmap-body">
      <div class="risk-heatmap-summary">
        <span>
          <Gauge :size="13" aria-hidden="true" />
          最高权重 <strong>{{ mostExposed?.name ?? "--" }} · {{ mostExposed?.weight.toFixed(1) }}%</strong>
        </span>
        <span>
          <Flame :size="13" aria-hidden="true" />
          波动贡献 <strong>{{ riskLeader?.name ?? "--" }} · {{ riskLeader ? ((riskLeader.weight / 100) * riskLeader.amplitudePct).toFixed(2) : "--" }}%</strong>
        </span>
      </div>
      <div class="risk-heatmap">
        <button
          v-for="row in sortedRows"
          :key="row.symbol"
          class="risk-tile"
          :class="tileTone(row)"
          :style="{
            '--risk-width': `${Math.max(1, row.weight)}%`,
            '--risk-strength': tileStrength(row),
          }"
          type="button"
          :aria-label="`${row.name}，权重 ${row.weight.toFixed(1)}%，${mode === 'change' ? `涨跌 ${formatPercent(row.changePct)}` : `日内振幅 ${row.amplitudePct.toFixed(2)}%`}，点击编辑持仓`"
          @click="emit('edit', row.symbol)"
        >
          <span class="risk-tile-head">
            <strong>{{ row.name }}</strong>
            <Activity :size="11" aria-hidden="true" />
          </span>
          <b>
            {{ mode === "change" ? formatPercent(row.changePct) : `${row.amplitudePct.toFixed(2)}%` }}
            <i v-if="mode === 'change'" class="trend-mark" aria-hidden="true">{{ directionMark(row.changePct) }}</i>
          </b>
          <span class="risk-tile-foot">
            <span>权重 {{ row.weight.toFixed(1) }}%</span>
            <span>{{ mode === "change" ? `振幅 ${row.amplitudePct.toFixed(2)}%` : "日内振幅" }}</span>
          </span>
        </button>
      </div>
    </div>
    <div v-else class="risk-heatmap-empty">
      <Activity :size="19" :stroke-width="1.5" />
      <span>添加持仓后，这里会显示权重与波动暴露。</span>
    </div>
  </section>
</template>

<style scoped>
.holdings-risk-panel {
  margin-top: 12px;
  overflow: hidden;
}

.risk-mode-switch {
  flex: none;
  padding: 2px;
}

.risk-mode-switch button {
  min-height: 26px;
  padding: 0 9px;
  font-size: 8.5px;
}

.risk-heatmap-body {
  padding: 12px 18px 15px;
}

.risk-heatmap-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 7px 16px;
  margin-bottom: 10px;
  color: var(--ink-3);
  font-size: 8.5px;
}

.risk-heatmap-summary > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.risk-heatmap-summary svg {
  color: var(--up);
}

.risk-heatmap-summary strong {
  color: var(--ink-2);
  font-weight: 600;
}

.risk-heatmap {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.risk-tile {
  display: grid;
  min-width: 108px;
  min-height: 92px;
  flex: 0 1 var(--risk-width);
  align-content: space-between;
  gap: 8px;
  overflow: hidden;
  padding: 11px;
  border: 1px solid transparent;
  border-radius: 13px;
  color: var(--ink);
  text-align: left;
  transition:
    filter 150ms ease,
    transform 150ms ease;
}

.risk-tile:hover,
.risk-tile:focus-visible {
  filter: brightness(1.03);
  transform: translateY(-1px);
}

.risk-tile.up {
  border-color: rgba(194, 58, 52, 0.12);
  background:
    linear-gradient(rgba(194, 58, 52, calc(0.04 + var(--risk-strength) * 0.12)), rgba(194, 58, 52, 0.035)),
    var(--panel-soft);
}

.risk-tile.down {
  border-color: rgba(40, 131, 88, 0.12);
  background:
    linear-gradient(rgba(40, 131, 88, calc(0.04 + var(--risk-strength) * 0.1)), rgba(40, 131, 88, 0.03)),
    var(--panel-soft);
}

.risk-tile.flat {
  border-color: var(--line);
  background: var(--panel-soft);
}

.risk-tile.risk {
  border-color: rgba(164, 127, 67, 0.14);
  background:
    linear-gradient(rgba(164, 127, 67, calc(0.05 + var(--risk-strength) * 0.14)), rgba(164, 127, 67, 0.04)),
    var(--panel-soft);
}

.risk-tile-head,
.risk-tile-foot {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.risk-tile-head strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 10.5px;
  font-weight: 620;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.risk-tile-head svg {
  flex: none;
  color: var(--ink-3);
}

.risk-tile > b {
  font-family: var(--font-data);
  font-size: clamp(20px, 2.3vw, 28px);
  font-variant-numeric: tabular-nums;
  font-weight: 620;
  letter-spacing: -0.04em;
  line-height: 1;
}

.risk-tile.up > b {
  color: var(--up);
}

.risk-tile.down > b {
  color: var(--down);
}

.risk-tile.flat > b,
.risk-tile.risk > b {
  color: var(--gold-strong);
}

.risk-tile-foot {
  color: var(--ink-3);
  font-family: var(--font-data);
  font-size: 8px;
}

.risk-heatmap-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 20px 18px;
  color: var(--ink-3);
  font-size: 10px;
}

@media (max-width: 720px) {
  .risk-heatmap-body {
    padding: 11px 14px 13px;
  }

  .risk-heatmap-summary {
    display: grid;
    gap: 5px;
  }

  .risk-tile {
    min-height: 88px;
    min-width: 92px;
    padding: 9px;
  }
}
</style>
