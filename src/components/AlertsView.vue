<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { Activity, BellPlus, BellRing, CheckCheck, Copy, Inbox, Pencil, Plus, Trash2, Zap } from "lucide-vue-next";
import type { AlertRule } from "../types";
import {
  deleteAlert,
  markEventsRead,
  openAlertDialog,
  quoteFor,
  selectAsset,
  showToast,
  state,
  updateAlert,
} from "../lib/store";
import { alertConditions, alertRuleSummary, isTriggered } from "../lib/alerts";
import { formatCompactMoney, formatPercent, formatPrice, priceDigits, timeAgo } from "../lib/format";

const pendingDelete = ref<string | null>(null);
let deleteTimer: number | undefined;

onBeforeUnmount(() => window.clearTimeout(deleteTimer));

const activeCount = computed(() => state.alerts.filter((rule) => rule.enabled).length);
const unreadCount = computed(() => state.events.filter((event) => !event.read).length);
const todayEvents = computed(() => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return state.events.filter((event) => event.at >= start.getTime());
});
const todayCount = computed(() => {
  return todayEvents.value.length;
});
const eventGroups = computed(() => {
  const groups: Array<{ key: string; symbol: string; latest: (typeof state.events)[number]; count: number }> = [];
  for (const event of state.events) {
    const current = groups.find(
      (group) =>
        group.symbol === event.symbol &&
        Math.abs(group.latest.at - event.at) <= 5 * 60 * 1000,
    );
    if (current) current.count += 1;
    else groups.push({ key: event.id, symbol: event.symbol, latest: event, count: 1 });
  }
  return groups;
});
const todayGroupCount = computed(() => {
  const todayIds = new Set(todayEvents.value.map((event) => event.id));
  return eventGroups.value.filter((group) => todayIds.has(group.latest.id)).length;
});
const mostActiveSymbol = computed(() => {
  const counts = new Map<string, number>();
  for (const event of todayEvents.value) counts.set(event.symbol, (counts.get(event.symbol) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
});
const healthState = computed(() => {
  if (!todayCount.value) return { label: "今日安静", detail: "暂无规则触发，保持轻量监控" };
  if (unreadCount.value) return { label: "待处理", detail: `${unreadCount.value} 条触发尚未处理` };
  return { label: "节奏平稳", detail: `${todayCount.value} 次触发已全部处理` };
});

function assetOf(symbol: string) {
  return state.assets.find((asset) => asset.symbol === symbol);
}

function assetName(symbol: string) {
  return assetOf(symbol)?.name ?? symbol;
}

function distance(rule: AlertRule) {
  const quote = quoteFor(rule.symbol);
  if (!quote) return { text: "等待行情", tone: "flat" as const };
  if (isTriggered(rule, quote)) return { text: "已触发", tone: "up" as const };
  const rules = alertConditions(rule);
  if (rules.length > 1) return { text: `${rules.length} 项条件`, tone: "flat" as const };
  const condition = rules[0];
  if (condition.type.startsWith("pct")) {
    const pct = quote.changePct ?? 0;
    const delta =
      condition.type === "pctAbove" ? condition.threshold - pct : pct + Math.abs(condition.threshold);
    return { text: `还差 ${Math.max(0, delta).toFixed(2)} 个点`, tone: "flat" as const };
  }
  if (condition.type === "amountAbove") {
    if (quote.amount == null) return { text: "等待成交额", tone: "flat" as const };
    const delta = Math.max(0, condition.threshold - quote.amount / 100_000_000);
    return { text: `还差 ${delta.toFixed(2)} 亿`, tone: "flat" as const };
  }
  if (
    condition.type === "rsiAbove" ||
    condition.type === "rsiBelow" ||
    condition.type === "smaGolden" ||
    condition.type === "smaDeath" ||
    condition.type === "volumeSpike"
  ) {
    return { text: "指标监控", tone: "flat" as const };
  }
  if (condition.type === "gapUp" || condition.type === "gapDown") {
    if (quote.open == null || quote.previousClose == null || quote.previousClose <= 0) {
      return { text: "等待开盘", tone: "flat" as const };
    }
    const gap = ((quote.open - quote.previousClose) / quote.previousClose) * 100;
    return { text: `当前跳空 ${gap >= 0 ? "+" : ""}${gap.toFixed(2)}%`, tone: "flat" as const };
  }
  if (condition.type === "pnlAbove" || condition.type === "pnlBelow") {
    const holding = state.holdings.find((item) => item.symbol === rule.symbol);
    if (!holding || quote.price == null || holding.cost <= 0) {
      return { text: "等待持仓", tone: "flat" as const };
    }
    const pnlPct = ((quote.price - holding.cost) / holding.cost) * 100;
    return { text: `当前 ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`, tone: "flat" as const };
  }
  if (quote.price == null || quote.price <= 0) return { text: "--", tone: "flat" as const };
  const delta =
    condition.type === "priceAbove"
      ? ((condition.threshold - quote.price) / quote.price) * 100
      : ((quote.price - condition.threshold) / quote.price) * 100;
  return { text: `还差 ${Math.abs(delta).toFixed(2)}%`, tone: "flat" as const };
}

function toggleRule(rule: AlertRule) {
  updateAlert(rule.id, { enabled: !rule.enabled });
}

function requestDelete(id: string) {
  window.clearTimeout(deleteTimer);
  if (pendingDelete.value === id) {
    pendingDelete.value = null;
    deleteAlert(id);
    return;
  }
  pendingDelete.value = id;
  deleteTimer = window.setTimeout(() => {
    pendingDelete.value = null;
  }, 4000);
}

function openEvent(symbol: string) {
  selectAsset(symbol);
}

async function copyDailyReview() {
  const lines = todayEvents.value.slice(0, 20).map((event) => {
    const pct = event.changePct == null ? "" : `，${formatPercent(event.changePct)}`;
    return `- ${event.name}：${event.message}（${new Date(event.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}${pct}）`;
  });
  const text = [
    "简盯 · 今日盯盘复盘",
    `触发 ${todayCount.value} 次，合并为 ${todayGroupCount.value} 条摘要，未读 ${unreadCount.value} 条。`,
    mostActiveSymbol.value ? `最活跃标的：${assetName(mostActiveSymbol.value)}` : "今日暂无活跃标的",
    ...lines,
  ].join("\n");
  try {
    await navigator.clipboard.writeText(text);
    showToast("今日复盘摘要已复制", "success");
  } catch {
    showToast("复制失败，请检查剪贴板权限", "error");
  }
}
</script>

<template>
  <section>
    <div class="view-head">
      <div>
        <p class="eyebrow">Alerts</p>
        <h1>价格提醒</h1>
        <p class="view-sub">
          <span>{{ state.alerts.length }} 条规则</span>
          <i class="sub-dot" />
          <span>行情刷新后自动检查</span>
          <i class="sub-dot" />
          <span>同一规则 30 分钟内不重复提醒</span>
        </p>
      </div>
      <div class="view-actions">
        <button class="btn btn-primary" type="button" @click="openAlertDialog()">
          <BellPlus :size="14" />
          新建提醒
        </button>
      </div>
    </div>

    <div class="panel stat-strip">
      <div class="strip-stat">
        <span class="strip-icon"><BellRing :size="15" /></span>
        <span class="strip-copy">
          <span>监控中</span>
          <strong>{{ activeCount }} / {{ state.alerts.length }}</strong>
        </span>
      </div>
      <div class="strip-stat" :class="{ hot: todayCount > 0 }">
        <span class="strip-icon"><Zap :size="15" /></span>
        <span class="strip-copy">
          <span>今日触发</span>
          <strong>{{ todayCount }} 次</strong>
        </span>
      </div>
      <div class="strip-stat" :class="{ hot: unreadCount > 0 }">
        <span class="strip-icon"><Inbox :size="15" /></span>
        <span class="strip-copy">
          <span>未读记录</span>
          <strong>{{ unreadCount }} 条</strong>
        </span>
      </div>
      <div class="strip-stat">
        <span class="strip-icon"><Activity :size="15" /></span>
        <span class="strip-copy">
          <span>最活跃标的</span>
          <strong>{{ mostActiveSymbol ? assetName(mostActiveSymbol) : "--" }}</strong>
        </span>
      </div>
    </div>

    <div class="panel alert-health">
      <span class="alert-health-state">
        <i />
        <strong>{{ healthState.label }}</strong>
        <small>{{ healthState.detail }}</small>
      </span>
      <span class="alert-health-summary">
        今日 {{ todayCount }} 次触发合并为 {{ todayGroupCount }} 条摘要
      </span>
      <button class="btn btn-small" type="button" :disabled="!todayCount" @click="copyDailyReview">
        <Copy :size="12" />
        复制今日复盘
      </button>
    </div>

    <div class="alerts-layout">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2>提醒规则</h2>
            <p>价格、涨跌幅与成交额可组合触发</p>
          </div>
          <button class="btn btn-small btn-ghost" type="button" @click="openAlertDialog()">
            <Plus :size="12" />
            新建
          </button>
        </div>

        <div v-if="!state.alerts.length" class="empty rule-empty">
          <BellRing :size="22" :stroke-width="1.5" />
          <strong>还没有提醒规则</strong>
          <p>可选择提醒模板或组合多个条件，达到条件时记录并推送系统通知。</p>
          <button class="btn btn-gold" type="button" @click="openAlertDialog()">设置第一条</button>
        </div>

        <div v-else class="rule-list">
          <div v-for="rule in state.alerts" :key="rule.id" class="rule-row" :class="{ paused: !rule.enabled }">
            <div class="rule-identity">
              <span class="rule-signal">
                <BellRing :size="13" :stroke-width="1.7" />
              </span>
              <div>
                <strong>{{ assetName(rule.symbol) }}</strong>
                <small>{{ rule.symbol.slice(0, 2).toUpperCase() }} {{ rule.symbol.slice(2) }}</small>
              </div>
            </div>
            <div class="rule-condition">
              <span>
                {{
                  alertConditions(rule).length > 1
                    ? rule.logic === "any"
                      ? "满足任一条件"
                      : "需同时满足"
                    : rule.schedule && rule.schedule !== "any"
                      ? "限定时段"
                      : "单条件提醒"
                }}
              </span>
              <strong>{{ alertRuleSummary(rule) }}</strong>
            </div>
            <div class="rule-distance">
              <strong :class="distance(rule).tone">{{ distance(rule).text }}</strong>
              <small>{{ rule.enabled ? (distance(rule).text === "指标监控" ? "监控中" : "距触发") : "已暂停" }}</small>
            </div>
            <div class="rule-tools">
              <button
                class="toggle"
                :class="{ on: rule.enabled }"
                type="button"
                :title="rule.enabled ? '暂停提醒' : '启用提醒'"
                :aria-pressed="rule.enabled"
                @click="toggleRule(rule)"
              />
              <button
                class="mini-icon"
                type="button"
                title="编辑提醒"
                aria-label="编辑提醒"
                @click="openAlertDialog(rule.symbol, rule)"
              >
                <Pencil :size="13" />
              </button>
              <button
                class="mini-icon danger"
                :class="{ confirming: pendingDelete === rule.id }"
                type="button"
                :title="pendingDelete === rule.id ? '再次点击确认删除' : '删除提醒'"
                aria-label="删除提醒"
                @click="requestDelete(rule.id)"
              >
                <Trash2 :size="13" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="panel event-panel">
        <div class="panel-head">
          <div>
            <h2>触发记录</h2>
            <p>最近 {{ state.events.length }} 条，保存在本机</p>
          </div>
          <button
            class="btn btn-small btn-ghost"
            type="button"
            :disabled="!unreadCount"
            @click="markEventsRead()"
          >
            <CheckCheck :size="12" />
            全部已读
          </button>
        </div>

        <div v-if="!state.events.length" class="empty event-empty">
          <Inbox :size="20" :stroke-width="1.5" />
          <strong>暂无触发</strong>
          <p>规则触发后会在这里留下记录，同时弹出系统通知。</p>
        </div>

        <div v-else class="event-list">
          <div
            v-for="group in eventGroups"
            :key="group.key"
            class="event-row"
            :class="{ unread: !group.latest.read }"
            role="button"
            tabindex="0"
            @click="openEvent(group.symbol)"
            @keydown.enter="openEvent(group.symbol)"
          >
            <i class="event-dot" />
            <div class="event-copy">
              <p>{{ group.latest.message }}</p>
              <div class="event-snapshot">
                <span>{{ formatPrice(group.latest.price, priceDigits(state.assets.find((asset) => asset.symbol === group.symbol)?.kind ?? "stock", group.latest.price)) }}</span>
                <span v-if="group.latest.changePct != null" :class="group.latest.changePct >= 0 ? 'up' : 'down'">
                  {{ formatPercent(group.latest.changePct) }}
                </span>
                <span v-if="group.latest.amount != null">{{ formatCompactMoney(group.latest.amount) }}</span>
                <span v-if="group.latest.source">{{ group.latest.source }}</span>
              </div>
              <small>
                {{ timeAgo(group.latest.at) }} · {{ group.latest.name }}
                <template v-if="group.count > 1"> · 5 分钟内合并 {{ group.count }} 次</template>
              </small>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
