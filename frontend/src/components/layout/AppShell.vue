<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Activity,
  FolderOpen,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  X,
} from 'lucide-vue-next';
import { useAuthStore } from '../../stores/auth.store';
import { useSystemStore } from '../../stores/system.store';
import { useToast } from '../../composables/useToast';

const auth = useAuthStore();
const system = useSystemStore();
const route = useRoute();
const router = useRouter();
const toast = useToast();

const mobileOpen = ref(false);

const nav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/domains', label: 'Domains', icon: Globe },
  { to: '/ssl', label: 'SSL', icon: ShieldCheck },
  { to: '/files', label: 'File Manager', icon: FolderOpen },
];

const pageTitle = computed(() => {
  const match = nav.find((n) => route.path.startsWith(n.to));
  return match?.label || 'NodePanel';
});

const isActive = (to) => route.path === to || route.path.startsWith(`${to}/`);

onMounted(() => {
  system.loadSummary();
  system.loadBandwidth(6);
  system.connect(auth.token);
});

onUnmounted(() => system.disconnect());

async function logout() {
  await auth.logout();
  system.disconnect();
  toast.info('Sesi Anda telah berakhir.');
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="flex h-full bg-bg-base text-text-primary">
    <!-- Sidebar -->
    <aside
      class="fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-bg-surface transition-transform lg:static lg:translate-x-0"
      :class="mobileOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <div class="flex h-14 items-center justify-between border-b border-border px-4">
        <div class="flex items-center gap-2">
          <span class="flex h-7 w-7 items-center justify-center rounded-btn bg-accent text-sm font-semibold text-white">N</span>
          <span class="text-[15px] font-semibold tracking-tight">NodePanel</span>
        </div>
        <button class="p-1 text-text-muted lg:hidden" @click="mobileOpen = false" aria-label="Tutup menu">
          <X :size="18" />
        </button>
      </div>

      <nav class="flex-1 space-y-1 p-3">
        <router-link
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 rounded-btn px-3 py-2 text-sm transition"
          :class="
            isActive(item.to)
              ? 'bg-accent/12 text-accent'
              : 'text-text-muted hover:bg-bg-elevated hover:text-text-primary'
          "
          @click="mobileOpen = false"
        >
          <component :is="item.icon" :size="17" />
          {{ item.label }}
        </router-link>
      </nav>

      <div class="border-t border-border p-3">
        <div class="flex items-center gap-2 px-2 py-1 text-xs text-text-muted">
          <span
            class="status-dot"
            :class="system.connected ? 'status-dot-running' : 'status-dot-unknown'"
          />
          {{ system.connected ? 'Realtime terhubung' : 'Realtime terputus' }}
        </div>
      </div>
    </aside>

    <div v-if="mobileOpen" class="fixed inset-0 z-30 bg-black/50 lg:hidden" @click="mobileOpen = false" />

    <!-- Konten -->
    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-14 items-center justify-between border-b border-border bg-bg-surface/70 px-4 backdrop-blur">
        <div class="flex items-center gap-3">
          <button class="p-1 text-text-muted lg:hidden" @click="mobileOpen = true" aria-label="Buka menu">
            <Menu :size="18" />
          </button>
          <h1 class="text-[15px] font-medium">{{ pageTitle }}</h1>
          <Activity v-if="system.connected" :size="14" class="text-success" />
        </div>

        <div class="flex items-center gap-3">
          <div class="hidden text-right sm:block">
            <div class="text-[13px] font-medium leading-tight">{{ auth.user?.name || auth.user?.username }}</div>
            <div class="text-[11px] uppercase tracking-wide text-text-muted">{{ auth.user?.role }}</div>
          </div>
          <button
            class="flex h-8 w-8 items-center justify-center rounded-btn border border-border bg-bg-elevated text-sm font-medium text-text-muted transition hover:text-text-primary"
            title="Keluar"
            @click="logout"
          >
            <LogOut :size="15" />
          </button>
        </div>
      </header>

      <main class="flex-1 overflow-y-auto p-4 lg:p-6">
        <slot />
      </main>
    </div>
  </div>
</template>
