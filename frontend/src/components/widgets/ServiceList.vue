<script setup>
import { Pause, Play, RotateCcw } from 'lucide-vue-next';
import Badge from '../ui/Badge.vue';
import Btn from '../ui/Btn.vue';
import { useAuthStore } from '../../stores/auth.store';
import { useSystemStore } from '../../stores/system.store';
import { useToast } from '../../composables/useToast';

const auth = useAuthStore();
const system = useSystemStore();
const toast = useToast();

const toneFor = (status) => (status === 'running' ? 'success' : status === 'stopped' ? 'danger' : 'muted');

async function act(key, action) {
  try {
    const result = await system.controlService(key, action);
    if (result?.status === 'dry-run') toast.info(`${key}: ${action} dilewati (mode dry-run).`);
    else toast.success(`${key}: ${action} berhasil.`);
  } catch (err) {
    toast.error(err?.response?.data?.message || `Gagal ${action} ${key}.`);
  }
}
</script>

<template>
  <div class="divide-y divide-border rounded-card border border-border bg-bg-surface">
    <div
      v-for="svc in system.services"
      :key="svc.key"
      class="flex items-center justify-between gap-3 px-4 py-3"
    >
      <div class="flex min-w-0 items-center gap-3">
        <span class="status-dot" :class="`status-dot-${svc.status === 'running' ? 'running' : svc.status === 'stopped' ? 'stopped' : 'unknown'}`" />
        <div class="min-w-0">
          <div class="truncate text-sm font-medium">{{ svc.label }}</div>
          <div class="code-area truncate text-[11px] text-text-muted">{{ svc.unit }}</div>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <Badge :tone="toneFor(svc.status)">{{ svc.status }}</Badge>

        <div v-if="auth.canManageServer" class="flex items-center gap-1">
          <Btn size="sm" variant="outline" :disabled="svc.status === 'running'" title="Start" @click="act(svc.key, 'start')">
            <Play :size="12" />
          </Btn>
          <Btn size="sm" variant="outline" :disabled="svc.status === 'stopped'" title="Stop" @click="act(svc.key, 'stop')">
            <Pause :size="12" />
          </Btn>
          <Btn size="sm" variant="outline" title="Restart" @click="act(svc.key, 'restart')">
            <RotateCcw :size="12" />
          </Btn>
        </div>
      </div>
    </div>

    <div v-if="system.services.length === 0" class="px-4 py-6 text-center text-sm text-text-muted">
      Memuat status service…
    </div>
  </div>
</template>
