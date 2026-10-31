<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import {
  Activity,
  ArrowUpRight,
  Check,
  Copy,
  Database,
  ExternalLink,
  Info,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-vue-next";
import type { Asset, Quote, TrendPoint } from "../types";
import { fetchTrend } from "../lib/backend";
import { formatCompactMoney, formatPercent, toneOf } from "../lib/format";
import {
  fetchMarketUniverse,
  fetchStockFundamentals,
  fetchStockNews,
  marketStockToAsset,
  preScreenMarketStocks,
  type MarketUniverseStock,
  type StockFundamentals,
  type StockNewsItem,
} from "../lib/market-research";
import {
  rankStockCandidates,
  type StockAiCandidate,
  type StockAiProfile,
} from "../lib/stock-ai";
import { quoteFor, showToast } from "../lib/store";

const props = defineProps<{ assets: Asset[] }>();
const emit = defineEmits<{ close: []; select: [symbol: string] }>();

type UniverseMode = "market" | "watchlist";

const mode = ref<UniverseMode>("market");
const profile = ref<StockAiProfile>("balanced");
const trends = ref<Record<string, TrendPoint[]>>({});
const marketStocks = ref<MarketUniverseStock[]>([]);
const deepStocks = ref<MarketUniverseStock[]>([]);
const fundamentals = ref<Record<string, StockFundamentals | null>>({});
const news = ref<Record<string, StockNewsItem[]>>({});
const marketScanned = ref(0);
const marketProgress = ref("");
const newsLoadingFor = ref<string | null>(null);
const loading = ref(true);
const error = ref("");
const selectedSymbol = ref<string | null>(null);
const dialog = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
let requestId = 0;

const profileOptions: Array<{
  key: StockAiProfile;
  label: string;
  description: string;
}> = [
  { key: "steady", label: "稳健", description: "更看重趋势与回撤" },
  { key: "balanced", label: "均衡", description: "趋势、动量与风险兼顾" },
  { key: "aggressive", label: "进取", description: "提高动量权重" },
];
const modeOptions: Array<{ key: UniverseMode; label: string }> = [
  { key: "market", label: "全市场" },
  { key: "watchlist", label: "自选池" },
];

const stockAssets = computed(() => props.assets.filter((asset) => asset.kind === "stock"));
const candidateAssets = computed(() =>
  mode.value === "market" ? deepStocks.value.map(marketStockToAsset) : stockAssets.value,
);
const report = computed(() =>
  rankStockCandidates(
    candidateAssets.value.map((asset) => ({
      asset,
      quote:
        quoteFor(asset.symbol) ??
        quoteFromMarketStock(
          marketStocks.value.find((stock) => stock.symbol === asset.symbol),
        ),
      trend: trends.value[asset.symbol] ?? [],
      fundamentals: fundamentals.value[asset.symbol] ?? null,
      news: news.value[asset.symbol] ?? [],
    })),
    profile.value,
  ),
);
const selectedCandidate = computed(
  () =>
    report.value.candidates.find((candidate) => candidate.symbol === selectedSymbol.value) ??
    report.value.topPick ??
    report.value.candidates[0] ??
    null,
);
const profileDescription = computed(
  () => profileOptions.find((option) => option.key === profile.value)?.description ?? "",
);

function candidateForIndustry(symbol: string | null) {
  return report.value.candidates.find((candidate) => candidate.symbol === symbol) ?? null;
}

function factorRows(candidate: StockAiCandidate) {
  return [
    { label: "趋势", value: candidate.factors.trend },
    { label: "动量", value: candidate.factors.momentum },
    { label: "风险", value: candidate.factors.risk },
    { label: "行业", value: candidate.factors.industry },
    { label: "流动性", value: candidate.factors.liquidity },
    { label: "财报", value: candidate.factors.fundamentals },
    { label: "消息", value: candidate.factors.news },
  ];
}

function quoteFromMarketStock(stock: MarketUniverseStock | undefined): Quote | null {
  if (!stock) return null;
  return {
    symbol: stock.symbol,
    code: stock.code,
    name: stock.name,
    price: stock.price,
    previousClose: null,
    change: null,
    changePct: stock.changePct,
    open: null,
    high: null,
    low: null,
    volume: null,
    amount: stock.amount,
    updatedAt: null,
    navDate: null,
    state: "live",
    source: "新浪财经",
  };
}

function ratingTone(candidate: StockAiCandidate | null) {
  if (!candidate?.available) return "muted";
  if (candidate.score >= 76) return "strong";
  if (candidate.score >= 62) return "positive";
  if (candidate.score >= 48) return "neutral";
  return "risk";
}

function topThesis(candidate: StockAiCandidate | null) {
  if (!candidate) return "当前没有足够数据形成排序。";
  if (!candidate.available) return "历史行情样本不足，暂不参与排序。";
  if (candidate.score >= 76) {
    return `${candidate.industry}内部相对强势，趋势、风险与流动性形成共振；仍需等待市场确认。`;
  }
  if (candidate.score >= 62) {
    return `趋势结构占优，但并非无风险选择；更适合放入研究清单继续跟踪。`;
  }
  if (candidate.score >= 48) {
    return `多空因素接近平衡，当前没有显著优势，适合观察而非追价。`;
  }
  return `风险和弱势信号占优，当前不应仅凭排名采取行动。`;
}

async function loadCandidates() {
  const request = ++requestId;
  loading.value = true;
  error.value = "";
  selectedSymbol.value = null;
  marketProgress.value = mode.value === "market" ? "正在连接全市场行情" : "正在读取自选行情";
  try {
    if (mode.value === "watchlist") {
      marketProgress.value = "正在读取自选行情、财报与新闻";
      const enriched = await Promise.all(
        stockAssets.value.map(async (asset) => {
          const [points, report] = await Promise.all([
            fetchTrend(asset, "3m"),
            fetchStockFundamentals(asset.code),
          ]);
          return { symbol: asset.symbol, points, report };
        }),
      );
      if (request !== requestId) return;
      trends.value = Object.fromEntries(enriched.map((item) => [item.symbol, item.points]));
      fundamentals.value = Object.fromEntries(
        enriched.map((item) => [item.symbol, item.report]),
      );
      await nextTick();
      const newsEntries = await Promise.all(
        stockAssets.value.map(async (asset) => [
          asset.symbol,
          await fetchStockNews(asset.name, 4),
        ] as const),
      );
      if (request !== requestId) return;
      news.value = Object.fromEntries(newsEntries);
    } else {
      const allStocks = await fetchMarketUniverse((loaded, total) => {
        marketProgress.value = `正在扫描全市场行情 ${Math.min(loaded, total).toLocaleString("zh-CN")} / ${total.toLocaleString("zh-CN")}`;
      });
      if (request !== requestId) return;
      marketStocks.value = allStocks;
      marketScanned.value = allStocks.length;
      const shortlist = preScreenMarketStocks(allStocks, 12);
      deepStocks.value = shortlist;
      marketProgress.value = `已筛选 ${shortlist.length} 只候选，正在读取趋势与财报`;
      const enriched = await Promise.all(
        shortlist.map(async (stock) => {
          const asset = marketStockToAsset(stock);
          const [points, report] = await Promise.all([
            fetchTrend(asset, "3m"),
            fetchStockFundamentals(stock.code),
          ]);
          return { symbol: stock.symbol, points, report };
        }),
      );
      if (request !== requestId) return;
      trends.value = Object.fromEntries(enriched.map((item) => [item.symbol, item.points]));
      fundamentals.value = Object.fromEntries(
        enriched.map((item) => [item.symbol, item.report]),
      );
      await nextTick();
      const newsTargets = rankStockCandidates(
        shortlist.map((stock) => ({
          asset: marketStockToAsset(stock),
          quote: quoteFromMarketStock(stock),
          trend: trends.value[stock.symbol] ?? [],
          fundamentals: fundamentals.value[stock.symbol] ?? null,
        })),
        profile.value,
      ).candidates
        .filter((candidate) => candidate.available)
        .slice(0, 5);
      marketProgress.value = `正在核对 ${newsTargets.length} 只候选的最新新闻`;
      const newsEntries = await Promise.all(
        newsTargets.map(async (candidate) => [
          candidate.symbol,
          await fetchStockNews(candidate.name, 4),
        ] as const),
      );
      if (request !== requestId) return;
      news.value = Object.fromEntries(newsEntries);
    }
    if (request !== requestId) return;
    await nextTick();
    selectedSymbol.value = report.value.topPick?.symbol ?? report.value.candidates[0]?.symbol ?? null;
  } catch (cause) {
    if (request !== requestId) return;
    console.warn("AI 选股数据加载失败", cause);
    error.value =
      mode.value === "market"
        ? "全市场研究数据暂时无法完整加载，可切换到自选池继续研判"
        : "候选行情暂时无法完整加载";
  } finally {
    if (request === requestId) loading.value = false;
  }
}

function setProfile(next: StockAiProfile) {
  profile.value = next;
  void nextTick(() => {
    selectedSymbol.value = report.value.topPick?.symbol ?? report.value.candidates[0]?.symbol ?? null;
  });
}

function setMode(next: UniverseMode) {
  if (next === mode.value) return;
  mode.value = next;
  void loadCandidates();
}

async function selectCandidate(candidate: StockAiCandidate) {
  selectedSymbol.value = candidate.symbol;
  if (mode.value !== "market" || news.value[candidate.symbol]) return;
  newsLoadingFor.value = candidate.symbol;
  try {
    const items = await fetchStockNews(candidate.name, 4);
    news.value = { ...news.value, [candidate.symbol]: items };
  } finally {
    if (newsLoadingFor.value === candidate.symbol) newsLoadingFor.value = null;
  }
}

function inspectCandidate(candidate: StockAiCandidate) {
  emit("select", candidate.symbol);
  emit("close");
}

function screeningSummary() {
  const top = report.value.topPick;
  const lines = [
    "简盯 · AI 选股研判",
    `模式：${profileOptions.find((option) => option.key === profile.value)?.label ?? profile.value}`,
    mode.value === "market"
      ? `范围：全市场扫描 ${marketScanned.value} 只，深度研判 ${report.value.universeSize} 只`
      : `范围：当前自选 ${report.value.universeSize} 只 A 股`,
    "数据：3 个月行情、最新财报、近期新闻",
    "",
    ...report.value.candidates
      .filter((candidate) => candidate.available)
      .map(
        (candidate) =>
          `${candidate.rank}. ${candidate.name}（${candidate.code}）· ${candidate.industry} · ${candidate.score}/100 · ${candidate.rating} · ${candidate.reasons.join("；")}`,
      ),
    "",
    top
      ? `首要研究候选：${top.name}，${top.score}/100。`
      : "当前没有足够数据形成首要候选。",
    "评分为公开数据的多因子排序，不是收益概率或买卖建议；新闻情绪仅按关键词规则判断。",
  ];
  return lines.join("\n");
}

async function copyScreening() {
  try {
    await navigator.clipboard.writeText(screeningSummary());
    showToast("AI 选股研判已复制", "success");
  } catch {
    showToast("复制失败，请检查剪贴板权限", "error");
  }
}

function close() {
  emit("close");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== "Tab" || !dialog.value) return;
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>(
    'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  void loadCandidates();
  void nextTick(() => closeButton.value?.focus());
});

onBeforeUnmount(() => {
  requestId += 1;
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div class="stock-ai-backdrop" @mousedown.self="close">
      <section
        ref="dialog"
        class="stock-ai-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-ai-title"
      >
        <header class="stock-ai-head">
          <div>
            <div class="stock-ai-title-row">
              <Sparkles :size="17" aria-hidden="true" />
              <h2 id="stock-ai-title">AI 选股研判</h2>
            </div>
            <p>{{ mode === "market" ? "沪深全市场" : "当前自选 A 股" }} · 行情、财报与新闻多因子研判</p>
          </div>
          <button ref="closeButton" class="icon-btn" type="button" aria-label="关闭 AI 选股研判" @click="close">
            <X :size="17" />
          </button>
        </header>

        <div class="stock-ai-commandbar">
          <div class="segmented stock-ai-modes" role="group" aria-label="研判范围">
            <button
              v-for="option in modeOptions"
              :key="option.key"
              type="button"
              :class="{ active: mode === option.key }"
              :aria-pressed="mode === option.key"
              @click="setMode(option.key)"
            >
              {{ option.label }}
            </button>
          </div>
          <div class="segmented stock-ai-profiles" role="group" aria-label="AI 研判偏好">
            <button
              v-for="option in profileOptions"
              :key="option.key"
              type="button"
              :class="{ active: profile === option.key }"
              :aria-pressed="profile === option.key"
              @click="setProfile(option.key)"
            >
              {{ option.label }}
            </button>
          </div>
          <span>{{ profileDescription }}</span>
          <button class="ai-refresh" type="button" :disabled="loading" @click="loadCandidates">
            <RefreshCw :size="13" :class="{ spinning: loading }" />
            重新研判
          </button>
        </div>

        <div class="stock-ai-body">
          <div v-if="loading" class="stock-ai-loading" role="status" aria-live="polite">
            <div class="ai-scan-mark"><Sparkles :size="22" /></div>
            <strong>{{ marketProgress }}</strong>
            <span>{{ mode === "market" ? "全市场横截面筛选 · 财报与新闻分层补充" : "本地计算 · 不上传自选与持仓" }}</span>
            <i /><i />
          </div>

          <div v-else-if="mode === 'watchlist' && !stockAssets.length" class="stock-ai-empty">
            <Sparkles :size="24" aria-hidden="true" />
            <strong>自选池里还没有 A 股</strong>
            <p>先添加至少两只股票，AI 才能比较趋势、行业和风险差异。</p>
            <button class="btn btn-small" type="button" @click="close">返回自选</button>
          </div>

          <div v-else-if="error" class="stock-ai-empty" role="alert">
            <strong>暂时无法完成研判</strong>
            <p>{{ error }}</p>
            <span class="stock-ai-empty-actions">
              <button class="btn btn-small" type="button" @click="loadCandidates">重试</button>
              <button
                v-if="mode === 'market' && stockAssets.length"
                class="btn btn-small btn-ghost"
                type="button"
                @click="setMode('watchlist')"
              >
                改看自选池
              </button>
            </span>
          </div>

          <template v-else>
            <div class="ai-scope-strip">
              <span>
                <b>{{ mode === "market" ? marketScanned : report.universeSize }}</b>
                {{ mode === "market" ? "只沪深股票扫描" : "只自选股票" }}
              </span>
              <span v-if="mode === 'market'"><b>{{ report.universeSize }}</b> 只深度研判</span>
              <span><b>{{ report.industries.length }}</b> 个行业</span>
              <span><b>{{ report.candidates[0]?.dataPoints ?? 0 }}</b> 日行情</span>
              <span class="ai-source-strip"><Database :size="11" aria-hidden="true" />行情 · 财报 · 新闻</span>
            </div>

            <section v-if="report.topPick" class="ai-leading-card" aria-labelledby="ai-leading-title">
              <div class="ai-leading-meta">
                <span><Sparkles :size="12" aria-hidden="true" />当前首选研究候选</span>
                <span>{{ report.topPick.industry }} · {{ report.topPick.fundamentals?.periodLabel || "财报待补" }}</span>
              </div>
              <div class="ai-leading-main">
                <div class="ai-leading-identity">
                  <h3 id="ai-leading-title">{{ report.topPick.name }}</h3>
                  <p class="mono">{{ report.topPick.code }} · {{ report.topPick.rating }}</p>
                </div>
                <div class="ai-leading-score">
                  <strong>{{ report.topPick.score }}</strong>
                  <span>/ 100</span>
                </div>
              </div>
              <p class="ai-leading-thesis">{{ topThesis(report.topPick) }}</p>
              <div class="ai-leading-reasons">
                <span v-for="reason in report.topPick.reasons.slice(0, 3)" :key="reason">
                  <Check :size="11" aria-hidden="true" />
                  {{ reason }}
                </span>
              </div>
              <div class="ai-leading-foot">
                <span>行情、财报与新闻规则共同评分，不是胜率预测</span>
                <button type="button" @click="inspectCandidate(report.topPick)">
                  查看标的
                  <ArrowUpRight :size="12" />
                </button>
              </div>
            </section>

            <section class="ai-industry-section" aria-labelledby="ai-industry-title">
              <div class="ai-section-head">
                <div>
                  <h3 id="ai-industry-title">行业温度</h3>
                  <p>按当前候选池分组，仅反映近 20 个交易日</p>
                </div>
              </div>
              <div class="ai-industry-rail">
                <article v-for="industry in report.industries" :key="industry.name">
                  <span>{{ industry.name }} · {{ industry.count }}</span>
                  <strong :class="toneOf(industry.averageReturn20)">
                    {{ formatPercent(industry.averageReturn20) }}
                  </strong>
                  <small>{{ candidateForIndustry(industry.leaderSymbol)?.name ?? "暂无样本" }}</small>
                </article>
              </div>
            </section>

            <div class="ai-workbench">
              <section class="ai-ranking" aria-labelledby="ai-ranking-title">
                <div class="ai-section-head">
                  <div>
                    <h3 id="ai-ranking-title">候选排序</h3>
                    <p>切换标的查看评分构成与风险提示</p>
                  </div>
                  <span>{{ report.availableCount }} / {{ report.universeSize }} 有效</span>
                </div>
                <div class="ai-ranking-list">
                  <button
                    v-for="candidate in report.candidates"
                    :key="candidate.symbol"
                    type="button"
                    :class="[
                      ratingTone(candidate),
                      { selected: selectedCandidate?.symbol === candidate.symbol },
                    ]"
                    :disabled="!candidate.available && report.availableCount > 0"
                    @click="selectCandidate(candidate)"
                  >
                    <span class="ai-rank">{{ String(candidate.rank).padStart(2, "0") }}</span>
                    <span class="ai-rank-name">
                      <strong>{{ candidate.name }}</strong>
                      <small>
                        {{ candidate.industry }} · {{ candidate.code }}
                        <template v-if="candidate.fundamentals?.roe != null">
                          · ROE {{ candidate.fundamentals.roe.toFixed(1) }}%
                        </template>
                      </small>
                    </span>
                    <span class="ai-rank-change" :class="toneOf(candidate.metrics.return20)">
                      {{ candidate.available ? formatPercent(candidate.metrics.return20) : "--" }}
                      <small>20日</small>
                    </span>
                    <span class="ai-rank-score">
                      <strong>{{ candidate.available ? candidate.score : "--" }}</strong>
                      <i :style="{ '--score': `${candidate.score}%` }" />
                    </span>
                  </button>
                </div>
              </section>

              <aside v-if="selectedCandidate" class="ai-inspector">
                <div class="ai-inspector-head">
                  <div>
                    <span>{{ selectedCandidate.industry }}</span>
                    <h3>{{ selectedCandidate.name }}</h3>
                  </div>
                  <strong :class="ratingTone(selectedCandidate)">{{ selectedCandidate.rating }}</strong>
                </div>

                <div class="ai-factor-list">
                  <div v-for="factor in factorRows(selectedCandidate)" :key="factor.label">
                    <span>{{ factor.label }}</span>
                    <i><b :style="{ width: `${factor.value}%` }" /></i>
                    <strong>{{ factor.value }}</strong>
                  </div>
                </div>

                <div class="ai-inspector-metrics">
                  <div>
                    <span>60 日趋势</span>
                    <strong :class="toneOf(selectedCandidate.metrics.return60)">
                      {{ formatPercent(selectedCandidate.metrics.return60) }}
                    </strong>
                  </div>
                  <div>
                    <span>区间回撤</span>
                    <strong>{{ selectedCandidate.metrics.maxDrawdown.toFixed(1) }}%</strong>
                  </div>
                  <div>
                    <span>年化波动</span>
                    <strong>{{ selectedCandidate.metrics.volatility.toFixed(1) }}%</strong>
                  </div>
                  <div>
                    <span>今日成交额</span>
                    <strong>{{ formatCompactMoney(selectedCandidate.metrics.amount) }}</strong>
                  </div>
                </div>

                <div v-if="selectedCandidate.fundamentals" class="ai-fundamentals">
                  <div class="ai-inspector-subhead">
                    <span>最新财报 · {{ selectedCandidate.fundamentals.periodLabel }}</span>
                    <small class="mono">{{ selectedCandidate.fundamentals.reportDate }}</small>
                  </div>
                  <div class="ai-fundamental-grid">
                    <div>
                      <span>ROE</span>
                      <strong>{{ selectedCandidate.fundamentals.roe == null ? "--" : `${selectedCandidate.fundamentals.roe.toFixed(1)}%` }}</strong>
                    </div>
                    <div>
                      <span>营收同比</span>
                      <strong :class="toneOf(selectedCandidate.fundamentals.revenueGrowth)">
                        {{ formatPercent(selectedCandidate.fundamentals.revenueGrowth) }}
                      </strong>
                    </div>
                    <div>
                      <span>净利同比</span>
                      <strong :class="toneOf(selectedCandidate.fundamentals.profitGrowth)">
                        {{ formatPercent(selectedCandidate.fundamentals.profitGrowth) }}
                      </strong>
                    </div>
                  </div>
                </div>

                <div class="ai-news">
                  <div class="ai-inspector-subhead">
                    <span>近期新闻</span>
                    <small>{{ newsLoadingFor === selectedCandidate.symbol ? "读取中" : `${selectedCandidate.news.length} 条` }}</small>
                  </div>
                  <div v-if="selectedCandidate.news.length" class="ai-news-list">
                    <a
                      v-for="item in selectedCandidate.news.slice(0, 4)"
                      :key="item.id"
                      :href="item.url"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <strong>{{ item.title }}</strong>
                      <small>{{ item.source }} · {{ item.publishedAt.slice(5, 16) }}</small>
                      <ExternalLink :size="10" aria-hidden="true" />
                    </a>
                  </div>
                  <p v-else class="ai-news-empty">
                    {{ newsLoadingFor === selectedCandidate.symbol ? "正在读取新闻…" : "暂无可用新闻摘要" }}
                  </p>
                </div>

                <div class="ai-inspector-reasons">
                  <span>判断依据</span>
                  <p v-for="reason in selectedCandidate.reasons" :key="reason">{{ reason }}</p>
                </div>

                <div v-if="selectedCandidate.warnings.length" class="ai-inspector-warnings">
                  <span><ShieldCheck :size="12" aria-hidden="true" />先看风险</span>
                  <p v-for="warning in selectedCandidate.warnings" :key="warning">{{ warning }}</p>
                </div>

                <button
                  class="btn btn-small ai-inspect-action"
                  type="button"
                  @click="inspectCandidate(selectedCandidate)"
                >
                  查看{{ selectedCandidate.name }}
                  <ArrowUpRight :size="12" />
                </button>
              </aside>
            </div>

            <p class="ai-disclaimer">
              <Info :size="13" aria-hidden="true" />
              评分来自公开行情、财报和新闻关键词规则，不是收益概率或买卖建议。新闻摘要可能遗漏上下文，重大事项请回到公告原文核验。
            </p>
          </template>
        </div>

        <footer class="stock-ai-foot">
          <span><Activity :size="12" aria-hidden="true" />本地研判，不上传自选与持仓</span>
          <div>
            <button class="btn btn-small btn-ghost" type="button" :disabled="loading" @click="copyScreening">
              <Copy :size="12" />
              复制研判
            </button>
            <button class="btn btn-small" type="button" @click="close">完成</button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.stock-ai-backdrop {
  position: fixed;
  z-index: 112;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 14, 14, 0.38);
  backdrop-filter: blur(16px) saturate(1.1);
  -webkit-backdrop-filter: blur(16px) saturate(1.1);
}

.stock-ai-dialog {
  display: flex;
  width: min(920px, 100%);
  max-height: min(900px, calc(100vh - 48px));
  flex-direction: column;
  overflow: hidden;
  border-radius: 22px;
  background: var(--panel);
  box-shadow: 0 34px 90px -44px rgba(0, 0, 0, 0.72);
}

.stock-ai-head,
.stock-ai-foot {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--line);
}

.stock-ai-head {
  background:
    radial-gradient(360px 190px at 100% -30%, rgba(194, 58, 52, 0.12), transparent 72%),
    var(--panel);
}

.stock-ai-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--up);
}

.stock-ai-title-row h2 {
  margin: 0;
  color: var(--ink);
  font-size: 23px;
  font-weight: 680;
  letter-spacing: -0.035em;
}

.stock-ai-head p {
  margin: 5px 0 0;
  color: var(--ink-3);
  font-size: 10.5px;
}

.stock-ai-commandbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--line);
  background: var(--panel-soft);
}

.stock-ai-commandbar > span {
  color: var(--ink-3);
  font-size: 9.5px;
}

.stock-ai-modes {
  flex: none;
  padding: 2px;
}

.stock-ai-modes button {
  min-height: 30px;
  padding: 0 11px;
  font-size: 9.5px;
}

.stock-ai-profiles {
  flex: none;
  padding: 2px;
}

.stock-ai-profiles button {
  min-height: 30px;
  padding: 0 12px;
  font-size: 9.5px;
}

.ai-refresh {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  padding: 0 9px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--ink-2);
  font-size: 9px;
}

.ai-refresh:hover:not(:disabled) {
  border-color: var(--line-strong);
  color: var(--ink);
}

.stock-ai-body {
  min-height: 0;
  overflow: auto;
  padding: 15px 20px 18px;
}

.ai-scope-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  padding-bottom: 11px;
  border-bottom: 1px solid var(--line);
  color: var(--ink-3);
  font-size: 9px;
}

.ai-scope-strip b {
  color: var(--ink);
  font-family: var(--font-data);
  font-weight: 650;
}

.ai-source-strip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ai-leading-card {
  margin-top: 12px;
  padding: 15px 16px 13px;
  border-radius: 16px;
  background:
    radial-gradient(420px 220px at 100% 0%, rgba(194, 58, 52, 0.26), transparent 68%),
    linear-gradient(145deg, #1c1918 0%, #101010 74%);
  color: #f7f3eb;
}

.ai-leading-meta,
.ai-leading-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ai-leading-meta span:first-child {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #f07a72;
  font-size: 9px;
  font-weight: 650;
}

.ai-leading-meta span:last-child {
  color: #b6b1a8;
  font-size: 9px;
}

.ai-leading-main {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-top: 10px;
}

.ai-leading-identity h3 {
  margin: 0;
  color: #fbf7ef;
  font-size: 30px;
  font-weight: 690;
  letter-spacing: -0.035em;
}

.ai-leading-identity p {
  margin: 4px 0 0;
  color: #b6b1a8;
  font-size: 9.5px;
}

.ai-leading-score {
  display: flex;
  align-items: baseline;
  gap: 4px;
  flex: none;
}

.ai-leading-score strong {
  color: #f2a19b;
  font-family: var(--font-data);
  font-size: 38px;
  font-variant-numeric: tabular-nums;
  font-weight: 650;
  letter-spacing: -0.04em;
  line-height: 1;
}

.ai-leading-score span {
  color: #8f8a82;
  font-size: 9px;
}

.ai-leading-thesis {
  max-width: 68ch;
  margin: 8px 0 0;
  color: #ddd7cd;
  font-size: 10.5px;
  line-height: 1.6;
}

.ai-leading-reasons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: 11px;
  color: #c2bcb2;
  font-size: 9px;
}

.ai-leading-reasons span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ai-leading-reasons svg {
  color: #e96a62;
}

.ai-leading-foot {
  margin-top: 13px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.ai-leading-foot > span {
  color: #8f8a82;
  font-size: 8.5px;
}

.ai-leading-foot button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  color: #f2a19b;
  font-size: 9.5px;
}

.ai-industry-section {
  margin-top: 15px;
}

.ai-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.ai-section-head h3 {
  margin: 0;
  color: var(--ink);
  font-size: 12px;
  font-weight: 650;
}

.ai-section-head p,
.ai-section-head > span {
  margin: 3px 0 0;
  color: var(--ink-3);
  font-size: 9px;
}

.ai-industry-rail {
  display: flex;
  gap: 7px;
  overflow-x: auto;
  margin-top: 9px;
  padding-bottom: 3px;
  scrollbar-width: thin;
}

.ai-industry-rail article {
  display: grid;
  min-width: 126px;
  gap: 3px;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: var(--panel-soft);
}

.ai-industry-rail span,
.ai-industry-rail small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 8.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-industry-rail strong {
  font-family: var(--font-data);
  font-size: 11px;
}

.ai-workbench {
  display: grid;
  grid-template-columns: minmax(0, 1.22fr) minmax(280px, 0.78fr);
  gap: 14px;
  margin-top: 16px;
}

.ai-ranking-list {
  margin-top: 8px;
  border-top: 1px solid var(--line);
}

.ai-ranking-list button {
  display: grid;
  width: 100%;
  min-height: 56px;
  grid-template-columns: 25px minmax(0, 1fr) 66px 62px;
  align-items: center;
  gap: 9px;
  padding: 8px 9px;
  border-bottom: 1px solid var(--line);
  color: var(--ink);
  text-align: left;
  transition: background 150ms ease;
}

.ai-ranking-list button:hover:not(:disabled) {
  background: var(--panel-soft);
}

.ai-ranking-list button.selected {
  background: rgba(194, 58, 52, 0.055);
}

.ai-ranking-list button.selected .ai-rank {
  color: var(--up);
}

.ai-ranking-list button:disabled {
  opacity: 0.48;
}

.ai-rank {
  color: var(--ink-3);
  font-family: var(--font-data);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}

.ai-rank-name {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.ai-rank-name strong {
  overflow: hidden;
  font-size: 10.5px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-rank-name small,
.ai-rank-change small {
  color: var(--ink-3);
  font-size: 8px;
}

.ai-rank-change {
  display: grid;
  justify-items: end;
  gap: 1px;
  font-family: var(--font-data);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
}

.ai-rank-score {
  display: grid;
  justify-items: end;
  gap: 4px;
}

.ai-rank-score strong {
  font-family: var(--font-data);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.ai-rank-score i {
  display: block;
  width: 46px;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--paper-deep);
}

.ai-rank-score i::after {
  display: block;
  width: var(--score);
  height: 100%;
  background: var(--up);
  content: "";
}

.ai-inspector {
  align-self: start;
  padding: 13px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel-soft);
}

.ai-inspector-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.ai-inspector-head span {
  color: var(--ink-3);
  font-size: 8.5px;
}

.ai-inspector-head h3 {
  margin: 2px 0 0;
  color: var(--ink);
  font-size: 16px;
  font-weight: 680;
  letter-spacing: -0.025em;
}

.ai-inspector-head > strong {
  flex: none;
  padding: 3px 7px;
  border-radius: 6px;
  background: var(--panel);
  font-size: 8.5px;
  font-weight: 650;
}

.ai-inspector-head > strong.strong,
.ai-inspector-head > strong.positive {
  color: var(--up);
}

.ai-inspector-head > strong.neutral {
  color: var(--gold-strong);
}

.ai-inspector-head > strong.risk {
  color: var(--down);
}

.ai-factor-list {
  display: grid;
  gap: 7px;
  margin-top: 13px;
}

.ai-factor-list > div {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 24px;
  align-items: center;
  gap: 7px;
}

.ai-factor-list span,
.ai-factor-list strong {
  color: var(--ink-3);
  font-size: 8.5px;
}

.ai-factor-list strong {
  font-family: var(--font-data);
  text-align: right;
}

.ai-factor-list i {
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--paper-deep);
}

.ai-factor-list i b {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #cf5d55, #a92f29);
}

.ai-inspector-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  margin-top: 12px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--line);
}

.ai-inspector-metrics > div {
  display: grid;
  gap: 3px;
  padding: 8px 9px;
  background: var(--panel);
}

.ai-inspector-metrics span {
  color: var(--ink-3);
  font-size: 8px;
}

.ai-inspector-metrics strong {
  color: var(--ink-2);
  font-family: var(--font-data);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
}

.ai-fundamentals,
.ai-news {
  margin-top: 12px;
}

.ai-inspector-subhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ai-inspector-subhead span {
  color: var(--ink-3);
  font-size: 8.5px;
}

.ai-inspector-subhead small {
  color: var(--ink-3);
  font-family: var(--font-data);
  font-size: 8px;
}

.ai-fundamental-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  margin-top: 6px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--line);
}

.ai-fundamental-grid > div {
  display: grid;
  gap: 3px;
  padding: 7px 8px;
  background: var(--panel);
}

.ai-fundamental-grid span {
  color: var(--ink-3);
  font-size: 8px;
}

.ai-fundamental-grid strong {
  color: var(--ink-2);
  font-family: var(--font-data);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
}

.ai-news-list {
  display: grid;
  margin-top: 5px;
  border-top: 1px solid var(--line);
}

.ai-news-list a {
  position: relative;
  display: grid;
  gap: 2px;
  padding: 7px 17px 7px 0;
  border-bottom: 1px solid var(--line);
  color: var(--ink-2);
}

.ai-news-list a:hover strong {
  color: var(--up);
}

.ai-news-list strong {
  font-size: 9px;
  font-weight: 550;
  line-height: 1.45;
  transition: color 150ms ease;
}

.ai-news-list small {
  color: var(--ink-3);
  font-size: 8px;
}

.ai-news-list svg {
  position: absolute;
  top: 9px;
  right: 1px;
  color: var(--ink-3);
}

.ai-news-empty {
  margin: 6px 0 0;
  color: var(--ink-3);
  font-size: 8.5px;
}

.ai-inspector-reasons,
.ai-inspector-warnings {
  margin-top: 12px;
}

.ai-inspector-reasons > span,
.ai-inspector-warnings > span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ink-3);
  font-size: 8.5px;
}

.ai-inspector-reasons p,
.ai-inspector-warnings p {
  position: relative;
  margin: 5px 0 0;
  padding-left: 10px;
  color: var(--ink-2);
  font-size: 9px;
  line-height: 1.5;
}

.ai-inspector-reasons p::before,
.ai-inspector-warnings p::before {
  position: absolute;
  top: 0.62em;
  left: 0;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--ink-3);
  content: "";
}

.ai-inspector-warnings > span {
  color: var(--gold-strong);
}

.ai-inspector-warnings p::before {
  background: var(--gold-strong);
}

.ai-inspect-action {
  width: 100%;
  margin-top: 13px;
}

.stock-ai-loading,
.stock-ai-empty {
  display: grid;
  min-height: 390px;
  place-items: center;
  align-content: center;
  gap: 9px;
  color: var(--ink-3);
  text-align: center;
}

.ai-scan-mark {
  display: grid;
  width: 46px;
  height: 46px;
  place-items: center;
  border: 1px solid rgba(194, 58, 52, 0.18);
  border-radius: 13px;
  background: rgba(194, 58, 52, 0.055);
  color: var(--up);
}

.stock-ai-loading strong,
.stock-ai-empty strong {
  color: var(--ink);
  font-size: 12px;
}

.stock-ai-loading span,
.stock-ai-empty p {
  max-width: 380px;
  margin: 0;
  font-size: 9.5px;
  line-height: 1.55;
}

.stock-ai-empty-actions {
  display: flex;
  gap: 6px;
}

.stock-ai-loading i {
  width: 210px;
  height: 5px;
  margin-top: 5px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--paper-deep), rgba(194, 58, 52, 0.34), var(--paper-deep));
  background-size: 200% 100%;
  animation: ai-loading 1.2s linear infinite;
}

.stock-ai-loading i:last-child {
  width: 145px;
  animation-delay: 120ms;
}

.ai-disclaimer {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 14px 2px 0;
  color: var(--ink-3);
  font-size: 8.5px;
  line-height: 1.55;
}

.ai-disclaimer svg {
  flex: none;
  margin-top: 1px;
  color: var(--gold-strong);
}

.stock-ai-foot {
  align-items: center;
  padding-top: 10px;
  padding-bottom: 10px;
  border-top: 1px solid var(--line);
  border-bottom: 0;
}

.stock-ai-foot > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ink-3);
  font-size: 8.5px;
}

.stock-ai-foot > div {
  display: flex;
  gap: 6px;
}

@keyframes ai-loading {
  to {
    background-position: -200% 0;
  }
}

.spinning {
  animation: spin 700ms linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 720px) {
  .stock-ai-backdrop {
    align-items: end;
    padding: 0;
  }

  .stock-ai-dialog {
    width: 100%;
    max-height: 94vh;
    border-radius: 22px 22px 0 0;
  }

  .stock-ai-head,
  .stock-ai-foot {
    padding-right: 16px;
    padding-left: 16px;
  }

  .stock-ai-commandbar {
    flex-wrap: wrap;
    padding-right: 16px;
    padding-left: 16px;
  }

  .stock-ai-profiles {
    flex: 1;
    min-width: 155px;
  }

  .stock-ai-modes {
    width: 100%;
  }

  .stock-ai-modes button {
    flex: 1;
  }

  .stock-ai-profiles button {
    flex: 1;
  }

  .stock-ai-commandbar > span {
    min-width: 0;
    flex: 1;
  }

  .stock-ai-body {
    padding: 13px 16px 16px;
  }

  .ai-leading-card {
    padding: 14px;
  }

  .ai-leading-identity h3 {
    font-size: 26px;
  }

  .ai-leading-score strong {
    font-size: 32px;
  }

  .ai-workbench {
    grid-template-columns: minmax(0, 1fr);
  }

  .ai-ranking-list button {
    grid-template-columns: 23px minmax(0, 1fr) 62px 52px;
    gap: 7px;
  }

  .ai-inspector {
    grid-row: auto;
    order: -1;
  }

  .stock-ai-foot {
    align-items: flex-start;
    flex-direction: column;
  }

  .stock-ai-foot > div {
    width: 100%;
  }

  .stock-ai-foot .btn {
    flex: 1;
  }
}

@media (max-width: 380px) {
  .ai-leading-main {
    align-items: flex-start;
    flex-direction: column;
    gap: 9px;
  }

  .ai-leading-foot {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .stock-ai-loading i,
  .spinning {
    animation: none;
  }
}
</style>
