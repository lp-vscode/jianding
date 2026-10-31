<script setup lang="ts">
import { computed } from "vue";
import {
  Activity,
  ArrowUpRight,
  BellRing,
  Clock3,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-vue-next";
import type { Asset } from "../types";
import { state } from "../lib/store";
import { buildMarketBrief } from "../lib/brief";
import { directionMark, formatPercent, toneOf } from "../lib/format";
import { marketPhase } from "../lib/market";

const props = defineProps<{
  assets: Asset[];
  dataDelayed: boolean;
}>();

const emit = defineEmits<{
  select: [symbol: string];
  showAlerts: [];
  createAlert: [symbol: string];
  refresh: [];
}>();

const brief = computed(() =>
  buildMarketBrief(props.assets, state.quotes, state.events, state.indices, props.dataDelayed),
);

const phase = computed(() => marketPhase(new Date()));
const activityLabel = computed(() => (phase.value === "交易中" ? "盘中异动" : "收盘异动"));

const briefSummary = computed(() => {
  if (!brief.value.count) return "当前分组没有标的";
  if (!brief.value.observedCount) return "正在同步当前分组的行情";
  if (brief.value.stale) return "数据可能滞后，刷新后再判断强弱";

  const facts = [`${brief.value.upCount} 涨 · ${brief.value.downCount} 跌`];
  if (brief.value.flatCount) facts[0] += ` · ${brief.value.flatCount} 平`;
  if (brief.value.spread != null && brief.value.observedCount > 1) {
    facts.push(`首尾差 ${brief.value.spread.toFixed(2)} 个百分点`);
  }
  if (brief.value.benchmarkName && brief.value.relativeChange != null) {
    const relation = brief.value.relativeChange >= 0 ? "高" : "低";
    facts.push(
      `较${brief.value.benchmarkName}${relation} ${Math.abs(brief.value.relativeChange).toFixed(2)} 个百分点`,
    );
  }
  return facts.join(" · ");
});

function compactAssetName(name: string) {
  const normalized = name.replace(/\s+/g, "");
  if (normalized.includes("沪深300")) return normalized.includes("ETF") ? "沪深300ETF" : "沪深300";
  if (normalized.includes("白酒")) return normalized.includes("ETF") ? "白酒ETF" : "白酒指数";
  if (normalized.includes("半导体")) return "半导体";
  if (normalized.includes("医疗")) return "医疗";
  if (normalized.includes("银行")) return "银行";
  return normalized.length > 8 ? `${normalized.slice(0, 8)}…` : normalized;
}

const signalLabel = computed(() => {
  const signals = brief.value.signals;
  if (!signals.length) return "";
  const names = signals.slice(0, 2).map((item) => item.asset.name).join("、");
  return signals.length > 2
    ? `${names} 等 ${signals.length} 只标的出现${activityLabel.value}`
    : `${names} 出现${activityLabel.value}`;
});

const decisionMeta = computed(() => {
  if (brief.value.stale) return "需要刷新";
  if (brief.value.unreadAlerts) return `${brief.value.unreadAlerts} 条待处理`;
  if (brief.value.signals.length) return `${brief.value.signals.length} 条信号`;
  return brief.value.observedCount ? "已同步" : "同步中";
});

const poles = computed(() => {
  const ranked = props.assets
    .map((asset) => {
      const changePct = state.quotes[asset.symbol]?.changePct;
      return {
        asset,
        changePct:
          changePct != null && Number.isFinite(changePct) ? changePct : null,
      };
    })
    .filter(
      (item): item is { asset: Asset; changePct: number } =>
        item.changePct != null,
    )
    .sort((left, right) => right.changePct - left.changePct);
  if (!ranked.length) return [];
  const selected =
    ranked.length <= 4
      ? ranked
      : [...ranked.slice(0, 2), ...ranked.slice(-2)];
  const maxAmplitude = Math.max(...selected.map((item) => Math.abs(item.changePct)), 0.01);
  return selected.map((item, index) => ({
    ...item,
    name: compactAssetName(item.asset.name),
    tone: toneOf(item.changePct),
    height: `${Math.max(4, (Math.abs(item.changePct) / maxAmplitude) * 24).toFixed(1)}px`,
    delay: `${180 + index * 45}ms`,
  }));
});

const action = computed(() => {
  if (brief.value.stale) {
    return {
      key: "refresh",
      icon: RefreshCw,
      label: "行情快照可能已过期",
      detail: "刷新后再判断当前强弱",
      cta: "立即刷新",
    } as const;
  }
  if (brief.value.unreadAlerts > 0) {
    return {
      key: "alerts",
      icon: BellRing,
      label: `${brief.value.unreadAlerts} 条提醒待确认`,
      detail: "触发记录已保留，可回到提醒页处理",
      cta: "查看提醒",
    } as const;
  }
  if (brief.value.signals.length > 0) {
    return {
      key: "signal",
      icon: Activity,
      label: `${brief.value.signals.length} 个${activityLabel.value}`,
      detail: signalLabel.value,
      cta: "查看标的",
    } as const;
  }
  if (brief.value.strongest) {
    return {
      key: "create-alert",
      icon: BellRing,
      label: "把观察变成条件",
      detail: `为 ${brief.value.strongest.asset.name} 设置提醒`,
      cta: "新建提醒",
    } as const;
  }
  return {
    key: "waiting",
    icon: Clock3,
    label: "等待行情汇入",
    detail: "数据就绪后会在这里给出优先动作",
    cta: "",
  } as const;
});

function runAction() {
  if (action.value.key === "refresh") {
    emit("refresh");
    return;
  }
  if (action.value.key === "alerts") {
    emit("showAlerts");
    return;
  }
  const symbol =
    action.value.key === "signal"
      ? brief.value.signals[0]?.asset.symbol
      : brief.value.strongest?.asset.symbol;
  if (!symbol) return;
  if (action.value.key === "create-alert") {
    emit("createAlert", symbol);
    return;
  }
  emit("select", symbol);
}
</script>

<template>
  <section class="market-radar" aria-labelledby="market-brief-title">
    <div class="market-radar-meta">
      <span>{{ brief.observedCount }} / {{ brief.count }} 只标的已同步</span>
      <span v-if="brief.benchmarkName" class="market-radar-benchmark">
        {{ brief.benchmarkName }}
        <b :class="toneOf(brief.benchmarkChange)">
          {{ formatPercent(brief.benchmarkChange) }}
          <i class="trend-mark" aria-hidden="true">{{ directionMark(brief.benchmarkChange) }}</i>
        </b>
      </span>
    </div>

    <h2 id="market-brief-title">{{ brief.headline }}</h2>
    <p class="market-radar-summary">{{ briefSummary }}</p>

    <div class="market-radar-board" :class="{ 'is-single': brief.observedCount === 1 }">
      <div
        class="market-radar-primary"
        :class="{
          'is-up': brief.tone === 'up',
          'is-down': brief.tone === 'down',
          'is-flat': brief.tone === 'flat',
        }"
      >
        <div class="market-radar-primary-head">
          <span class="market-radar-primary-label">自选等权</span>
          <span class="market-radar-primary-breadth">
            <b>{{ brief.upCount }}</b> 涨
            <i aria-hidden="true">/</i>
            <b>{{ brief.downCount }}</b> 跌
          </span>
        </div>
        <strong class="market-radar-primary-value">
          {{ formatPercent(brief.averageChange) }}
        </strong>
      </div>

      <div v-if="brief.observedCount > 1" class="market-radar-extremes">
        <button
          v-if="brief.strongest"
          type="button"
          :aria-label="`领涨 ${brief.strongest.asset.name}，${formatPercent(brief.strongest.changePct)}`"
          @click="emit('select', brief.strongest.asset.symbol)"
        >
          <span class="market-radar-extreme-label">
            <TrendingUp :size="12" :stroke-width="1.8" aria-hidden="true" />
            领涨
          </span>
          <span class="market-radar-extreme-name" :title="brief.strongest.asset.name">
            {{ compactAssetName(brief.strongest.asset.name) }}
          </span>
          <strong :class="toneOf(brief.strongest.changePct)">
            {{ formatPercent(brief.strongest.changePct) }}
          </strong>
        </button>
        <button
          v-if="brief.weakest"
          type="button"
          :aria-label="`最弱 ${brief.weakest.asset.name}，${formatPercent(brief.weakest.changePct)}`"
          @click="emit('select', brief.weakest.asset.symbol)"
        >
          <span class="market-radar-extreme-label">
            <TrendingDown :size="12" :stroke-width="1.8" aria-hidden="true" />
            最弱
          </span>
          <span class="market-radar-extreme-name" :title="brief.weakest.asset.name">
            {{ compactAssetName(brief.weakest.asset.name) }}
          </span>
          <strong :class="toneOf(brief.weakest.changePct)">
            {{ formatPercent(brief.weakest.changePct) }}
          </strong>
        </button>
      </div>
    </div>

    <div
      v-if="poles.length"
      class="market-radar-rhythm"
      :style="{ '--pole-count': poles.length }"
      aria-label="当前分组的涨跌幅度柱"
    >
      <div
        v-for="pole in poles"
        :key="pole.asset.symbol"
        class="market-radar-pole"
        :class="`is-${pole.tone}`"
        :title="`${pole.asset.name} ${formatPercent(pole.changePct)}`"
        :aria-label="`${pole.asset.name} ${formatPercent(pole.changePct)}`"
      >
        <span class="market-radar-pole-name">{{ pole.name }}</span>
        <span class="market-radar-pole-track" aria-hidden="true">
          <i
            :style="{
              '--pole-height': pole.height,
              '--pole-delay': pole.delay,
            }"
          />
        </span>
        <strong :class="toneOf(pole.changePct)">{{ formatPercent(pole.changePct) }}</strong>
      </div>
    </div>

    <div class="market-radar-facts">
      <span>首尾差</span>
      <strong>{{ brief.spread == null ? "--" : `${brief.spread.toFixed(2)} pt` }}</strong>
      <i aria-hidden="true" />
      <span>{{ activityLabel }}</span>
      <strong>{{ brief.signals.length }} 只</strong>
    </div>

    <button
      class="market-radar-action"
      type="button"
      :disabled="!action.cta"
      @click="runAction"
    >
      <span class="market-radar-action-icon" aria-hidden="true">
        <component :is="action.icon" :size="18" :stroke-width="1.75" />
      </span>
      <span class="market-radar-action-copy">
        <span class="market-radar-action-head">
          <strong>{{ action.label }}</strong>
          <small>{{ decisionMeta }}</small>
        </span>
        <small class="market-radar-action-detail">{{ action.detail }}</small>
      </span>
      <span v-if="action.cta" class="market-radar-action-cta">
        {{ action.cta }}
        <ArrowUpRight :size="14" aria-hidden="true" />
      </span>
    </button>

    <p class="market-radar-note">仅汇总当前分组与本机数据，不替代个人判断。</p>
  </section>
</template>

<style scoped>
.market-radar {
  position: relative;
  margin-bottom: var(--space-4);
  overflow: hidden;
  padding: 18px 20px 13px;
  border: 1px solid rgba(237, 94, 88, 0.18);
  border-radius: 22px;
  background:
    radial-gradient(420px 220px at 100% -8%, rgba(194, 58, 52, 0.3), transparent 68%),
    radial-gradient(360px 200px at -8% 104%, rgba(215, 189, 136, 0.08), transparent 70%),
    linear-gradient(145deg, #181716 0%, #0f0f0f 68%, #10100f 100%);
  box-shadow: 0 26px 58px -40px rgba(0, 0, 0, 0.8);
  color: #f7f3eb;
  animation: market-radar-in 480ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.market-radar::before {
  position: absolute;
  top: 0;
  right: 18%;
  left: 18%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 236, 220, 0.46), transparent);
  content: "";
  pointer-events: none;
}

.market-radar-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  color: #b6b1a8;
  font-family: var(--font-data);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
}

.market-radar-benchmark {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.market-radar-benchmark b {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-weight: 600;
}

.market-radar h2 {
  max-width: 21ch;
  margin: 10px 0 6px;
  color: #f7f3eb;
  font-size: clamp(24px, 2.3vw, 30px);
  font-weight: 660;
  letter-spacing: -0.035em;
  line-height: 1.08;
  text-wrap: balance;
  animation: market-radar-rise 430ms 50ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.market-radar-summary {
  margin: 0;
  color: #b6b1a8;
  font-family: var(--font-data);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  line-height: 1.5;
  animation: market-radar-rise 430ms 90ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.market-radar-board {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
  gap: 8px;
  margin-top: 12px;
  animation: market-radar-rise 440ms 130ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.market-radar-rhythm {
  display: grid;
  grid-template-columns: repeat(var(--pole-count, 4), minmax(0, 1fr));
  gap: 8px;
  margin-top: 9px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.065);
  animation: market-radar-rise 420ms 160ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.market-radar-pole {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 4px 6px;
}

.market-radar-pole-name {
  min-width: 0;
  overflow: hidden;
  color: #aaa69e;
  font-size: 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.market-radar-pole-track {
  position: relative;
  display: block;
  height: 52px;
  grid-row: 2;
  grid-column: 1 / -1;
  border-radius: 4px;
  background:
    linear-gradient(
      180deg,
      transparent calc(50% - 0.5px),
      rgba(255, 255, 255, 0.13) calc(50% - 0.5px),
      rgba(255, 255, 255, 0.13) calc(50% + 0.5px),
      transparent calc(50% + 0.5px)
    );
}

.market-radar-pole-track i {
  position: absolute;
  left: 50%;
  width: 7px;
  height: var(--pole-height);
  border-radius: 4px 4px 2px 2px;
  transform: translateX(-50%) scaleY(0);
  animation: market-radar-pole-grow 460ms var(--pole-delay)
    cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.market-radar-pole.is-up .market-radar-pole-track i {
  bottom: 50%;
  background: #e34c45;
  transform-origin: bottom;
}

.market-radar-pole.is-down .market-radar-pole-track i {
  top: 50%;
  border-radius: 2px 2px 4px 4px;
  background: #27a66b;
  transform-origin: top;
}

.market-radar-pole.is-flat .market-radar-pole-track i {
  top: calc(50% - 2px);
  height: 3px;
  border-radius: 999px;
  background: #98948c;
  transform-origin: center;
}

.market-radar-pole > strong {
  grid-row: 1;
  grid-column: 2;
  font-family: var(--font-data);
  font-size: 8.5px;
  font-variant-numeric: tabular-nums;
  font-weight: 620;
  white-space: nowrap;
}

.market-radar-pole > strong.up {
  color: #f46b63;
}

.market-radar-pole > strong.down {
  color: #74d6a3;
}

.market-radar-pole > strong.flat {
  color: #b6b1a8;
}

.market-radar-board.is-single {
  grid-template-columns: minmax(0, 1fr);
}

.market-radar-board.is-single .market-radar-primary {
  min-height: 88px;
}

.market-radar-primary {
  position: relative;
  display: flex;
  min-height: 88px;
  flex-direction: column;
  justify-content: center;
  overflow: hidden;
  padding: 10px 13px;
  border-radius: 15px;
  color: #f7f3eb;
}

.market-radar-primary.is-up {
  background:
    radial-gradient(160px 90px at 100% 100%, rgba(255, 242, 227, 0.1), transparent 72%),
    linear-gradient(145deg, #c23a34 0%, #a72e2b 100%);
}

.market-radar-primary.is-down {
  background:
    radial-gradient(160px 90px at 100% 100%, rgba(233, 255, 242, 0.09), transparent 72%),
    linear-gradient(145deg, #0b6943 0%, #084a30 100%);
}

.market-radar-primary.is-flat {
  background:
    radial-gradient(160px 90px at 100% 100%, rgba(255, 255, 255, 0.07), transparent 72%),
    linear-gradient(145deg, #3b3b3f 0%, #29292c 100%);
}

.market-radar-primary::after {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 48%;
  background: linear-gradient(90deg, transparent, rgba(0, 0, 0, 0.08));
  content: "";
  pointer-events: none;
}

.market-radar-primary-head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.market-radar-primary-label,
.market-radar-primary-breadth {
  font-size: 9px;
  font-weight: 560;
  letter-spacing: 0.02em;
}

.market-radar-primary-breadth {
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.market-radar-primary-breadth b {
  font-weight: 650;
}

.market-radar-primary-breadth i {
  margin: 0 4px;
  font-style: normal;
  opacity: 0.55;
}

.market-radar-primary-value {
  position: relative;
  z-index: 1;
  margin: 7px 0 0;
  font-family: var(--font-data);
  font-size: clamp(28px, 3.25vw, 38px);
  font-variant-numeric: tabular-nums;
  font-weight: 620;
  letter-spacing: -0.04em;
  line-height: 1;
}

.market-radar-extremes {
  display: grid;
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.market-radar-extremes button {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  align-content: center;
  gap: 1px 8px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.035);
  color: inherit;
  text-align: left;
  transition:
    background 160ms ease,
    border-color 160ms ease;
}

.market-radar-extremes button:hover,
.market-radar-extremes button:focus-visible {
  border-color: rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.07);
}

.market-radar-extremes button {
  animation: market-radar-extreme-in 400ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.market-radar-extremes button:nth-child(1) {
  animation-delay: 150ms;
}

.market-radar-extremes button:nth-child(2) {
  animation-delay: 205ms;
}

.market-radar-extreme-label {
  display: inline-flex;
  grid-row: 1;
  grid-column: 1;
  align-items: center;
  gap: 4px;
  color: #b6b1a8;
  font-size: 8.5px;
}

.market-radar-extreme-label svg {
  color: #f46b63;
}

.market-radar-extreme-name {
  grid-row: 2;
  grid-column: 1;
  min-width: 0;
  overflow: hidden;
  color: #f7f3eb;
  font-size: 10.5px;
  font-weight: 560;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.market-radar-extremes strong {
  grid-row: 1 / span 2;
  grid-column: 2;
  align-self: center;
  font-family: var(--font-data);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 620;
}

.market-radar-facts {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 9px;
  color: #9f9b93;
  font-size: 9px;
}

.market-radar-facts strong {
  color: #e9e5dd;
  font-family: var(--font-data);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.market-radar-facts i {
  width: 1px;
  height: 11px;
  margin: 0 3px;
  background: rgba(255, 255, 255, 0.14);
}

.market-radar-action {
  display: grid;
  width: 100%;
  min-height: 56px;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  margin-top: 9px;
  padding: 9px 11px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.035);
  color: inherit;
  text-align: left;
  transition:
    background 160ms ease,
    border-color 160ms ease;
}

.market-radar-action:hover:not(:disabled),
.market-radar-action:focus-visible {
  border-color: rgba(244, 107, 99, 0.4);
  background: rgba(255, 255, 255, 0.065);
}

.market-radar-action:disabled {
  opacity: 0.68;
}

.market-radar-action-icon {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 11px;
  background: #c23a34;
  color: #fff7ef;
}

.market-radar-action-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.market-radar-action-head {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.market-radar-action-head strong {
  color: #f7f3eb;
  font-size: 11.5px;
  font-weight: 620;
}

.market-radar-action-head small {
  flex: none;
  color: #b6b1a8;
  font-family: var(--font-data);
  font-size: 8.5px;
}

.market-radar-action-detail {
  overflow: hidden;
  color: #a8a49b;
  font-size: 9px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.market-radar-action-cta {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  gap: 3px;
  padding: 0 11px;
  border-radius: 999px;
  background: #e84841;
  color: #111111;
  font-size: 9.5px;
  font-weight: 680;
  white-space: nowrap;
}

.market-radar-note {
  margin: 10px 0 0;
  color: #918d86;
  font-size: 8px;
  text-align: center;
}

@keyframes market-radar-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.992);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes market-radar-rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes market-radar-extreme-in {
  from {
    opacity: 0;
    transform: translateX(10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes market-radar-pole-grow {
  to {
    transform: translateX(-50%) scaleY(1);
  }
}

@media (max-width: 720px) {
  .market-radar {
    margin-bottom: var(--space-3);
    padding: 14px 16px 11px;
    border-radius: 17px;
  }

  .market-radar-meta {
    font-size: 9px;
  }

  .market-radar h2 {
    margin: 8px 0 5px;
    font-size: 21px;
  }

  .market-radar-summary {
    font-size: 9.5px;
  }

  .market-radar-board {
    gap: 7px;
    margin-top: 10px;
  }

  .market-radar-primary {
    min-height: 84px;
    padding: 9px 11px;
    border-radius: 14px;
  }

  .market-radar-primary-value {
    margin-top: 5px;
    font-size: 28px;
  }

  .market-radar-extremes {
    gap: 7px;
  }

  .market-radar-extremes button {
    padding: 7px 9px;
    border-radius: 12px;
  }

  .market-radar-extreme-name {
    font-size: 9.5px;
  }

  .market-radar-extremes strong {
    font-size: 11px;
  }

  .market-radar-facts {
    margin-top: 8px;
    font-size: 8.5px;
  }

  .market-radar-rhythm {
    gap: 5px;
    margin-top: 7px;
    padding-top: 7px;
  }

  .market-radar-pole-track {
    height: 48px;
  }

  .market-radar-facts strong {
    font-size: 9.5px;
  }

  .market-radar-action {
    min-height: 50px;
    grid-template-columns: 34px minmax(0, 1fr) auto;
    gap: 8px;
    margin-top: 8px;
    padding: 8px 9px;
    border-radius: 13px;
  }

  .market-radar-action-icon {
    width: 34px;
    height: 34px;
  }

  .market-radar-action-head strong {
    font-size: 10.5px;
  }

  .market-radar-action-detail {
    font-size: 8.5px;
  }

  .market-radar-action-cta {
    min-height: 32px;
    padding: 0 9px;
    font-size: 9px;
  }

  .market-radar-note {
    margin-top: 7px;
    font-size: 7.5px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .market-radar,
  .market-radar h2,
  .market-radar-summary,
  .market-radar-board,
  .market-radar-rhythm,
  .market-radar-extremes button {
    animation: none;
  }

  .market-radar-pole-track i {
    animation: none;
    transform: translateX(-50%) scaleY(1);
  }
}
</style>
