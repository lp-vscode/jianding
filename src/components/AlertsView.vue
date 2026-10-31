<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import {
  Activity,
  BellPlus,
  BellRing,
  Bot,
  CheckCheck,
  Copy,
  Gauge,
  Inbox,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  TrendingDown,
  TrendingUp,
  Waves,
  Zap,
} from "lucide-vue-next";
import type { AlertRule, AlertTemplateKey } from "../types";
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
import { ALERT_SCENARIOS } from "../lib/alert-scenarios";
import { formatCompactMoney, formatPercent, formatPrice, priceDigits, timeAgo } from "../lib/format";
import { getAlertDayStats, groupAlertEvents, type AlertEventGroup } from "../lib/event-summary";

const pendingDelete = ref<string | null>(null);
const eventButtons = new Map<string, HTMLDivElement>();
let deleteTimer: number | undefined;

onBeforeUnmount(() => {
  window.clearTimeout(deleteTimer);
  window.removeEventListener("keydown", onShortcut);
});

const activeCount = computed(() => state.alerts.filter((rule) => rule.enabled).length);
const unreadCount = computed(() => state.events.filter((event) => !event.read).length);
const eventGroups = computed(() => groupAlertEvents(state.events));
const dayStats = computed(() => getAlertDayStats(state.events, eventGroups.value));
const todayEvents = computed(() => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return state.events.filter((event) => event.at >= start.getTime());
});
const todayCount = computed(() => dayStats.value.total);
const todayUnreadCount = computed(() => dayStats.value.unread);
const todayProcessedCount = computed(() => dayStats.value.processed);
const todayGroupCount = computed(() => dayStats.value.groupCount);
const mostActiveSymbol = computed(() => dayStats.value.mostActive?.symbol ?? null);
const healthState = computed(() => {
  if (!todayCount.value) return { label: "今日安静", detail: "暂无规则触发，保持轻量监控" };
  if (todayUnreadCount.value) {
    return {
      label: "待处理",
      detail: `${todayUnreadCount.value} 条未处理，处理率 ${dayStats.value.processingRate.toFixed(0)}%`,
    };
  }
  return { label: "节奏平稳", detail: `${todayCount.value} 次触发已全部处理` };
});
const primaryAlertAction = computed(() => {
  if (todayUnreadCount.value > 0) {
    return {
      label: "先处理未读触发",
      detail: `${todayUnreadCount.value} 条事件尚未确认`,
      cta: "全部已读",
    };
  }
  if (todayCount.value > 0) {
    return {
      label: "整理今日盯盘复盘",
      detail: `${todayGroupCount.value} 条摘要可复制保存`,
      cta: "复制复盘",
    };
  }
  return {
    label: "把观察变成条件",
    detail: "价格、涨跌幅与成交额可组合触发",
    cta: "新建提醒",
  };
});

const scenarioIcons: Record<AlertTemplateKey, typeof BellRing> = {
  breakout: TrendingUp,
  volume: Zap,
  pullback: TrendingDown,
  volatility: Waves,
  goldenCross: Activity,
  rsiOversold: Gauge,
  takeProfit: TrendingUp,
  stopLoss: ShieldAlert,
};
const scenarioTemplates = computed(() =>
  ALERT_SCENARIOS.map((scenario) => ({
    ...scenario,
    icon: scenarioIcons[scenario.key],
    disabled: scenario.requiresHolding === true && !state.holdings.length,
  })),
);

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

function setEventButton(key: string, element: unknown) {
  if (element instanceof HTMLDivElement) eventButtons.set(key, element);
  else eventButtons.delete(key);
}

function markGroupRead(group: AlertEventGroup) {
  markEventsRead(group.events.map((event) => event.id));
}

function openEvent(group: AlertEventGroup) {
  markGroupRead(group);
  selectAsset(group.symbol);
}

function moveEventFocus(index: number, step: -1 | 1) {
  if (!eventGroups.value.length) return;
  const next = (index + step + eventGroups.value.length) % eventGroups.value.length;
  const group = eventGroups.value[next];
  void nextTick(() => eventButtons.get(group.key)?.focus());
}

function onEventKeydown(event: KeyboardEvent, index: number, group: AlertEventGroup) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveEventFocus(index, event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    openEvent(group);
    return;
  }
  if (event.key.toLowerCase() === "m") {
    event.preventDefault();
    event.stopPropagation();
    markGroupRead(group);
    showToast("该事件组已标记为已读", "info");
  }
}

function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return (
    element?.tagName === "INPUT" ||
    element?.tagName === "TEXTAREA" ||
    element?.tagName === "SELECT" ||
    element?.isContentEditable
  );
}

function onShortcut(event: KeyboardEvent) {
  if (isTypingTarget(event.target) || state.view !== "alerts") return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key.toLowerCase() === "m") {
    event.preventDefault();
    markEventsRead();
    showToast("今日触发已全部标记为已读", "success");
    return;
  }
  if (event.key.toLowerCase() === "c") {
    event.preventDefault();
    void copyDailyReview();
    return;
  }
  if (event.key === "Escape" && event.target instanceof HTMLElement) {
    event.target.blur();
  }
}

async function copyDailyReview() {
  const lines = todayEvents.value.slice(0, 20).map((event) => {
    const pct = event.changePct == null ? "" : `，${formatPercent(event.changePct)}`;
    return `- ${event.name}：${event.message}（${new Date(event.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}${pct}）`;
  });
  const text = [
    "简盯 · 今日盯盘复盘",
    `触发 ${todayCount.value} 次，合并为 ${todayGroupCount.value} 条摘要，已处理 ${todayProcessedCount.value} 条，未处理 ${todayUnreadCount.value} 条。`,
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

function runPrimaryAlertAction() {
  if (todayUnreadCount.value > 0) {
    markEventsRead();
    return;
  }
  if (todayCount.value > 0) {
    void copyDailyReview();
    return;
  }
  openAlertDialog();
}

function launchScenario(scenario: (typeof scenarioTemplates.value)[number]) {
  if (scenario.disabled) {
    showToast("请先在“我的持仓”添加至少一笔持仓", "info");
    return;
  }
  const symbol =
    scenario.requiresHolding === true
      ? state.holdings[0]?.symbol ?? state.selectedSymbol
      : state.selectedSymbol;
  openAlertDialog(symbol, null, scenario.key);
}

onMounted(() => window.addEventListener("keydown", onShortcut));
</script>

<template>
  <section class="view-page view-alerts">
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
    </div>

    <div class="panel workspace-signal alerts-signal" :class="{ 'has-active-rules': activeCount > 0 }">
      <div class="workspace-signal-meta">
        <span>{{ activeCount }} / {{ state.alerts.length }} 条规则监控中</span>
        <span class="workspace-signal-status"><i aria-hidden="true" />{{ healthState.label }}</span>
      </div>

      <div class="workspace-signal-board">
        <div class="workspace-signal-core">
          <div class="workspace-signal-core-head">
            <span>今日触发</span>
            <small>{{ healthState.label }}</small>
          </div>
          <strong>{{ todayCount }}<small> 次</small></strong>
          <div class="workspace-signal-core-foot">
            <span>{{ todayProcessedCount }} 已处理 · {{ todayUnreadCount }} 待处理</span>
            <span>{{ healthState.detail }}</span>
          </div>
        </div>

        <div class="workspace-signal-side">
          <div class="workspace-signal-mini">
            <span>未处理</span>
            <strong>{{ todayUnreadCount }} 条</strong>
            <small>{{ todayUnreadCount ? "建议先确认触发记录" : "今日事件已清空" }}</small>
          </div>
          <div class="workspace-signal-mini">
            <span>处理率</span>
            <strong>{{ todayCount ? `${dayStats.processingRate.toFixed(0)}%` : "--" }}</strong>
            <small>今日 {{ todayCount }} 次触发</small>
          </div>
        </div>
      </div>

      <div class="workspace-signal-facts">
        <span>今日摘要</span>
        <strong>{{ todayGroupCount }} 条</strong>
        <i aria-hidden="true" />
        <span>最活跃</span>
        <strong>{{ mostActiveSymbol ? assetName(mostActiveSymbol) : "--" }}</strong>
        <i aria-hidden="true" />
        <span>规则</span>
        <strong>{{ activeCount }} 条生效</strong>
      </div>

      <button class="workspace-signal-action" type="button" @click="runPrimaryAlertAction">
        <span class="workspace-signal-action-icon" aria-hidden="true">
          <BellPlus v-if="!todayCount" :size="17" />
          <CheckCheck v-else-if="todayUnreadCount" :size="17" />
          <Copy v-else :size="17" />
        </span>
        <span>
          <strong>{{ primaryAlertAction.label }}</strong>
          <small>{{ primaryAlertAction.detail }}</small>
        </span>
        <span class="workspace-signal-action-cta">{{ primaryAlertAction.cta }}</span>
      </button>
    </div>

    <section class="panel alert-scenarios" aria-labelledby="alert-scenarios-title">
      <div class="panel-head">
        <div>
          <h2 id="alert-scenarios-title">情景模板</h2>
          <p>选中一个场景，直接预填条件并继续调整阈值</p>
        </div>
        <span class="chip">
          <Zap :size="11" />
          一键预填
        </span>
      </div>
      <div class="alert-scenario-grid">
        <button
          v-for="scenario in scenarioTemplates"
          :key="scenario.key"
          class="alert-scenario"
          :class="{ disabled: scenario.disabled }"
          type="button"
          :disabled="scenario.disabled"
          :aria-label="`${scenario.label}：${scenario.description}`"
          @click="launchScenario(scenario)"
        >
          <span class="alert-scenario-icon" aria-hidden="true">
            <component :is="scenario.icon" :size="15" :stroke-width="1.7" />
          </span>
          <span>
            <strong>{{ scenario.label }}</strong>
            <small>{{ scenario.description }}</small>
          </span>
        </button>
      </div>
    </section>

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
              <small v-if="rule.autoTrade?.enabled" class="rule-auto-badge">
                <Bot :size="10" aria-hidden="true" />
                自动{{ rule.autoTrade.side === "buy" ? "买入" : "卖出" }}
                ¥{{ formatCompactMoney(rule.autoTrade.notional) }}
              </small>
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
            v-for="(group, index) in eventGroups"
            :key="group.key"
            :ref="(element) => setEventButton(group.key, element)"
            class="event-row"
            :class="{ unread: group.unreadCount > 0 }"
            role="button"
            tabindex="0"
            @click="openEvent(group)"
            @keydown="onEventKeydown($event, index, group)"
          >
            <i class="event-dot" />
            <div class="event-copy">
              <p>{{ group.summary }}</p>
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
                <template v-if="group.count > 1"> · 合并 {{ group.count }} 次</template>
                <template v-if="group.unreadCount"> · {{ group.unreadCount }} 条未读</template>
              </small>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
