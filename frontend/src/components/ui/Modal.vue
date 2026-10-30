<script setup>
import { X } from 'lucide-vue-next';

defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  wide: { type: Boolean, default: false },
});
const emit = defineEmits(['close']);
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh] backdrop-blur-sm"
        @click.self="emit('close')"
      >
        <div
          class="w-full rounded-card border border-border bg-bg-surface shadow-2xl"
          :class="wide ? 'max-w-3xl' : 'max-w-lg'"
          role="dialog"
          aria-modal="true"
        >
          <div class="flex items-center justify-between border-b border-border px-5 py-3.5">
            <h3 class="text-[15px] font-medium text-text-primary">{{ title }}</h3>
            <button
              class="rounded-btn p-1 text-text-muted transition hover:bg-bg-elevated hover:text-text-primary"
              @click="emit('close')"
              aria-label="Tutup"
            >
              <X :size="16" />
            </button>
          </div>
          <div class="px-5 py-4">
            <slot />
          </div>
          <div v-if="$slots.footer" class="flex justify-end gap-2 border-t border-border px-5 py-3">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
