<script setup>
import { X } from 'lucide-vue-next';
import { confirmState, settleConfirm } from '../../composables/useConfirm';

function onKeydown(e) {
  if (e.key === 'Escape') settleConfirm(false);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="confirmState.open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      @keydown="onKeydown"
      tabindex="-1"
    >
      <div
        class="w-full max-w-md rounded-card border border-border bg-bg-surface shadow-2xl"
        role="alertdialog"
        aria-modal="true"
      >
        <div class="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <h3 class="text-[15px] font-medium text-text-primary">{{ confirmState.title }}</h3>
          <button
            class="rounded-btn p-1 text-text-muted transition hover:bg-bg-elevated hover:text-text-primary"
            @click="settleConfirm(false)"
            aria-label="Tutup"
          >
            <X :size="16" />
          </button>
        </div>

        <div class="px-5 py-4">
          <p v-if="confirmState.message" class="text-sm leading-relaxed text-text-muted">
            {{ confirmState.message }}
          </p>
          <p
            v-if="confirmState.detail"
            class="code-area mt-3 rounded-btn border border-border bg-bg-base px-3 py-2 text-[13px] break-all text-danger"
          >
            {{ confirmState.detail }}
          </p>
        </div>

        <div class="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            class="rounded-btn border border-border px-3 py-1.5 text-sm text-text-muted transition hover:bg-bg-elevated hover:text-text-primary"
            @click="settleConfirm(false)"
          >
            {{ confirmState.cancelText }}
          </button>
          <button
            class="rounded-btn px-3 py-1.5 text-sm font-medium transition"
            :class="
              confirmState.danger
                ? 'bg-danger/15 text-danger hover:bg-danger/25'
                : 'bg-accent text-white hover:brightness-110'
            "
            @click="settleConfirm(true)"
          >
            {{ confirmState.confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
