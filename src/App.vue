<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import AppSidebar from "./components/AppSidebar.vue";
import CompactView from "./components/CompactView.vue";
import MarketTicker from "./components/MarketTicker.vue";
import WatchlistView from "./components/WatchlistView.vue";
import HoldingsView from "./components/HoldingsView.vue";
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
  refreshAll,
  startPolling,
  startWindowSync,
  state,
  stopSyncingWindows,
} from "./lib/store";
import { isTauri } from "./lib/backend";

const views = {
  watchlist: WatchlistView,
  holdings: HoldingsView,
  alerts: AlertsView,
  settings: SettingsView,
};

const compactMode = isTauri() && getCurrentWindow().label === "compact";

function onKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    state.searchOpen = !state.searchOpen;
    return;
  }
  if (event.key === "Escape") {
    if (state.searchOpen) state.searchOpen = false;
    else if (state.holdingDialog.open) closeHoldingDialog();
    else if (state.alertDialog.open) closeAlertDialog();
  }
}

onMounted(() => {
  hydrate();
  void startWindowSync();
  void refreshAll();
  startPolling();
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  stopSyncingWindows();
});
</script>

<template>
  <CompactView v-if="compactMode" />
  <div v-else class="app-shell">
    <AppSidebar />
    <main class="app-main">
      <MarketTicker />
      <div class="view-scroll">
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
