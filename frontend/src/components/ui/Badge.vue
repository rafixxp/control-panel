<script setup>
defineProps({
  tone: { type: String, default: 'muted' }, // accent | success | warning | danger | muted
  dot: { type: Boolean, default: false },
});
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-badge border px-2 py-0.5 text-[11px] font-medium capitalize"
    :class="{
      'border-accent/30 bg-accent/10 text-accent': tone === 'accent',
      'border-success/30 bg-success/10 text-success': tone === 'success',
      'border-warning/30 bg-warning/10 text-warning': tone === 'warning',
      'border-danger/30 bg-danger/10 text-danger': tone === 'danger',
      'border-border bg-bg-elevated text-text-muted': tone === 'muted',
    }"
  >
    <span v-if="dot" class="status-dot" :class="`status-dot-${tone === 'success' ? 'running' : tone === 'danger' ? 'stopped' : 'unknown'}`" />
    <slot />
  </span>
</template>
