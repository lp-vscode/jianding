<script setup lang="ts">
import { computed } from "vue";
import { ArrowDownRight, ArrowUpRight, Copy, Info, Scale } from "lucide-vue-next";
import { showToast } from "../lib/store";
import { formatMoney } from "../lib/format";
import {
  buildEqualWeightRebalancePlan,
  type RebalanceHolding,
} from "../lib/rebalance";

const props = defineProps<{
  rows: RebalanceHolding[];
  valuesHidden: boolean;
}>();

const plan = computed(() => buildEqualWeightRebalancePlan(props.rows));
const statusLabel = computed(() => {
  if (!plan.value.canRebalance) return "需要至少两笔";
  if (!plan.value.needsAdjustment) return "分布均衡";
  return `${plan.value.actions.length} 项可调整`;
});

function amountText(amount: number) {
  return props.valuesHidden ? "金额已隐藏" : `约 ¥${formatMoney(amount)}`;
}

async function copyPlan() {
  const lines = [
    "简盯 · 等权再平衡参考",
    `基准：${props.rows.length} 笔持仓等权，每只 ${plan.value.targetWeight.toFixed(1)}%`,
    `最大偏离：${plan.value.maxDeviation.toFixed(1)} 个百分点`,
    ...plan.value.actions.map((action) =>
      `${action.side === "sell" ? "减仓" : "加仓"} ${action.name}：当前 ${action.currentWeight.toFixed(1)}%，目标 ${action.targetWeight.toFixed(1)}%，${amountText(action.amount)}`,
    ),
    "仅为按当前市值的等权测算，不构成投资建议。",
  ];
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    showToast("再平衡清单已复制", "success");
  } catch {
    showToast("复制失败，请检查剪贴板权限", "error");
  }
}
</script>

<template>
  <section class="panel rebalance-panel" aria-labelledby="rebalance-title">
    <div class="panel-head rebalance-head">
      <div>
        <h2 id="rebalance-title"><Scale :size="15" aria-hidden="true" /> 等权再平衡参考</h2>
        <p>按当前市值计算等权基准，偏离超过 3 个百分点时才给出提示</p>
      </div>
      <span class="chip" :class="{ 'chip-gold': plan.needsAdjustment }">{{ statusLabel }}</span>
    </div>

    <div class="rebalance-metrics">
      <div>
        <span>参考基准</span>
        <strong>每只 {{ plan.targetWeight.toFixed(1) }}%</strong>
      </div>
      <div>
        <span>最大偏离</span>
        <strong>{{ plan.maxDeviation.toFixed(1) }} pt</strong>
      </div>
      <div>
        <span>调整项</span>
        <strong>{{ plan.actions.length }} 项</strong>
      </div>
    </div>

    <div v-if="plan.actions.length" class="rebalance-actions">
      <div
        v-for="action in plan.actions"
        :key="action.symbol"
        class="rebalance-action"
        :class="action.side"
      >
        <span class="rebalance-action-icon" aria-hidden="true">
          <ArrowUpRight v-if="action.side === 'buy'" :size="15" />
          <ArrowDownRight v-else :size="15" />
        </span>
        <span class="rebalance-action-copy">
          <strong>{{ action.side === "buy" ? "加仓" : "减仓" }} {{ action.name }}</strong>
          <small>
            当前 {{ action.currentWeight.toFixed(1) }}% · 目标 {{ action.targetWeight.toFixed(1) }}%
          </small>
        </span>
        <strong class="rebalance-action-amount">{{ amountText(action.amount) }}</strong>
      </div>
    </div>
    <div v-else class="rebalance-balanced">
      <Info :size="15" aria-hidden="true" />
      <span>当前各标的与等权基准的偏离都在容差内，暂时无需调整。</span>
    </div>

    <div class="rebalance-foot">
      <span>这是机械式参考，不包含税费、交易成本与你的风险偏好。</span>
      <button class="btn btn-small btn-ghost" type="button" :disabled="!plan.actions.length" @click="copyPlan">
        <Copy :size="12" />
        复制清单
      </button>
    </div>
  </section>
</template>

<style scoped>
.rebalance-panel {
  margin-top: 12px;
  overflow: hidden;
}

.rebalance-head h2 {
  display: flex;
  align-items: center;
  gap: 7px;
}

.rebalance-head h2 svg {
  color: var(--up);
}

.rebalance-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-bottom: 1px solid var(--line);
}

.rebalance-metrics > div {
  display: grid;
  gap: 3px;
  padding: 12px 18px;
  border-right: 1px solid var(--line);
}

.rebalance-metrics > div:last-child {
  border-right: 0;
}

.rebalance-metrics span {
  color: var(--ink-3);
  font-size: 9px;
}

.rebalance-metrics strong {
  color: var(--ink);
  font-family: var(--font-data);
  font-size: 12px;
  font-weight: 620;
  font-variant-numeric: tabular-nums;
}

.rebalance-actions {
  display: grid;
}

.rebalance-action {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--line);
}

.rebalance-action-icon {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 9px;
  background: var(--up-wash);
  color: var(--up);
}

.rebalance-action.sell .rebalance-action-icon {
  background: var(--down-wash);
  color: var(--down);
}

.rebalance-action-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.rebalance-action-copy strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 10.5px;
  font-weight: 620;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rebalance-action-copy small {
  color: var(--ink-3);
  font-family: var(--font-data);
  font-size: 9px;
}

.rebalance-action-amount {
  color: var(--up);
  font-family: var(--font-data);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.rebalance-action.sell .rebalance-action-amount {
  color: var(--down);
}

.rebalance-balanced {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 18px;
  color: var(--ink-2);
  font-size: 10.5px;
  line-height: 1.55;
}

.rebalance-balanced svg {
  flex: none;
  color: var(--gold-strong);
}

.rebalance-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 18px 12px;
  color: var(--ink-3);
  font-size: 9px;
  line-height: 1.5;
}

@media (max-width: 720px) {
  .rebalance-panel {
    margin-top: 10px;
  }

  .rebalance-metrics > div {
    padding: 10px 12px;
  }

  .rebalance-action {
    grid-template-columns: 28px minmax(0, 1fr) auto;
    padding: 10px 14px;
  }

  .rebalance-foot {
    align-items: flex-start;
    padding: 10px 14px 12px;
  }
}
</style>
