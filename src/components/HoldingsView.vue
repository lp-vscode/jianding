<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { Coins, Info, Pencil, Plus, Trash2 } from "lucide-vue-next";
import {
  assetForSymbol,
  deleteHolding,
  openHoldingDialog,
  quoteFor,
  selectAsset,
  state,
} from "../lib/store";
import {
  formatMoney,
  formatPercent,
  formatPrice,
  formatSigned,
  directionMark,
  priceDigits,
  toneOf,
} from "../lib/format";
import { marketPhase } from "../lib/market";
import { buildPortfolioPulse } from "../lib/portfolio";
import PositionValueToggle from "./PositionValueToggle.vue";
import RebalancePanel from "./RebalancePanel.vue";
import HoldingsRiskHeatmap, { type HoldingRiskRow } from "./HoldingsRiskHeatmap.vue";

function quoteFreshnessLabel(quote: { state: string } | undefined) {
  if (quote?.state !== "demo") return "最新";
  return marketPhase() === "交易中" ? "示例行情" : "收盘快照";
}

const rows = computed(() => {
  const list = state.holdings.map((holding) => {
    const asset = assetForSymbol(holding.symbol);
    const quote = quoteFor(holding.symbol);
    const price = quote?.price ?? holding.cost;
    const value = price * holding.shares;
    const averageCost = holding.cost;
    const totalCost = averageCost * holding.shares;
    const pnl = value - totalCost;
    const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
    const dayPnl = quote?.change != null ? quote.change * holding.shares : null;
    return {
      ...holding,
      asset,
      quote,
      price,
      value,
      averageCost,
      totalCost,
      pnl,
      pnlPct,
      dayPnl,
      digits: priceDigits(asset.kind, quote?.price ?? holding.cost),
    };
  });
  const total = list.reduce((sum, row) => sum + row.value, 0);
  return list.map((row) => ({ ...row, weight: total > 0 ? (row.value / total) * 100 : 0 }));
});

const totals = computed(() => {
  const value = rows.value.reduce((sum, row) => sum + row.value, 0);
  const cost = rows.value.reduce((sum, row) => sum + row.totalCost, 0);
  const pnl = value - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
  const dayPnl = rows.value.reduce((sum, row) => sum + (row.dayPnl ?? 0), 0);
  const dayPct = value - dayPnl > 0 ? (dayPnl / (value - dayPnl)) * 100 : 0;
  return { value, cost, pnl, pnlPct, dayPnl, dayPct };
});

const portfolioPulse = computed(() =>
  buildPortfolioPulse(
    rows.value.map((row) => ({
      name: row.asset.name,
      weight: row.weight,
      dayPnl: row.dayPnl,
    })),
    totals.value.dayPct,
  ),
);
const rebalanceRows = computed(() =>
  rows.value.map((row) => ({
    symbol: row.symbol,
    name: row.asset.name,
    value: row.value,
    weight: row.weight,
  })),
);
const riskRows = computed<HoldingRiskRow[]>(() =>
  rows.value.map((row) => {
    const base = row.quote?.previousClose ?? row.quote?.price ?? row.averageCost;
    const amplitude =
      row.quote?.high != null && row.quote?.low != null && base > 0
        ? ((row.quote.high - row.quote.low) / base) * 100
        : Math.abs(row.quote?.changePct ?? 0);
    return {
      symbol: row.symbol,
      name: row.asset.name,
      weight: row.weight,
      changePct: row.quote?.changePct ?? 0,
      amplitudePct: Math.max(0, amplitude),
    };
  }),
);

function editHoldingFromHeatmap(symbol: string) {
  const holding = state.holdings.find((item) => item.symbol === symbol);
  if (holding) openHoldingDialog(holding);
}

const allocation = computed(() => {
  const buckets = [
    { key: "stock", label: "A股", fill: "#f16a61", value: 0 },
    { key: "etf", label: "ETF / LOF", fill: "#d7bd88", value: 0 },
    { key: "fund", label: "场外基金", fill: "#74d6a3", value: 0 },
  ];
  for (const row of rows.value) {
    const key = row.asset.market === "jj" ? "fund" : row.asset.kind === "stock" ? "stock" : "etf";
    const bucket = buckets.find((item) => item.key === key);
    if (bucket) bucket.value += row.value;
  }
  const total = buckets.reduce((sum, item) => sum + item.value, 0);
  return buckets
    .filter((item) => item.value > 0)
    .map((item) => ({ ...item, pct: total > 0 ? (item.value / total) * 100 : 0 }));
});

const snapshotLabel = computed(() =>
  rows.value.length ? quoteFreshnessLabel(rows.value[0]?.quote) : "等待持仓",
);

const pendingDelete = ref<string | null>(null);
let deleteTimer: number | undefined;
const valuesHidden = computed(() => state.settings.hidePositionValues);

function positionMoney(value: number, digits = 2) {
  return valuesHidden.value ? "••••" : `¥${formatMoney(value, digits)}`;
}

function positionSigned(value: number) {
  return valuesHidden.value ? "••••" : formatSigned(value);
}

function positionQuantity(value: number) {
  return valuesHidden.value
    ? "••••"
    : value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function requestDelete(id: string) {
  window.clearTimeout(deleteTimer);
  if (pendingDelete.value === id) {
    pendingDelete.value = null;
    deleteHolding(id);
    return;
  }
  pendingDelete.value = id;
  deleteTimer = window.setTimeout(() => {
    pendingDelete.value = null;
  }, 4000);
}

onBeforeUnmount(() => window.clearTimeout(deleteTimer));
</script>

<template>
  <section class="view-page view-holdings">
    <div class="view-head">
      <div>
        <p class="eyebrow">Portfolio</p>
        <h1>我的持仓</h1>
        <p class="view-sub">
          <span>{{ rows.length }} 笔持仓</span>
          <i class="sub-dot" />
          <span>市值按最新行情估算</span>
          <i class="sub-dot" />
          <span>仅保存在本机</span>
        </p>
      </div>
    </div>

    <div class="panel workspace-signal holdings-signal" :class="{ 'has-positions': rows.length }">
      <div class="workspace-signal-meta">
        <span>{{ rows.length }} 笔持仓 · 按最新行情估算</span>
        <span class="workspace-signal-status">
          <i aria-hidden="true" />
          {{ snapshotLabel }}{{ rows.length ? ` · ${portfolioPulse.mood}` : "" }}
        </span>
      </div>

      <div class="workspace-signal-board">
        <div class="workspace-signal-core">
          <div class="workspace-signal-core-head">
            <span>今日盈亏</span>
            <small>收盘估值</small>
          </div>
          <strong :aria-label="valuesHidden ? '今日盈亏金额已隐藏' : undefined">{{ positionSigned(totals.dayPnl) }}</strong>
          <div class="workspace-signal-core-foot">
            <span>市值 {{ positionMoney(totals.value) }}</span>
            <span v-if="rows.length" :class="toneOf(totals.dayPct)">
              {{ formatPercent(totals.dayPct) }}
              <i class="trend-mark" aria-hidden="true">{{ directionMark(totals.dayPct) }}</i>
            </span>
            <span v-else>添加成本后开始计算</span>
          </div>
        </div>

        <div class="workspace-signal-side">
          <div class="workspace-signal-mini">
            <span>累计盈亏</span>
            <strong
              :class="valuesHidden ? undefined : toneOf(totals.pnl)"
              :aria-label="valuesHidden ? '累计盈亏金额已隐藏' : undefined"
            >{{ positionSigned(totals.pnl) }}</strong>
            <small>{{ rows.length ? `${formatPercent(totals.pnlPct)} ${directionMark(totals.pnlPct)}` : "尚无持仓" }}</small>
          </div>
          <div class="workspace-signal-mini">
            <span>持仓成本</span>
            <strong :aria-label="valuesHidden ? '持仓成本金额已隐藏' : undefined">{{ positionMoney(totals.cost) }}</strong>
            <small>{{ rows.length ? "按份额与成本估算" : "添加第一笔持仓" }}</small>
          </div>
        </div>
      </div>

      <div class="workspace-signal-facts holdings-pulse-facts">
        <div>
          <span>今日脉搏</span>
          <strong>{{ portfolioPulse.mood }}</strong>
        </div>
        <div>
          <span>集中度</span>
          <strong>{{ portfolioPulse.concentration }}</strong>
        </div>
        <div>
          <span>{{ portfolioPulse.contributorLabel }}</span>
          <strong :title="portfolioPulse.contributorName">{{ portfolioPulse.contributorName }}</strong>
        </div>
      </div>

      <div v-if="allocation.length" class="workspace-signal-allocation">
        <div class="allocation-bar">
          <i
            v-for="item in allocation"
            :key="item.key"
            :style="{ width: `${item.pct}%`, '--fill': item.fill }"
          />
        </div>
        <div class="allocation-legend">
          <div v-for="item in allocation" :key="item.key" class="allocation-item">
            <i :style="{ '--fill': item.fill }" />
            <span>{{ item.label }}</span>
            <strong>{{ item.pct.toFixed(1) }}%</strong>
          </div>
        </div>
      </div>
      <p v-else class="workspace-signal-empty">添加持仓后，这里会显示股票、ETF 与场外基金的比例。</p>

      <button class="workspace-signal-action" type="button" @click="openHoldingDialog()">
        <span class="workspace-signal-action-icon" aria-hidden="true"><Plus :size="17" /></span>
        <span>
          <strong>{{ rows.length ? "继续添加持仓" : "添加第一笔持仓" }}</strong>
          <small>记录份额与成本，自动跟随行情重算</small>
        </span>
        <span class="workspace-signal-action-cta">添加持仓</span>
      </button>
    </div>

    <RebalancePanel
      v-if="rebalanceRows.length >= 2"
      :rows="rebalanceRows"
      :values-hidden="valuesHidden"
    />

    <HoldingsRiskHeatmap
      v-if="riskRows.length"
      :rows="riskRows"
      @edit="editHoldingFromHeatmap"
    />

    <div class="panel holdings-panel">
      <div class="holdings-toolbar">
        <div>
          <h2>持仓明细</h2>
          <p>{{ rows.length ? "占比按市值计算，盈亏未计手续费与分红" : "记录份额与成本，自动跟随行情重算" }}</p>
        </div>
        <div class="holdings-toolbar-actions">
          <PositionValueToggle />
          <button class="btn btn-small" type="button" @click="openHoldingDialog()">
            <Plus :size="12" />
            添加
          </button>
        </div>
      </div>

      <div v-if="!rows.length" class="empty holdings-empty">
        <Coins :size="22" :stroke-width="1.5" />
        <strong>还没有记录持仓</strong>
        <p>填入住股份额与成本价，这里会汇总市值、今日盈亏和资产构成。</p>
        <button class="btn btn-gold" type="button" @click="openHoldingDialog()">添加第一笔</button>
      </div>

      <div v-else class="holdings-table">
        <div class="holding-row head">
          <span>标的</span>
          <span class="align-right">份额</span>
          <span class="align-right">成本价</span>
          <span class="align-right">现价</span>
          <span class="align-right">市值</span>
          <span class="align-right">盈亏</span>
          <span>占比</span>
          <span />
        </div>
        <div v-for="row in rows" :key="row.id" class="holding-row">
          <button class="holding-name" type="button" @click="selectAsset(row.symbol)">
            <strong>{{ row.asset.name }}</strong>
            <span>{{ row.asset.code }} · {{ row.asset.typeLabel }}</span>
          </button>
          <span class="holding-cell align-right">
            {{ positionQuantity(row.shares) }}
            <small>{{ row.asset.kind === "fund" ? "份" : "股" }}</small>
          </span>
          <span class="holding-cell align-right">
            {{ formatPrice(row.averageCost, row.digits) }}
            <small>成本</small>
          </span>
          <span class="holding-cell align-right" :class="toneOf(row.quote?.changePct)">
            {{ formatPrice(row.price, row.digits) }}
            <small>
              {{ formatPercent(row.quote?.changePct) }}
              <i class="trend-mark" aria-hidden="true">{{ directionMark(row.quote?.changePct) }}</i>
            </small>
          </span>
          <span class="holding-cell align-right">
            {{ positionMoney(row.value) }}
            <small>{{ quoteFreshnessLabel(row.quote) }}</small>
          </span>
          <span class="holding-cell align-right" :class="valuesHidden ? undefined : toneOf(row.pnl)">
            {{ positionSigned(row.pnl) }}
            <small>
              {{ formatPercent(row.pnlPct) }}
              <i class="trend-mark" aria-hidden="true">{{ directionMark(row.pnlPct) }}</i>
            </small>
          </span>
          <div class="weight-cell">
            <span class="weight-track"><i :style="{ width: `${Math.max(4, row.weight)}%` }" /></span>
            <span class="mono">{{ row.weight.toFixed(1) }}%</span>
          </div>
          <div class="row-actions">
            <button
              class="mini-icon"
              type="button"
              title="编辑持仓"
              aria-label="编辑持仓"
              @click="openHoldingDialog(row)"
            >
              <Pencil :size="13" />
            </button>
            <button
              class="mini-icon danger"
              :class="{ confirming: pendingDelete === row.id }"
              type="button"
              :title="pendingDelete === row.id ? '再次点击确认删除' : '删除持仓'"
              aria-label="删除持仓"
              @click="requestDelete(row.id)"
            >
              <Trash2 :size="13" />
            </button>
          </div>
          <div class="holding-mobile-summary">
            <div class="mobile-value-block">
              <span>持仓金额</span>
              <strong>{{ positionMoney(row.value) }}</strong>
            </div>
            <div class="mobile-pnl-block">
              <span>浮动盈亏</span>
              <strong :class="valuesHidden ? undefined : toneOf(row.pnl)">
                {{ positionSigned(row.pnl) }}
                <small>
                  {{ formatPercent(row.pnlPct) }}
                  <i class="trend-mark" aria-hidden="true">{{ directionMark(row.pnlPct) }}</i>
                </small>
              </strong>
              <em v-if="row.dayPnl != null" :class="valuesHidden ? undefined : toneOf(row.dayPnl)">
                今日 {{ positionSigned(row.dayPnl) }}
              </em>
            </div>
            <div class="mobile-holding-meta">
              <span>
                {{ positionQuantity(row.shares) }}
                {{ row.asset.kind === "fund" ? "份" : "股" }}
              </span>
              <span>成本 {{ formatPrice(row.averageCost, row.digits) }}</span>
              <span>占比 {{ row.weight.toFixed(1) }}%</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="rows.length" class="holding-footnote">
        <Info :size="12" />
        <span>盈亏按现价与持仓成本估算，不构成投资建议。</span>
      </div>
    </div>
  </section>
</template>
