<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { TrendPoint } from "../types";
import { visiblePriceAlertLevels, type PriceAlertLevel } from "../lib/alerts";
import { formatPrice } from "../lib/format";

const props = withDefaults(
  defineProps<{
    points: TrendPoint[];
    loading?: boolean;
    tone?: "up" | "down" | "flat";
    digits?: number;
    label?: string;
    levels?: PriceAlertLevel[];
  }>(),
  { loading: false, tone: "flat", digits: 2, label: "价格走势", levels: () => [] },
);

const wrap = ref<HTMLDivElement | null>(null);
const width = ref(640);
const height = 248;
const pad = { top: 18, right: 58, bottom: 26, left: 6 };
const hover = ref<number | null>(null);
let observer: ResizeObserver | null = null;

onMounted(() => {
  if (!wrap.value) return;
  observer = new ResizeObserver((entries) => {
    const next = entries[0]?.contentRect.width ?? 640;
    width.value = Math.max(280, next);
  });
  observer.observe(wrap.value);
  width.value = Math.max(280, wrap.value.clientWidth);
});

onBeforeUnmount(() => observer?.disconnect());

const values = computed(() => props.points.map((point) => point.value));

const chartLevels = computed(() => visiblePriceAlertLevels(props.points, props.levels));

const bounds = computed(() => {
  if (!values.value.length) return { min: 0, max: 1 };
  let min = Math.min(...values.value);
  let max = Math.max(...values.value);
  if (min === max) {
    min -= Math.max(0.0001, Math.abs(min) * 0.002);
    max += Math.max(0.0001, Math.abs(max) * 0.002);
  }
  const room = (max - min) * 0.14;
  return { min: min - room, max: max + room };
});

function xFor(index: number) {
  const usable = width.value - pad.left - pad.right;
  if (props.points.length <= 1) return pad.left + usable / 2;
  return pad.left + (index / (props.points.length - 1)) * usable;
}

function yFor(value: number) {
  const usable = height - pad.top - pad.bottom;
  const ratio = (value - bounds.value.min) / (bounds.value.max - bounds.value.min || 1);
  return pad.top + (1 - ratio) * usable;
}

function levelTone(level: PriceAlertLevel) {
  return level.tone === "up" ? "var(--trend-up)" : "var(--trend-down)";
}

function levelGeometry(level: PriceAlertLevel) {
  const rawY = yFor(level.threshold);
  if (rawY < pad.top) {
    return { y: pad.top, labelY: pad.top + 11 };
  }
  if (rawY > height - pad.bottom) {
    return { y: height - pad.bottom, labelY: height - pad.bottom - 6 };
  }
  return { y: rawY, labelY: rawY - 5 };
}

function levelLabel(level: PriceAlertLevel) {
  const rawY = yFor(level.threshold);
  const location =
    rawY < pad.top ? " · 区间上方" : rawY > height - pad.bottom ? " · 区间下方" : "";
  return `${level.label} ${formatPrice(level.threshold, props.digits)}${location}`;
}

const linePath = computed(() => {
  const points = props.points;
  if (!points.length) return "";
  if (points.length === 1) {
    const x = xFor(0);
    const y = yFor(points[0].value);
    return `M ${x - 1} ${y} L ${x + 1} ${y}`;
  }
  let path = `M ${xFor(0)} ${yFor(points[0].value)}`;
  for (let index = 1; index < points.length; index += 1) {
    const prevX = xFor(index - 1);
    const currX = xFor(index);
    const midX = (prevX + currX) / 2;
    path += ` C ${midX} ${yFor(points[index - 1].value)}, ${midX} ${yFor(points[index].value)}, ${currX} ${yFor(points[index].value)}`;
  }
  return path;
});

const areaPath = computed(() => {
  if (!props.points.length) return "";
  const base = height - pad.bottom;
  return `${linePath.value} L ${xFor(props.points.length - 1)} ${base} L ${xFor(0)} ${base} Z`;
});

const gridLines = computed(() => {
  const steps = 4;
  return Array.from({ length: steps + 1 }, (_, index) => {
    const value = bounds.value.max - ((bounds.value.max - bounds.value.min) * index) / steps;
    return { y: pad.top + (index / steps) * (height - pad.top - pad.bottom), value };
  });
});

const xTicks = computed(() => {
  const points = props.points;
  if (!points.length) return [];
  const count = Math.min(5, points.length);
  return Array.from({ length: count }, (_, index) => {
    const pointIndex = Math.round((index / Math.max(1, count - 1)) * (points.length - 1));
    return { x: xFor(pointIndex), label: points[pointIndex].label };
  });
});

function onMove(event: MouseEvent) {
  if (!props.points.length) return;
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
  const ratio = (event.clientX - rect.left) / rect.width;
  const usable = width.value - pad.left - pad.right;
  const raw = ((ratio * width.value - pad.left) / usable) * (props.points.length - 1);
  hover.value = Math.max(0, Math.min(props.points.length - 1, Math.round(raw)));
}

const hoverPoint = computed(() => {
  if (hover.value == null) return null;
  const point = props.points[hover.value];
  if (!point) return null;
  return {
    point,
    x: xFor(hover.value),
    y: yFor(point.value),
    left: `${(xFor(hover.value) / width.value) * 100}%`,
  };
});

const chartColor = computed(() => {
  if (props.tone === "up") return "var(--trend-up)";
  if (props.tone === "down") return "var(--trend-down)";
  return "var(--gold)";
});

const gradientId = `trend-${Math.random().toString(36).slice(2, 8)}`;
</script>

<template>
  <div ref="wrap" class="trend-chart" :style="{ '--chart-color': chartColor }">
    <div v-if="loading" class="chart-skeleton">
      <span class="skeleton" />
      <span class="skeleton" />
      <span class="skeleton" />
    </div>
    <div v-else-if="!points.length" class="chart-empty">
      <span>暂无走势数据</span>
      <small>行情源暂未返回该区间</small>
    </div>
    <svg
      v-else
      :viewBox="`0 0 ${width} ${height}`"
      :width="width"
      :height="height"
      role="img"
      :aria-label="`${label}${chartLevels.length ? `，包含 ${chartLevels.length} 条价格提醒线` : ''}`"
      @mousemove="onMove"
      @mouseleave="hover = null"
    >
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="currentColor" stop-opacity=".2" />
          <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
        </linearGradient>
      </defs>
      <g class="chart-grid">
        <line
          v-for="line in gridLines"
          :key="line.y"
          :x1="pad.left"
          :x2="width - pad.right"
          :y1="line.y"
          :y2="line.y"
        />
        <text
          v-for="line in gridLines"
          :key="`t-${line.y}`"
          :x="width - pad.right + 8"
          :y="line.y + 3.5"
          class="chart-axis"
        >
          {{ formatPrice(line.value, digits) }}
        </text>
      </g>
      <path :d="areaPath" :fill="`url(#${gradientId})`" class="chart-area" />
      <g
        v-for="level in chartLevels"
        :key="level.id"
        class="chart-level"
        :class="{ triggered: level.triggered }"
        :style="{ '--level-color': levelTone(level) }"
      >
        <line
          :x1="pad.left"
          :x2="width - pad.right"
          :y1="levelGeometry(level).y"
          :y2="levelGeometry(level).y"
        />
        <text :x="pad.left + 5" :y="levelGeometry(level).labelY">
          {{ levelLabel(level) }}
        </text>
      </g>
      <path :d="linePath" class="chart-line" />
      <g class="chart-x">
        <text v-for="tick in xTicks" :key="`${tick.x}-${tick.label}`" :x="tick.x" :y="height - 7" class="chart-axis">
          {{ tick.label }}
        </text>
      </g>
      <g v-if="hoverPoint" class="chart-hover">
        <line :x1="hoverPoint.x" :x2="hoverPoint.x" :y1="pad.top" :y2="height - pad.bottom" />
        <circle :cx="hoverPoint.x" :cy="hoverPoint.y" r="4" />
      </g>
    </svg>
    <div v-if="hoverPoint" class="chart-tooltip" :style="{ left: hoverPoint.left }">
      <span>{{ hoverPoint.point.label }}</span>
      <strong>{{ formatPrice(hoverPoint.point.value, digits) }}</strong>
    </div>
  </div>
</template>
