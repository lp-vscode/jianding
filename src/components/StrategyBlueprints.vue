<script setup lang="ts">
import { computed } from "vue";
import { Check, Sparkles } from "lucide-vue-next";
import { showToast, state, updateTradingRisk, updateTradingStrategy } from "../lib/store";
import type { TradingBlueprint } from "../lib/trading-blueprints";
import {
  activeTradingBlueprint,
  TRADING_BLUEPRINTS,
} from "../lib/trading-blueprints";

defineProps<{
  disabled?: boolean;
}>();

const activeKey = computed(() =>
  activeTradingBlueprint(state.trading.strategy, state.trading.risk),
);

function applyBlueprint(blueprint: TradingBlueprint) {
  updateTradingStrategy({
    shortWindow: blueprint.shortWindow,
    longWindow: blueprint.longWindow,
    orderNotional: blueprint.orderNotional,
  });
  updateTradingRisk({ ...blueprint.risk });
  showToast(`已切换为「${blueprint.label}」策略蓝图`, "success");
}
</script>

<template>
  <section class="strategy-blueprints" aria-labelledby="strategy-blueprints-title">
    <div class="blueprint-head">
      <div>
        <h3 id="strategy-blueprints-title"><Sparkles :size="13" aria-hidden="true" /> 策略蓝图</h3>
        <p>一次同步均线、金额与风控，并清空旧回测</p>
      </div>
      <span>{{ activeKey ? "已匹配蓝图" : "当前为自定义参数" }}</span>
    </div>
    <div class="blueprint-grid">
      <button
        v-for="blueprint in TRADING_BLUEPRINTS"
        :key="blueprint.key"
        class="blueprint-card"
        :class="{ active: activeKey === blueprint.key }"
        type="button"
        :disabled="disabled"
        :aria-pressed="activeKey === blueprint.key"
        @click="applyBlueprint(blueprint)"
      >
        <span class="blueprint-card-head">
          <strong>{{ blueprint.label }}</strong>
          <Check v-if="activeKey === blueprint.key" :size="13" aria-hidden="true" />
        </span>
        <small>{{ blueprint.rhythm }}</small>
        <span class="blueprint-card-params">
          <span>SMA {{ blueprint.shortWindow }} / {{ blueprint.longWindow }}</span>
          <span>仓位上限 {{ blueprint.risk.maxPositionPct }}%</span>
        </span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.strategy-blueprints {
  padding: 13px 18px 14px;
  border-bottom: 1px solid var(--line);
  background:
    radial-gradient(280px 120px at 100% 0%, rgba(194, 58, 52, 0.045), transparent 74%),
    var(--panel);
}

.blueprint-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.blueprint-head h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--ink);
  font-size: 11px;
  font-weight: 650;
}

.blueprint-head h3 svg {
  color: var(--up);
}

.blueprint-head p {
  margin: 3px 0 0;
  color: var(--ink-3);
  font-size: 9px;
}

.blueprint-head > span {
  flex: none;
  color: var(--ink-3);
  font-size: 8.5px;
  white-space: nowrap;
}

.blueprint-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
  margin-top: 10px;
}

.blueprint-card {
  display: grid;
  min-width: 0;
  min-height: 74px;
  align-content: center;
  gap: 4px;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: var(--panel-soft);
  color: var(--ink-2);
  text-align: left;
  transition:
    border-color 150ms ease,
    background 150ms ease,
    transform 150ms ease;
}

.blueprint-card:hover:not(:disabled),
.blueprint-card:focus-visible {
  border-color: var(--line-strong);
  background: var(--panel-raised);
  transform: translateY(-1px);
}

.blueprint-card.active {
  border-color: rgba(194, 58, 52, 0.25);
  background:
    radial-gradient(120px 70px at 100% 0%, rgba(194, 58, 52, 0.08), transparent 72%),
    var(--panel-raised);
}

.blueprint-card:disabled {
  cursor: wait;
  opacity: 0.55;
}

.blueprint-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.blueprint-card-head strong {
  color: var(--ink);
  font-size: 11px;
  font-weight: 650;
}

.blueprint-card-head svg {
  color: var(--up);
}

.blueprint-card > small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 8.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.blueprint-card-params {
  display: grid;
  min-width: 0;
  gap: 1px;
  color: var(--ink-2);
  font-family: var(--font-data);
  font-size: 8px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.blueprint-card-params span {
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 720px) {
  .strategy-blueprints {
    padding: 12px 14px 13px;
  }

  .blueprint-grid {
    gap: 6px;
  }

  .blueprint-card {
    min-height: 78px;
    padding: 8px;
  }

  .blueprint-head > span {
    display: none;
  }
}
</style>
