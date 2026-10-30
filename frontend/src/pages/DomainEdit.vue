<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft, FileCode2, ShieldCheck } from 'lucide-vue-next';
import Badge from '../components/ui/Badge.vue';
import Btn from '../components/ui/Btn.vue';
import Field from '../components/ui/Field.vue';
import { useDomainStore } from '../stores/domain.store';
import { useConfirm } from '../composables/useConfirm';
import { useToast } from '../composables/useToast';
import { errorMessage } from '../api';

const props = defineProps({ id: { type: String, required: true } });

const store = useDomainStore();
const toast = useToast();
const confirm = useConfirm();
const router = useRouter();

const form = ref({ phpVersion: '8.2', gzip: true, redirectHttps: true, customDirectives: '' });
const saving = ref(false);
const showAdvanced = ref(false);
const error = ref('');

const domain = computed(() => store.current);

async function load() {
  error.value = '';
  try {
    const d = await store.fetchOne(props.id);
    form.value = {
      phpVersion: d.phpVersion,
      gzip: true,
      redirectHttps: true,
      customDirectives: '',
    };
    await store.fetchVhost(props.id);
  } catch (err) {
    error.value = errorMessage(err, 'Domain tidak ditemukan.');
  }
}

async function save() {
  saving.value = true;
  error.value = '';
  try {
    await store.update(props.id, {
      phpVersion: form.value.phpVersion,
      gzip: form.value.gzip,
      redirectHttps: form.value.redirectHttps,
      customDirectives: form.value.customDirectives,
    });
    await store.fetchVhost(props.id);
    toast.success('Konfigurasi domain disimpan.');
  } catch (err) {
    error.value = errorMessage(err, 'Gagal menyimpan perubahan.');
  } finally {
    saving.value = false;
  }
}

async function remove() {
  const ok = await confirm({
    title: 'Hapus domain?',
    message: `VHost Nginx untuk ${domain.value?.name} akan dihapus permanen.`,
    detail: domain.value?.documentRoot,
    confirmText: 'Hapus permanen',
  });
  if (!ok) return;

  try {
    await store.remove(props.id);
    toast.success('Domain dihapus.');
    router.push({ name: 'domains' });
  } catch (err) {
    toast.error(errorMessage(err, 'Gagal menghapus domain.'));
  }
}

watch(
  () => props.id,
  () => load(),
);

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <button
        class="inline-flex items-center gap-1.5 text-sm text-text-muted transition hover:text-text-primary"
        @click="router.push({ name: 'domains' })"
      >
        <ArrowLeft :size="15" /> Kembali ke daftar domain
      </button>
    </div>

    <div v-if="error && !domain" class="rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
      {{ error }}
    </div>

    <template v-if="domain">
      <div class="glass-card flex flex-wrap items-center justify-between gap-3 rounded-card px-4 py-3">
        <div class="flex items-center gap-3">
          <span class="text-lg font-medium">{{ domain.name }}</span>
          <Badge :tone="domain.isSuspended ? 'danger' : 'success'" dot>
            {{ domain.isSuspended ? 'suspended' : 'active' }}
          </Badge>
          <Badge v-if="domain.ssl" :tone="domain.ssl.status === 'active' ? 'success' : 'warning'">
            SSL · {{ domain.ssl.daysLeft }} hari
          </Badge>
        </div>
        <div class="flex gap-2">
          <router-link :to="{ name: 'ssl' }">
            <Btn variant="outline" size="sm"><ShieldCheck :size="13" /> Kelola SSL</Btn>
          </router-link>
          <Btn variant="danger" size="sm" @click="remove">Hapus Domain</Btn>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <!-- Pengaturan -->
        <section class="space-y-4 rounded-card border border-border bg-bg-surface p-4">
          <h2 class="text-sm font-medium">Pengaturan Konfigurasi</h2>

          <Field label="Document root">
            <input class="field-input code-area" :value="domain.documentRoot" readonly />
          </Field>

          <Field label="Versi PHP">
            <select v-model="form.phpVersion" class="field-input">
              <option v-for="v in ['7.4', '8.1', '8.2', '8.3']" :key="v" :value="v">PHP {{ v }}</option>
            </select>
          </Field>

          <div class="space-y-2 text-sm text-text-muted">
            <label class="flex cursor-pointer items-center gap-2">
              <input v-model="form.gzip" type="checkbox" class="accent-accent" />
              Aktifkan gzip
            </label>
            <label class="flex cursor-pointer items-center gap-2">
              <input v-model="form.redirectHttps" type="checkbox" class="accent-accent" />
              Redirect HTTP → HTTPS
            </label>
          </div>

          <div>
            <button
              class="text-xs font-medium text-accent hover:underline"
              @click="showAdvanced = !showAdvanced"
            >
              {{ showAdvanced ? 'Sembunyikan' : 'Tampilkan' }} direktif Nginx tambahan
            </button>
            <textarea
              v-if="showAdvanced"
              v-model="form.customDirectives"
              class="field-input code-area mt-2 h-28 resize-y"
              placeholder="client_max_body_size 64m;&#10;add_header X-Frame-Options SAMEORIGIN;"
            />
          </div>

          <p v-if="error" class="rounded-btn border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {{ error }}
          </p>

          <div class="flex justify-end gap-2 border-t border-border pt-3">
            <Btn variant="outline" :disabled="saving" @click="load">Reset</Btn>
            <Btn :loading="saving" @click="save">Simpan Perubahan</Btn>
          </div>
        </section>

        <!-- Preview vHost -->
        <section class="rounded-card border border-border bg-bg-surface p-4">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="flex items-center gap-2 text-sm font-medium">
              <FileCode2 :size="15" class="text-text-muted" /> Preview vHost
            </h2>
            <Badge tone="muted">nginx.conf.d/{{ domain.name }}.conf</Badge>
          </div>
          <pre
            class="code-area max-h-[420px] overflow-auto rounded-btn border border-border bg-bg-base p-3 text-[12px] leading-relaxed text-text-muted"
            >{{ store.vhost || 'File vHost tidak tersedia (belum dibuat atau mode dry-run).' }}</pre
          >
        </section>
      </div>
    </template>
  </div>
</template>
