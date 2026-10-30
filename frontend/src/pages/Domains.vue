<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Globe, Plus, Search } from 'lucide-vue-next';
import Badge from '../components/ui/Badge.vue';
import Btn from '../components/ui/Btn.vue';
import Field from '../components/ui/Field.vue';
import Modal from '../components/ui/Modal.vue';
import { useDomainStore } from '../stores/domain.store';
import { useConfirm } from '../composables/useConfirm';
import { useToast } from '../composables/useToast';
import { errorMessage } from '../api';

const store = useDomainStore();
const confirm = useConfirm();
const toast = useToast();
const router = useRouter();

const search = ref('');
const showCreate = ref(false);
const form = ref({ name: '', phpVersion: '8.2', enableHttps: false, redirectHttps: true, gzip: true });
const formError = ref('');

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return q ? store.items.filter((d) => d.name.includes(q)) : store.items;
});

function sslTone(domain) {
  if (!domain.ssl || domain.ssl.status !== 'active') return 'muted';
  if (domain.ssl.daysLeft <= 14) return 'danger';
  if (domain.ssl.daysLeft <= 30) return 'warning';
  return 'success';
}

async function createDomain() {
  formError.value = '';
  try {
    const domain = await store.create({ ...form.value, name: form.value.name.trim().toLowerCase() });
    showCreate.value = false;
    form.value = { name: '', phpVersion: '8.2', enableHttps: false, redirectHttps: true, gzip: true };
    toast.success(`Domain ${domain.name} dibuat.`);
    router.push({ name: 'domain-edit', params: { id: domain.id } });
  } catch (err) {
    formError.value = errorMessage(err, 'Gagal membuat domain.');
  }
}

async function toggleSuspend(domain) {
  const next = !domain.isSuspended;
  const ok = await confirm({
    title: next ? 'Tangguhkan domain?' : 'Aktifkan kembali domain?',
    message: next
      ? `Konfigurasi Nginx untuk ${domain.name} akan dinonaktifkan sementara.`
      : `Konfigurasi Nginx untuk ${domain.name} akan diaktifkan kembali.`,
    confirmText: next ? 'Tangguhkan' : 'Aktifkan',
    danger: next,
  });
  if (!ok) return;

  try {
    await store.update(domain.id, { isSuspended: next });
    toast.success(next ? 'Domain ditangguhkan.' : 'Domain diaktifkan.');
  } catch (err) {
    toast.error(errorMessage(err, 'Gagal mengubah status domain.'));
  }
}

async function removeDomain(domain) {
  const ok = await confirm({
    title: 'Hapus domain?',
    message: `VHost Nginx untuk ${domain.name} akan dihapus permanen.`,
    detail: domain.documentRoot,
    confirmText: 'Hapus permanen',
  });
  if (!ok) return;

  try {
    await store.remove(domain.id);
    toast.success('Domain dihapus.');
  } catch (err) {
    toast.error(errorMessage(err, 'Gagal menghapus domain.'));
  }
}

onMounted(store.load);
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="relative w-full max-w-xs">
        <Search :size="15" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input v-model="search" class="field-input !pl-9" placeholder="Cari domain…" />
      </div>
      <Btn @click="showCreate = true">
        <Plus :size="15" /> Tambah Domain
      </Btn>
    </div>

    <div class="overflow-hidden rounded-card border border-border bg-bg-surface">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
            <th class="px-4 py-3 font-medium">Domain</th>
            <th class="px-4 py-3 font-medium">PHP</th>
            <th class="px-4 py-3 font-medium">SSL</th>
            <th class="px-4 py-3 font-medium">Status</th>
            <th class="px-4 py-3 text-right font-medium">Aksi</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="d in filtered" :key="d.id" class="transition hover:bg-bg-elevated/50">
            <td class="px-4 py-3">
              <router-link :to="{ name: 'domain-edit', params: { id: d.id } }" class="flex items-center gap-2 font-medium hover:text-accent">
                <Globe :size="14" class="text-text-muted" />
                {{ d.name }}
              </router-link>
              <div class="code-area mt-0.5 truncate text-[11px] text-text-muted">{{ d.documentRoot }}</div>
            </td>
            <td class="px-4 py-3 code-area text-[13px] text-text-muted">{{ d.phpVersion }}</td>
            <td class="px-4 py-3">
              <Badge :tone="sslTone(d)">
                {{ d.ssl && d.ssl.status === 'active' ? `${d.ssl.daysLeft} hari` : 'tanpa SSL' }}
              </Badge>
            </td>
            <td class="px-4 py-3">
              <Badge :tone="d.isSuspended ? 'danger' : 'success'" dot>
                {{ d.isSuspended ? 'suspended' : 'active' }}
              </Badge>
            </td>
            <td class="px-4 py-3">
              <div class="flex justify-end gap-2">
                <Btn size="sm" variant="outline" @click="router.push({ name: 'domain-edit', params: { id: d.id } })">
                  Kelola
                </Btn>
                <Btn size="sm" :variant="d.isSuspended ? 'outline' : 'ghost'" @click="toggleSuspend(d)">
                  {{ d.isSuspended ? 'Aktifkan' : 'Tangguhkan' }}
                </Btn>
                <Btn size="sm" variant="danger" @click="removeDomain(d)">Hapus</Btn>
              </div>
            </td>
          </tr>

          <tr v-if="!store.loading && filtered.length === 0">
            <td colspan="5" class="px-4 py-10 text-center text-text-muted">
              {{ store.error || (search ? 'Domain tidak cocok dengan pencarian.' : 'Belum ada domain. Klik “Tambah Domain”.') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal tambah domain -->
    <Modal :open="showCreate" title="Tambah Domain" @close="showCreate = false">
      <form class="space-y-4" @submit.prevent="createDomain">
        <Field label="Nama domain" required hint="contoh: example.com">
          <input v-model="form.name" class="field-input" placeholder="example.com" required minlength="3" />
        </Field>

        <Field label="Versi PHP">
          <select v-model="form.phpVersion" class="field-input">
            <option v-for="v in ['7.4', '8.1', '8.2', '8.3']" :key="v" :value="v">PHP {{ v }}</option>
          </select>
        </Field>

        <div class="space-y-2 text-sm text-text-muted">
          <label class="flex cursor-pointer items-center gap-2">
            <input v-model="form.enableHttps" type="checkbox" class="accent-accent" />
            Terbitkan SSL Let's Encrypt saat dibuat
          </label>
          <label class="flex cursor-pointer items-center gap-2">
            <input v-model="form.redirectHttps" type="checkbox" class="accent-accent" />
            Redirect HTTP → HTTPS
          </label>
          <label class="flex cursor-pointer items-center gap-2">
            <input v-model="form.gzip" type="checkbox" class="accent-accent" />
            Aktifkan gzip
          </label>
        </div>

        <p v-if="formError" class="rounded-btn border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {{ formError }}
        </p>

        <div class="flex justify-end gap-2 border-t border-border pt-3">
          <Btn variant="outline" type="button" @click="showCreate = false">Batal</Btn>
          <Btn type="submit" :loading="store.saving">Buat Domain</Btn>
        </div>
      </form>
    </Modal>
  </div>
</template>
