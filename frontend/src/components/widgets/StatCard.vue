<script setup>
defineProps({
  label: { type: String, default: '' },
  value: { type: [String, Number], default: '' },
  sub: { type: String, default: '' },
  percent: { type: Number, default: null }, // 0..100 untuk bar progres opsional
  tone: { type: String, default: 'accent' }, // accent | success | warning | danger
});
</script>

<template>
  <div class="glass-card rounded-card p-4">
    <div class="flex items-center justify-between">
      <span class="text-xs font-medium uppercase tracking-wide text-text-muted">{{ label }}</span>
      <slot name="icon" />
    </div>

    <div class="mt-2 flex items-baseline gap-2">
      <span class="stat-number text-2xl font-medium">{{ value }}</span>
      <span v-if="sub" class="text-xs text-text-muted">{{ sub }}</span>
    </div>

    <div v-if="percent !== null" class="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
      <div
        class="h-full rounded-full transition-all duration-500"
        :class="{
          'bg-accent': tone === 'accent',
          'bg-success': tone === 'success',
          'bg-warning': tone === 'warning',
          'bg-danger': tone === 'danger',
        }"
        :style="{ width: `${Math.min(Math.max(percent, 0), 100)}%` }"
      />
    </div>
  </div>
</template>
