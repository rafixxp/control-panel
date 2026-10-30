<script setup>
import { computed, onMounted, ref } from 'vue';
import { Cpu, HardDrive, MemoryStick, Network, RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-vue-next';
import StatCard from '../components/widgets/StatCard.vue';
import ServiceList from '../components/widgets/ServiceList.vue';
import BandwidthChart from '../components/widgets/BandwidthChart.vue';
import ActivityLog from '../components/widgets/ActivityLog.vue';
import Badge from '../components/ui/Badge.vue';
import Btn from '../components/ui/Btn.vue';
import { useSystemStore } from '../stores/system.store';

const system = useSystemStore();
const refreshing = ref(false);

const stats = computed(() => system.stats || {});
const diskTop = computed(() => stats.value.disk?.[0] || null);

const quick = computed(() => [
  { label: 'Domain', value: system.domains },
  { label: 'Database', value: system.databases },
  { label: 'Pengguna aktif', value: system.users },
]);

const sslWarnings = computed(() => system.expiringSsl || []);

async function refresh() {
  refreshing.value = true;
  await Promise.all([system.loadSummary(), system.loadBandwidth(6)]);
  refreshing.value = false;
}

onMounted(refresh);
</script>

<template>
  <div class="space-y-5">
    <!-- Baris atas: quick stats + SSL warning -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <div
        v-for="q in quick"
        :key="q.label"
        class="glass-card flex items-center justify-between rounded-card px-4 py-3"
      >
        <div>
          <div class="text-[11px] uppercase tracking-wide text-text-muted">{{ q.label }}</div>
          <div class="stat-number text-xl font-medium">{{ q.value ?? '–' }}</div>
        </div>
      </div>

      <div class="glass-card flex items-center justify-between rounded-card px-4 py-3">
        <div>
          <div class="text-[11px] uppercase tracking-wide text-text-muted">Uptime</div>
          <div class="stat-number text-xl font-medium">{{ stats.uptime || '–' }}</div>
        </div>
        <Btn variant="ghost" size="sm" :loading="refreshing" title="Muat ulang" @click="refresh">
          <RefreshCw :size="14" />
        </Btn>
      </div>
    </div>

    <div
      v-if="sslWarnings.length"
      class="flex items-start gap-3 rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning"
    >
      <ShieldAlert :size="16" class="mt-0.5 shrink-0" />
      <div>
        <span class="font-medium">Sertifikat SSL segera kedaluwarsa:</span>
        <span v-for="w in sslWarnings" :key="w.id" class="ml-1">
          {{ w.domain }} ({{ w.daysLeft }} hari)<span v-if="w !== sslWarnings[sslWarnings.length - 1]">, </span>
        </span>
      </div>
    </div>

    <!-- Statistik realtime -->
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="CPU"
        :value="stats.cpu ? `${stats.cpu.percent}%` : '–'"
        :sub="stats.cpu ? `${stats.cpu.cores} core` : ''"
        :percent="stats.cpu?.percent ?? 0"
        :tone="(stats.cpu?.percent ?? 0) > 85 ? 'danger' : 'accent'"
      >
        <template #icon><Cpu :size="15" class="text-accent" /></template>
      </StatCard>

      <StatCard
        label="RAM"
        :value="stats.ram ? `${stats.ram.percent}%` : '–'"
        :sub="stats.ram ? `${stats.ram.usedGb}/${stats.ram.totalGb} GB` : ''"
        :percent="stats.ram?.percent ?? 0"
        :tone="(stats.ram?.percent ?? 0) > 85 ? 'danger' : 'accent'"
      >
        <template #icon><MemoryStick :size="15" class="text-accent" /></template>
      </StatCard>

      <StatCard
        label="Disk"
        :value="diskTop ? `${diskTop.usePercent}%` : '–'"
        :sub="diskTop ? `${diskTop.usedGb}/${diskTop.sizeGb} GB` : ''"
        :percent="diskTop?.usePercent ?? 0"
        :tone="(diskTop?.usePercent ?? 0) > 85 ? 'danger' : 'accent'"
      >
        <template #icon><HardDrive :size="15" class="text-accent" /></template>
      </StatCard>

      <StatCard
        label="Jaringan"
        :value="stats.network ? `${stats.network.inKbps}` : '–'"
        sub="kbps in / out"
        :percent="Math.min((stats.network?.inKbps ?? 0) / 100, 100)"
        tone="success"
      >
        <template #icon><Network :size="15" class="text-success" /></template>
      </StatCard>
    </div>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <!-- Bandwidth -->
      <section class="glass-card rounded-card p-4 lg:col-span-2">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-medium">Bandwidth (6 jam terakhir)</h2>
          <Badge :tone="system.connected ? 'success' : 'muted'">
            {{ system.connected ? 'realtime' : 'offline' }}
          </Badge>
        </div>
        <BandwidthChart :points="system.bandwidth" />
      </section>

      <!-- Service status -->
      <section>
        <h2 class="mb-3 text-sm font-medium">Status Service</h2>
        <ServiceList />
      </section>
    </div>

    <!-- Disk detail + activity -->
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <section class="glass-card rounded-card p-4">
        <h2 class="mb-3 text-sm font-medium">Partisi Disk</h2>
        <div class="space-y-3">
          <div v-for="d in stats.disk || []" :key="d.mount">
            <div class="mb-1 flex items-center justify-between text-xs">
              <span class="code-area text-text-muted">{{ d.mount }}</span>
              <span class="stat-number">{{ d.usedGb }} / {{ d.sizeGb }} GB ({{ d.usePercent }}%)</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-bg-elevated">
              <div
                class="h-full rounded-full transition-all duration-500"
                :class="d.usePercent > 85 ? 'bg-danger' : d.usePercent > 70 ? 'bg-warning' : 'bg-accent'"
                :style="{ width: `${d.usePercent}%` }"
              />
            </div>
          </div>
          <p v-if="!(stats.disk || []).length" class="text-sm text-text-muted">Memuat…</p>
        </div>

        <div class="mt-4 border-t border-border pt-3 text-xs text-text-muted">
          <div class="flex justify-between py-0.5">
            <span>Load average</span>
            <span class="stat-number">{{ (stats.load || []).join(' · ') || '–' }}</span>
          </div>
        </div>
      </section>

      <section class="lg:col-span-2">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-medium">Aktivitas Terakhir</h2>
          <TriangleAlert v-if="system.error" :size="14" class="text-danger" />
        </div>
        <ActivityLog :items="system.activity" />
      </section>
    </div>
  </div>
</template>
