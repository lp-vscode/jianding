<script setup lang="ts">
import { computed } from "vue";
import { Eye, EyeOff } from "lucide-vue-next";
import { state, updateSettings } from "../lib/store";

const hidden = computed(() => state.settings.hidePositionValues);
const actionLabel = computed(() =>
  hidden.value ? "显示持仓数量和金额" : "隐藏持仓数量和金额",
);

function togglePositionValues() {
  updateSettings({ hidePositionValues: !hidden.value });
}
</script>

<template>
  <button
    class="btn btn-small btn-ghost position-value-toggle"
    type="button"
    :aria-label="actionLabel"
    :aria-pressed="hidden"
    :title="actionLabel"
    @click="togglePositionValues"
  >
    <EyeOff v-if="hidden" :size="13" aria-hidden="true" />
    <Eye v-else :size="13" aria-hidden="true" />
    <span>
      {{ hidden ? "显示" : "隐藏" }}<span class="position-value-toggle-suffix">数值</span>
    </span>
  </button>
</template>
