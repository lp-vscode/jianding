<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { BellRing, Copy, Database, Keyboard, RotateCcw, ShieldCheck, Trash2 } from "lucide-vue-next";
import type { GainLossMode, ViewKey, WatchlistDensity } from "../types";
import {
  copyBackup,
  dataMode,
  requestNotificationPermission,
  resetAllData,
  restoreBackup,
  showToast,
  state,
  updateSettings,
} from "../lib/store";
import { formatTime } from "../lib/format";

const viewOptions: { key: ViewKey; label: string }[] = [
  { key: "watchlist", label: "自选观察" },
  { key: "holdings", label: "我的持仓" },
  { key: "trading", label: "量化交易" },
  { key: "alerts", label: "价格提醒" },
  { key: "settings", label: "偏好设置" },
];

const gainLossOptions: { key: GainLossMode; label: string }[] = [
  { key: "china", label: "红涨绿跌" },
  { key: "accessible", label: "蓝涨橙跌" },
];

const densityOptions: { key: WatchlistDensity; label: string }[] = [
  { key: "comfortable", label: "舒适" },
  { key: "compact", label: "紧凑" },
];

const restoreText = ref("");
const resetArmed = ref(false);
let resetTimer: number | undefined;

const modeText = computed(() => {
  if (dataMode.value === "live") return "实时行情";
  if (dataMode.value === "mixed") return "实时 / 净值";
  if (dataMode.value === "demo") return "示例数据";
  return "连接中";
});

const lastUpdatedText = computed(() =>
  state.lastUpdated ? formatTime(new Date(state.lastUpdated).toISOString()) : "尚未刷新",
);

function onRefreshChange(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value);
  if (value === 5 || value === 15 || value === 30 || value === 60) {
    updateSettings({ refreshSeconds: value });
  }
}

function onStartViewChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as ViewKey;
  if (viewOptions.some((item) => item.key === value)) {
    updateSettings({ startView: value });
  }
}

function setGainLossMode(mode: GainLossMode) {
  updateSettings({ gainLossMode: mode });
}

function setWatchlistDensity(density: WatchlistDensity) {
  updateSettings({ watchlistDensity: density });
}

async function toggleNotifications() {
  if (!state.settings.notifications) {
    const granted = await requestNotificationPermission();
    if (!granted) {
      showToast("系统未授予通知权限，请在系统设置中开启", "error");
      return;
    }
  }
  updateSettings({ notifications: !state.settings.notifications });
}

function doRestore() {
  try {
    restoreBackup(restoreText.value);
    restoreText.value = "";
  } catch (error) {
    console.warn("恢复备份失败", error);
    showToast("备份内容无法识别，请检查 JSON 是否完整", "error");
  }
}

function requestReset() {
  window.clearTimeout(resetTimer);
  if (resetArmed.value) {
    resetArmed.value = false;
    resetAllData();
    return;
  }
  resetArmed.value = true;
  resetTimer = window.setTimeout(() => {
    resetArmed.value = false;
  }, 4000);
}

onBeforeUnmount(() => window.clearTimeout(resetTimer));
</script>

<template>
  <section>
    <div class="view-head">
      <div>
        <p class="eyebrow">Preferences</p>
        <h1>偏好设置</h1>
        <p class="view-sub">
          <span>刷新频率与系统通知</span>
          <i class="sub-dot" />
          <span>数据只保存在本机</span>
          <i class="sub-dot" />
          <span>{{ state.settings.refreshSeconds }} 秒轮询</span>
        </p>
      </div>
    </div>

    <div class="settings-layout">
      <div class="settings-stack">
        <div class="panel settings-panel">
          <h2>行情与启动</h2>
          <p>交易时段按设定间隔刷新，休市后自动降频，减少无谓请求。</p>

          <div class="setting-row">
            <div class="setting-copy">
              <strong>刷新间隔</strong>
              <small>应用在前台时才会轮询行情</small>
            </div>
            <div class="setting-control">
              <select :value="state.settings.refreshSeconds" aria-label="刷新间隔" @change="onRefreshChange">
                <option :value="5">5 秒</option>
                <option :value="15">15 秒</option>
                <option :value="30">30 秒</option>
                <option :value="60">60 秒</option>
              </select>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-copy">
              <strong>启动页面</strong>
              <small>下次打开简盯时直接进入的视图</small>
            </div>
            <div class="setting-control">
              <select :value="state.settings.startView" aria-label="启动页面" @change="onStartViewChange">
                <option v-for="item in viewOptions" :key="item.key" :value="item.key">
                  {{ item.label }}
                </option>
              </select>
            </div>
          </div>

          <div class="setting-row setting-row-choice">
            <div class="setting-copy">
              <strong>涨跌颜色</strong>
              <small>颜色之外始终保留 ▲▼ 方向标记，色觉差异下仍可判断</small>
            </div>
            <div class="setting-choice" role="group" aria-label="涨跌颜色">
              <button
                v-for="option in gainLossOptions"
                :key="option.key"
                type="button"
                :class="{ active: state.settings.gainLossMode === option.key }"
                :aria-pressed="state.settings.gainLossMode === option.key"
                @click="setGainLossMode(option.key)"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <div class="setting-row setting-row-choice">
            <div class="setting-copy">
              <strong>自选密度</strong>
              <small>紧凑模式会缩短行高，适合同时观察更多标的</small>
            </div>
            <div class="setting-choice" role="group" aria-label="自选密度">
              <button
                v-for="option in densityOptions"
                :key="option.key"
                type="button"
                :class="{ active: state.settings.watchlistDensity === option.key }"
                :aria-pressed="state.settings.watchlistDensity === option.key"
                @click="setWatchlistDensity(option.key)"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-copy">
              <strong>系统提醒通知</strong>
              <small>提醒触发时发送桌面通知，应用内记录始终保留</small>
            </div>
            <button
              class="toggle"
              :class="{ on: state.settings.notifications }"
              type="button"
              role="switch"
              :aria-checked="state.settings.notifications"
              aria-label="系统提醒通知"
              @click="toggleNotifications"
            />
          </div>
        </div>

        <div class="panel settings-panel">
          <h2>数据备份</h2>
          <p>自选、持仓、提醒与偏好都保存在本机。复制 JSON 备份，换机或重装后可以恢复。</p>
          <div class="backup-actions">
            <button class="btn" type="button" @click="copyBackup()">
              <Copy :size="14" />
              复制备份 JSON
            </button>
            <span class="chip">
              <Database :size="11" />
              {{ state.watchlist.length }} 自选 · {{ state.holdings.length }} 持仓
            </span>
          </div>
          <div class="restore-box">
            <label class="field">
              <span>恢复备份</span>
              <textarea
                v-model="restoreText"
                spellcheck="false"
                placeholder="粘贴之前复制的备份 JSON，再点击恢复"
              />
            </label>
            <div class="restore-actions">
              <small>恢复会覆盖当前本机数据</small>
              <button class="btn btn-gold" type="button" :disabled="!restoreText.trim()" @click="doRestore">
                <RotateCcw :size="14" />
                恢复
              </button>
            </div>
          </div>
        </div>

        <div class="panel settings-panel danger-zone">
          <h2>重置数据</h2>
          <p>清空自选、持仓、提醒与触发记录，恢复为默认示例自选。操作立即生效。</p>
          <div class="backup-actions">
            <button class="btn btn-danger" type="button" @click="requestReset">
              <Trash2 :size="14" />
              {{ resetArmed ? "再次点击确认重置" : "恢复默认自选" }}
            </button>
            <span v-if="resetArmed" class="confirm-strip">
              <small>4 秒内再次点击确认</small>
            </span>
          </div>
        </div>
      </div>

      <aside class="panel about-card">
        <div class="about-brand">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M6 24V12.5c0-.8.7-1.5 1.5-1.5H25" stroke="currentColor" stroke-opacity=".32" stroke-width="1.6" />
              <path d="M7 22.5l5.2-4.4 3.4 1.9 4.5-6.2 5 2.8" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" />
              <circle cx="25.2" cy="16.6" r="1.5" fill="#f4e5c8" />
            </svg>
          </span>
          <div>
            <strong>简盯</strong>
            <small>MARKET WATCH · v0.1.0</small>
          </div>
        </div>

        <p class="about-note">
          把股票、ETF 与场外基金放在同一张安静的观察台上。行情来自腾讯与天天基金公开接口，只作信息参考。
        </p>

        <div class="about-meta">
          <div>
            <span>数据模式</span>
            <strong>{{ modeText }}</strong>
          </div>
          <div>
            <span>自选 / 持仓</span>
            <strong>{{ state.watchlist.length }} / {{ state.holdings.length }}</strong>
          </div>
          <div>
            <span>提醒规则</span>
            <strong>{{ state.alerts.length }} 条</strong>
          </div>
          <div>
            <span>最近更新</span>
            <strong>{{ lastUpdatedText }}</strong>
          </div>
        </div>

        <div class="shortcut-list">
          <div class="shortcut-row">
            <span><Keyboard :size="11" /> 搜索标的</span>
            <kbd>⌘ K / /</kbd>
          </div>
          <div class="shortcut-row">
            <span><Keyboard :size="11" /> 切换自选</span>
            <kbd>↑ / ↓</kbd>
          </div>
          <div class="shortcut-row">
            <span><BellRing :size="11" /> 快速提醒</span>
            <kbd>R</kbd>
          </div>
          <div class="shortcut-row">
            <span><BellRing :size="11" /> 新建提醒</span>
            <kbd>N</kbd>
          </div>
          <div class="shortcut-row">
            <span><Keyboard :size="11" /> 分组与更多</span>
            <kbd>G</kbd>
          </div>
          <div class="shortcut-row">
            <span><BellRing :size="11" /> 关闭弹窗</span>
            <kbd>Esc</kbd>
          </div>
          <div class="shortcut-row">
            <span><ShieldCheck :size="11" /> 本机存储</span>
            <kbd>Local</kbd>
          </div>
        </div>

        <p class="about-foot">
          场外基金展示最新公布净值，不是实时估值。行情仅供参考，不构成投资建议。
        </p>
      </aside>
    </div>
  </section>
</template>
