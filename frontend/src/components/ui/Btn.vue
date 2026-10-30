<script setup>
defineProps({
  variant: { type: String, default: 'primary' }, // primary | ghost | danger | outline
  size: { type: String, default: 'md' }, // sm | md
  type: { type: String, default: 'button' },
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
});
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    class="inline-flex items-center justify-center gap-2 rounded-btn font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
    :class="[
      size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm',
      {
        'bg-accent text-white hover:brightness-110': variant === 'primary',
        'border border-border bg-bg-surface text-text-muted hover:bg-bg-elevated hover:text-text-primary':
          variant === 'outline',
        'text-text-muted hover:text-text-primary': variant === 'ghost',
        'bg-danger/15 text-danger hover:bg-danger/25': variant === 'danger',
      },
    ]"
  >
    <svg
      v-if="loading"
      class="h-3.5 w-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
    </svg>
    <slot />
  </button>
</template>
