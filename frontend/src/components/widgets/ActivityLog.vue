<script setup>
import Badge from '../ui/Badge.vue';

defineProps({
  items: { type: Array, default: () => [] },
});

const toneFor = (status) => (status === 'failed' ? 'danger' : status === 'pending' ? 'warning' : 'success');

function formatTime(value) {
  const d = new Date(value);
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <div class="divide-y divide-border rounded-card border border-border bg-bg-surface">
    <div v-for="log in items" :key="log.id || `${log.at}-${log.action}`" class="px-4 py-2.5">
      <div class="flex items-center justify-between gap-3">
        <span class="code-area truncate text-[13px] text-text-primary">{{ log.action }}</span>
        <Badge :tone="toneFor(log.status)">{{ log.status || 'success' }}</Badge>
      </div>
      <div class="mt-1 flex items-center justify-between gap-3 text-xs text-text-muted">
        <span class="truncate">{{ log.resource || '—' }}</span>
        <span class="shrink-0">{{ log.username || log.user || 'system' }} · {{ formatTime(log.at || log.createdAt) }}</span>
      </div>
    </div>

    <div v-if="items.length === 0" class="px-4 py-6 text-center text-sm text-text-muted">
      Belum ada aktivitas tercatat.
    </div>
  </div>
</template>
