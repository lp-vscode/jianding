<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import AppSidebar from "./components/AppSidebar.vue";
import CompactView from "./components/CompactView.vue";
import MarketTicker from "./components/MarketTicker.vue";
import WatchlistView from "./components/WatchlistView.vue";
import HoldingsView from "./components/HoldingsView.vue";
import TradingView from "./components/TradingView.vue";
import AlertsView from "./components/AlertsView.vue";
import SettingsView from "./components/SettingsView.vue";
import SearchDialog from "./components/SearchDialog.vue";
import HoldingDialog from "./components/HoldingDialog.vue";
import AlertDialog from "./components/AlertDialog.vue";
import ToastStack from "./components/ToastStack.vue";
import {
  closeAlertDialog,
  closeHoldingDialog,
  hydrate,
  hydrateTradingLedger,
  openAlertDialog,
  refreshAll,
  setNetworkOnline,
  startPolling,
  startWindowSync,
  state,
  stopSyncingWindows,
} from "./lib/store";
import { isTauri } from "./lib/backend";

const views = {
  watchlist: WatchlistView,
  holdings: HoldingsView,
  trading: TradingView,
  alerts: AlertsView,
  settings: SettingsView,
};

const compactMode = isTauri() && getCurrentWindow().label === "compact";
const viewScroll = ref<HTMLElement | null>(null);
const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
const systemPrefersDark = ref(themeMedia.matches);
let nativeBridgeRetryTimer: number | undefined;

watchEffect(() => {
  const theme =
    state.settings.themeMode === "system"
      ? systemPrefersDark.value
        ? "dark"
        : "light"
      : state.settings.themeMode;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themeMode = state.settings.themeMode;
  document.documentElement.dataset.gainLossMode = state.settings.gainLossMode;
  document.documentElement.dataset.watchDensity = state.settings.watchlistDensity;
  const themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.removeAttribute("media");
    themeColorMeta.content = theme === "dark" ? "#0d0d0e" : "#f2f2f7";
  }
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta, index) => {
    if (index > 0) meta.remove();
  });
});

watch(
  () => state.view,
  async () => {
    await nextTick();
    if (viewScroll.value) viewScroll.value.scrollTop = 0;
  },
);

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  const typing =
    target?.tagName === "INPUT" ||
    target?.tagName === "TEXTAREA" ||
    target?.tagName === "SELECT" ||
    target?.isContentEditable;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    state.searchOpen = !state.searchOpen;
    return;
  }
  const overlayOpen = state.searchOpen || state.holdingDialog.open || state.alertDialog.open;
  if (!typing && !overlayOpen && !event.metaKey && !event.ctrlKey && !event.altKey && event.key === "/") {
    event.preventDefault();
    state.searchOpen = true;
    return;
  }
  if (!typing && !overlayOpen && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "n") {
    event.preventDefault();
    openAlertDialog(state.selectedSymbol);
    return;
  }
  if (event.key === "Escape") {
    if (state.searchOpen) state.searchOpen = false;
    else if (state.holdingDialog.open) closeHoldingDialog();
    else if (state.alertDialog.open) closeAlertDialog();
  }
}

function onOnline() {
  setNetworkOnline(true);
  void refreshAll();
}

function onOffline() {
  setNetworkOnline(false);
}

function onSystemThemeChange(event: MediaQueryListEvent) {
  systemPrefersDark.value = event.matches;
}

onMounted(() => {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  hydrate();
  void nextTick(() => {
    if (viewScroll.value) viewScroll.value.scrollTop = 0;
  });
  void startWindowSync();
  if (!compactMode) {
    void hydrateTradingLedger();
    void refreshAll();
    startPolling();
    nativeBridgeRetryTimer = window.setTimeout(() => {
      void refreshAll();
    }, 1_200);
  }
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  themeMedia.addEventListener("change", onSystemThemeChange);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("online", onOnline);
  window.removeEventListener("offline", onOffline);
  themeMedia.removeEventListener("change", onSystemThemeChange);
  if (nativeBridgeRetryTimer !== undefined) window.clearTimeout(nativeBridgeRetryTimer);
  stopSyncingWindows();
});
</script>

<template>
  <CompactView v-if="compactMode" />
  <div v-else class="app-shell">
    <AppSidebar />
    <main class="app-main">
      <MarketTicker />
      <div ref="viewScroll" class="view-scroll">
        <Transition name="view" mode="out-in">
          <component :is="views[state.view]" :key="state.view" />
        </Transition>
      </div>
    </main>

    <SearchDialog v-if="state.searchOpen" />
    <HoldingDialog v-if="state.holdingDialog.open" />
    <AlertDialog v-if="state.alertDialog.open" />
    <ToastStack />
  </div>
</template>
