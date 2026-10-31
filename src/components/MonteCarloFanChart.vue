<script setup lang="ts">
import { computed } from "vue";
import type { MonteCarloBand } from "../lib/monte-carlo";

const props = defineProps<{ bands: MonteCarloBand[] }>();
const width = 640;
const height = 232;
const pad = { top: 18, right: 54, bottom: 24, left: 8 };

const bounds = computed(() => {
  const values = props.bands.flatMap((band) => [band.p05, band.p95, 0]);
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  if (minimum === maximum) {
    minimum -= 1;
    maximum += 1;
  }
  const room = Math.max(1, (maximum - minimum) * 0.1);
  return { minimum: minimum - room, maximum: maximum + room };
});

function xFor(index: number) {
  const usable = width - pad.left - pad.right;
  return pad.left + (index / Math.max(1, props.bands.length - 1)) * usable;
}

function yFor(value: number) {
  const usable = height - pad.top - pad.bottom;
  const ratio =
    (value - bounds.value.minimum) /
    Math.max(0.0001, bounds.value.maximum - bounds.value.minimum);
  return pad.top + (1 - ratio) * usable;
}

function linePath(field: "median" | "p25" | "p75") {
  return props.bands
    .map((band, index) => `${index ? "L" : "M"} ${xFor(index)} ${yFor(band[field])}`)
    .join(" ");
}

function areaPath(low: "p05" | "p25", high: "p95" | "p75") {
  const upper = [...props.bands]
    .reverse()
    .map((band, index) => `L ${xFor(props.bands.length - 1 - index)} ${yFor(band[high])}`)
    .join(" ");
  const lower = props.bands
    .map((band, index) => `${index ? "L" : "M"} ${xFor(index)} ${yFor(band[low])}`)
    .join(" ");
  return `${lower} ${upper} Z`;
}

const zeroY = computed(() => yFor(0));
const gridValues = computed(() =>
  Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return {
      value:
        bounds.value.maximum -
        ratio * (bounds.value.maximum - bounds.value.minimum),
      y: pad.top + ratio * (height - pad.top - pad.bottom),
    };
  }),
);
</script>

<template>
  <div class="monte-carlo-chart">
    <div class="monte-carlo-chart-labels" aria-hidden="true">
      <span><i class="outer" />5–95% 区间</span>
      <span><i class="inner" />25–75% 区间</span>
      <span><i class="median" />中位路径</span>
    </div>
    <svg
      :viewBox="`0 0 ${width} ${height}`"
      role="img"
      aria-label="蒙特卡洛模拟收益区间扇形图，显示 5 到 95 分位、25 到 75 分位和中位路径"
    >
      <g class="mc-grid">
        <template v-for="line in gridValues" :key="line.y">
          <line :x1="pad.left" :x2="width - pad.right" :y1="line.y" :y2="line.y" />
          <text :x="width - pad.right + 7" :y="line.y + 3.5">{{ line.value.toFixed(0) }}%</text>
        </template>
      </g>
      <line
        class="mc-zero"
        :x1="pad.left"
        :x2="width - pad.right"
        :y1="zeroY"
        :y2="zeroY"
      />
      <path :d="areaPath('p05', 'p95')" class="mc-band outer" />
      <path :d="areaPath('p25', 'p75')" class="mc-band inner" />
      <path :d="linePath('median')" class="mc-median" />
      <text :x="pad.left" :y="height - 7" class="mc-axis">开始</text>
      <text :x="width - pad.right" :y="height - 7" class="mc-axis end">同周期结束</text>
    </svg>
  </div>
</template>

<style scoped>
.monte-carlo-chart {
  overflow: hidden;
  padding: 10px 10px 4px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel-soft);
}

.monte-carlo-chart-labels {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  padding: 0 4px 4px;
  color: var(--ink-3);
  font-size: 9px;
}

.monte-carlo-chart-labels span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.monte-carlo-chart-labels i {
  display: block;
  width: 12px;
  height: 6px;
  border-radius: 2px;
}

.monte-carlo-chart-labels i.outer {
  background: rgba(194, 58, 52, 0.15);
}

.monte-carlo-chart-labels i.inner {
  background: rgba(194, 58, 52, 0.3);
}

.monte-carlo-chart-labels i.median {
  height: 2px;
  background: #b83c35;
}

svg {
  display: block;
  width: 100%;
  height: auto;
}

.mc-grid line {
  stroke: var(--line);
  stroke-width: 1;
}

.mc-grid text,
.mc-axis {
  fill: var(--ink-3);
  font-family: var(--font-data);
  font-size: 8px;
  font-variant-numeric: tabular-nums;
}

.mc-axis.end {
  text-anchor: end;
}

.mc-zero {
  stroke: var(--line-strong);
  stroke-dasharray: 3 4;
}

.mc-band.outer {
  fill: rgba(194, 58, 52, 0.11);
}

.mc-band.inner {
  fill: rgba(194, 58, 52, 0.22);
}

.mc-median {
  fill: none;
  stroke: #b83c35;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

@media (max-width: 720px) {
  .mc-grid text,
  .mc-axis {
    font-size: 16px;
  }
}
</style>
