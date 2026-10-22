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

const allocation = computed(() => {
  const buckets = [
    { key: "stock", label: "A股", fill: "#c9a86c", value: 0 },
    { key: "etf", label: "ETF / LOF", fill: "#86a48f", value: 0 },
    { key: "fund", label: "场外基金", fill: "#b08968", value: 0 },
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

const pendingDelete = ref<string | null>(null);
let deleteTimer: number | undefined;

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
  <section>
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
      <div class="view-actions">
        <button class="btn btn-primary" type="button" @click="openHoldingDialog()">
          <Plus :size="14" />
          添加持仓
        </button>
      </div>
    </div>

    <div class="panel portfolio-hero">
      <div class="hero-main">
        <p class="eyebrow">持仓市值</p>
        <strong class="hero-value">
          <small>¥</small>
          {{ formatMoney(totals.value) }}
        </strong>
        <div class="hero-deltas">
          <div class="hero-delta">
            <span>今日盈亏</span>
            <strong :class="toneOf(totals.dayPnl)">
              {{ formatSigned(totals.dayPnl) }}
              <template v-if="rows.length">
                （{{ formatPercent(totals.dayPct) }}
                <i class="trend-mark" aria-hidden="true">{{ directionMark(totals.dayPct) }}</i>）
              </template>
            </strong>
          </div>
          <div class="hero-delta">
            <span>累计盈亏</span>
            <strong :class="toneOf(totals.pnl)">
              {{ formatSigned(totals.pnl) }}
              <template v-if="rows.length">
                （{{ formatPercent(totals.pnlPct) }}
                <i class="trend-mark" aria-hidden="true">{{ directionMark(totals.pnlPct) }}</i>）
              </template>
            </strong>
          </div>
          <div class="hero-delta">
            <span>持仓成本</span>
            <strong class="flat">¥{{ formatMoney(totals.cost) }}</strong>
          </div>
        </div>
      </div>

      <div class="allocation">
        <div class="allocation-head">
          <span>资产构成</span>
          <span>{{ allocation.length ? "按市值" : "暂无" }}</span>
        </div>
        <div v-if="allocation.length" class="allocation-bar">
          <i
            v-for="item in allocation"
            :key="item.key"
            :style="{ width: `${item.pct}%`, '--fill': item.fill }"
          />
        </div>
        <div v-if="allocation.length" class="allocation-legend">
          <div v-for="item in allocation" :key="item.key" class="allocation-item">
            <i :style="{ '--fill': item.fill }" />
            <span>{{ item.label }}</span>
            <strong>{{ item.pct.toFixed(1) }}%</strong>
          </div>
        </div>
        <p v-else class="allocation-empty">添加持仓后，这里会显示股票、ETF 与场外基金的比例。</p>
      </div>
    </div>

    <div class="panel holdings-panel">
      <div class="holdings-toolbar">
        <div>
          <h2>持仓明细</h2>
          <p>{{ rows.length ? "占比按市值计算，盈亏未计手续费与分红" : "记录份额与成本，自动跟随行情重算" }}</p>
        </div>
        <button class="btn btn-small" type="button" @click="openHoldingDialog()">
          <Plus :size="12" />
          添加
        </button>
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
            {{ row.shares.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) }}
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
            ¥{{ formatMoney(row.value) }}
            <small>{{ row.quote?.state === "demo" ? "示例行情" : "最新" }}</small>
          </span>
          <span class="holding-cell align-right" :class="toneOf(row.pnl)">
            {{ formatSigned(row.pnl) }}
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
              <strong>¥{{ formatMoney(row.value) }}</strong>
            </div>
            <div class="mobile-pnl-block">
              <span>浮动盈亏</span>
              <strong :class="toneOf(row.pnl)">
                {{ formatSigned(row.pnl) }}
                <small>
                  {{ formatPercent(row.pnlPct) }}
                  <i class="trend-mark" aria-hidden="true">{{ directionMark(row.pnlPct) }}</i>
                </small>
              </strong>
              <em v-if="row.dayPnl != null" :class="toneOf(row.dayPnl)">
                今日 {{ formatSigned(row.dayPnl) }}
              </em>
            </div>
            <div class="mobile-holding-meta">
              <span>
                {{ row.shares.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) }}
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
