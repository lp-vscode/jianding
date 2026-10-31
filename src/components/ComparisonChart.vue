<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { NormalizedTrendPoint } from "../lib/comparison";

export interface ComparisonSeries {
  symbol: string;
  name: string;
  code: string;
  color: string;
  dash: string;
  points: NormalizedTrendPoint[];
  totalReturn: number;
  maxDrawdown: number;
}

const props = defineProps<{
  series: ComparisonSeries[];
}>();

const wrap = ref<HTMLDivElement | null>(null);
const width = ref(640);
const height = 250;
const pad = { top: 20, right: 18, bottom: 30, left: 42 };
const hoverRatio = ref<number | null>(null);
let observer: ResizeObserver | null = null;

onMounted(() => {
  if (!wrap.value) return;
  observer = new ResizeObserver((entries) => {
    width.value = Math.max(300, entries[0]?.contentRect.width ?? 640);
  });
  observer.observe(wrap.value);
  width.value = Math.max(300, wrap.value.clientWidth);
});

onBeforeUnmount(() => observer?.disconnect());

const axisSeries = computed(() =>
  [...props.series].sort((left, right) => right.points.length - left.points.length)[0],
);

const bounds = computed(() => {
  const values = [0, ...props.series.flatMap((item) => item.points.map((point) => point.value))];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const room = Math.max(0.6, (max - min) * 0.12);
  return { min: min - room, max: max + room };
});

function xFor(index: number, length: number) {
  const usable = width.value - pad.left - pad.right;
  if (length <= 1) return pad.left + usable / 2;
  return pad.left + (index / (length - 1)) * usable;
}

function yFor(value: number) {
  const usable = height - pad.top - pad.bottom;
  const ratio = (value - bounds.value.min) / (bounds.value.max - bounds.value.min || 1);
  return pad.top + (1 - ratio) * usable;
}

function linePath(points: NormalizedTrendPoint[]) {
  if (!points.length) return "";
  if (points.length === 1) {
    const x = xFor(0, 1);
    const y = yFor(points[0].value);
    return `M ${x - 1} ${y} L ${x + 1} ${y}`;
  }
  let path = `M ${xFor(0, points.length)} ${yFor(points[0].value)}`;
  for (let index = 1; index < points.length; index += 1) {
    const previousX = xFor(index - 1, points.length);
    const currentX = xFor(index, points.length);
    const middleX = (previousX + currentX) / 2;
    path += ` C ${middleX} ${yFor(points[index - 1].value)}, ${middleX} ${yFor(points[index].value)}, ${currentX} ${yFor(points[index].value)}`;
  }
  return path;
}

const yTicks = computed(() =>
  Array.from({ length: 5 }, (_, index) => {
    const value =
      bounds.value.max - ((bounds.value.max - bounds.value.min) * index) / 4;
    return { y: pad.top + (index / 4) * (height - pad.top - pad.bottom), value };
  }),
);

const xTicks = computed(() => {
  const points = axisSeries.value?.points ?? [];
  if (!points.length) return [];
  const count = Math.min(4, points.length);
  return Array.from({ length: count }, (_, index) => {
    const pointIndex = Math.round((index / Math.max(1, count - 1)) * (points.length - 1));
    return {
      x: xFor(pointIndex, points.length),
      label: points[pointIndex].label,
    };
  });
});

function nearestPoint(points: NormalizedTrendPoint[], ratio: number) {
  if (!points.length) return null;
  const index = Math.round(ratio * Math.max(0, points.length - 1));
  return {
    point: points[index],
    x: xFor(index, points.length),
    y: yFor(points[index].value),
  };
}

const hoverPoints = computed(() => {
  if (hoverRatio.value == null) return [];
  return props.series
    .map((item) => {
      const hit = nearestPoint(item.points, hoverRatio.value ?? 0);
      return hit ? { ...item, ...hit } : null;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
});

const hoverX = computed(() => {
  if (hoverRatio.value == null) return null;
  return pad.left + hoverRatio.value * (width.value - pad.left - pad.right);
});

const tooltipLeft = computed(() => {
  const clamped = Math.min(width.value - 110, Math.max(110, hoverX.value ?? 0));
  return `${(clamped / width.value) * 100}%`;
});

function onMove(event: MouseEvent) {
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
  const localX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
  const usable = width.value - pad.left - pad.right;
  hoverRatio.value = Math.max(0, Math.min(1, (localX - pad.left) / usable));
}

const chartLabel = computed(() => {
  const names = props.series.map((item) => item.name).join("、");
  return `${names} 归一化涨跌对比`;
});
</script>

<template>
  <div ref="wrap" class="comparison-chart">
    <svg
      :viewBox="`0 0 ${width} ${height}`"
      :width="width"
      :height="height"
      role="img"
      :aria-label="chartLabel"
      @mousemove="onMove"
      @mouseleave="hoverRatio = null"
    >
      <g class="comparison-grid">
        <line
          v-for="tick in yTicks"
          :key="tick.y"
          :x1="pad.left"
          :x2="width - pad.right"
          :y1="tick.y"
          :y2="tick.y"
          :class="{ zero: Math.abs(tick.value) < 0.001 }"
        />
        <text
          v-for="tick in yTicks"
          :key="`label-${tick.y}`"
          :x="pad.left - 8"
          :y="tick.y + 3"
          text-anchor="end"
        >
          {{ tick.value >= 0 ? "+" : "" }}{{ tick.value.toFixed(0) }}%
        </text>
        <text
          v-for="tick in xTicks"
          :key="`${tick.x}-${tick.label}`"
          :x="tick.x"
          :y="height - 8"
          text-anchor="middle"
        >
          {{ tick.label }}
        </text>
      </g>

      <path
        v-for="item in series"
        :key="item.symbol"
        :d="linePath(item.points)"
        :stroke="item.color"
        :stroke-dasharray="item.dash"
        class="comparison-line"
      />

      <g v-if="hoverX != null" class="comparison-hover">
        <line :x1="hoverX" :x2="hoverX" :y1="pad.top" :y2="height - pad.bottom" />
        <circle
          v-for="item in hoverPoints"
          :key="item.symbol"
          :cx="item.x"
          :cy="item.y"
          :fill="item.color"
          r="3.6"
        />
      </g>
    </svg>

    <div
      v-if="hoverPoints.length"
      class="comparison-tooltip"
      :style="{ left: tooltipLeft }"
    >
      <small>{{ hoverPoints[0]?.point.label }}</small>
      <span v-for="item in hoverPoints" :key="item.symbol">
        <i :style="{ background: item.color }" />
        <b>{{ item.name }}</b>
        <strong :class="item.point.value >= 0 ? 'up' : 'down'">
          {{ item.point.value >= 0 ? "+" : "" }}{{ item.point.value.toFixed(2) }}%
        </strong>
      </span>
    </div>
  </div>
</template>

<style scoped>
.comparison-chart {
  position: relative;
  width: 100%;
  min-height: 250px;
}

.comparison-chart svg {
  display: block;
  width: 100%;
  overflow: visible;
}

.comparison-grid line {
  stroke: rgba(255, 255, 255, 0.1);
  stroke-width: 1;
}

.comparison-grid line.zero {
  stroke: rgba(255, 255, 255, 0.28);
  stroke-dasharray: 4 5;
}

.comparison-grid text {
  fill: #b6b1a8;
  font-family: var(--font-data);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}

.comparison-line {
  fill: none;
  stroke-width: 2.25;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.comparison-hover line {
  stroke: rgba(255, 255, 255, 0.24);
  stroke-width: 1;
}

.comparison-hover circle {
  stroke: #181716;
  stroke-width: 2;
}

.comparison-tooltip {
  position: absolute;
  top: 5px;
  display: grid;
  min-width: 158px;
  max-width: 230px;
  gap: 5px;
  padding: 9px 10px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 10px;
  background: rgba(24, 23, 22, 0.96);
  box-shadow: 0 14px 30px -20px rgba(0, 0, 0, 0.9);
  color: #f7f3eb;
  transform: translateX(-50%);
  pointer-events: none;
}

.comparison-tooltip > small {
  color: #b6b1a8;
  font-family: var(--font-data);
  font-size: 8.5px;
}

.comparison-tooltip > span {
  display: grid;
  grid-template-columns: 5px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
}

.comparison-tooltip i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
}

.comparison-tooltip b {
  overflow: hidden;
  font-size: 9px;
  font-weight: 520;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.comparison-tooltip strong {
  font-family: var(--font-data);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}

.comparison-tooltip .up {
  color: #f46b63;
}

.comparison-tooltip .down {
  color: #74d6a3;
}

@media (max-width: 720px) {
  .comparison-tooltip {
    position: static;
    width: 100%;
    max-width: none;
    margin-top: 4px;
    transform: none;
  }
}
</style>
