<script setup lang="ts">
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-vue-next";
import { dismissToast, state } from "../lib/store";
</script>

<template>
  <div class="toast-stack" role="status" aria-live="polite">
    <TransitionGroup name="fade-slide">
      <div v-for="toast in state.toasts" :key="toast.id" class="toast" :class="toast.tone">
        <CheckCircle2 v-if="toast.tone === 'success'" class="toast-icon" :size="15" />
        <AlertTriangle v-else-if="toast.tone === 'error'" class="toast-icon" :size="15" />
        <Info v-else class="toast-icon" :size="15" />
        <span>{{ toast.message }}</span>
        <button type="button" aria-label="关闭提示" @click="dismissToast(toast.id)">
          <X :size="12" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
