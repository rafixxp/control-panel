<script setup>
import { computed, onMounted, ref } from 'vue';
import { Lock, Plus, RefreshCw, ShieldCheck, ShieldX } from 'lucide-vue-next';
import Badge from '../components/ui/Badge.vue';
import Btn from '../components/ui/Btn.vue';
import Field from '../components/ui/Field.vue';
import Modal from '../components/ui/Modal.vue';
import { useAuthStore } from '../stores/auth.store';
import { useConfirm } from '../composables/useConfirm';
import { useToast } from '../composables/useToast';
import api, { errorMessage } from '../api';

const auth = useAuthStore();
const confirm = useConfirm();
const toast = useToast();

const certs = ref([]);
const domains = ref([]);
const loading = ref(false);
const busy = ref(null);

const showIssue = ref(false);
const issueDomainId = ref(null);

const showManual = ref(false);
const manual = ref({ domainId: null, certificate: '', privateKey: '' });

const activeCount = computed(() => certs.value.filter((c) => c.status === 'active').length);
const warningCount = computed(() => certs.value.filter((c) => c.warning).length);

const canManage = computed(() => auth.canManageServer);

function tone(cert) {
  if (cert.status !== 'active') return 'warning';
  if (cert.critical) return 'danger';
  if (cert.warning) return 'warning';
  return 'success';
}

async function load() {
  loading.value = true;
  try {
    const [sslRes, domRes] = await Promise.all([api.get('/ssl'), api.get('/domains')]);
    certs.value = sslRes.data.certificates;
    domains.value = domRes.data.domains;
  } catch (err) {
    toast.error(errorMessage(err, 'Gagal memuat sertifikat SSL.'));
  } finally {
    loading.value = false;
  }
}

async function issue() {
  if (!issueDomainId.value) return;
  busy.value = 'issue';
  try {
    await api.post('/ssl/issue', { domainId: Number(issueDomainId.value) });
    toast.success('Sertifikat diterbitkan (atau masuk antrean).');
    showIssue.value = false;
    await load();
  } catch (err) {
    toast.error(errorMessage(err, 'Gagal menerbitkan sertifikat.'));
  } finally {
    busy.value = null;
  }
}

async function renew(cert) {
  busy.value = `renew-${cert.id}`;
  try {
    await api.post(`/ssl/${cert.id}/renew`);
    toast.success(`Sertifikat ${cert.domain} diperbarui.`);
    await load();
  } catch (err) {
    toast.error(errorMessage(err, 'Gagal memperbarui sertifikat.'));
  } finally {
    busy.value = null;
  }
}

async function revoke(cert) {
  const ok = await confirm({
    title: 'Cabut sertifikat?',
    message: `Sertifikat untuk ${cert.domain} akan dicabut dan dihapus dari panel.`,
    detail: cert.domain,
    confirmText: 'Cabut',
  });
  if (!ok) return;

  busy.value = `revoke-${cert.id}`;
  try {
    await api.post(`/ssl/${cert.id}/revoke`);
    toast.success('Sertifikat dicabut.');
    await load();
  } catch (err) {
    toast.error(errorMessage(err, 'Gagal mencabut sertifikat.'));
  } finally {
    busy.value = null;
  }
}

async function toggleAutoRenew(cert) {
  try {
    await api.patch(`/ssl/${cert.id}`, { autoRenew: !cert.autoRenew });
    cert.autoRenew = !cert.autoRenew;
    toast.success(`Auto-renew ${cert.autoRenew ? 'diaktifkan' : 'dinonaktifkan'}.`);
  } catch (err) {
    toast.error(errorMessage(err, 'Gagal mengubah auto-renew.'));
  }
}

async function uploadManual() {
  busy.value = 'manual';
  try {
    await api.post('/ssl/manual', {
      domainId: Number(manual.value.domainId),
      certificate: manual.value.certificate.trim(),
      privateKey: manual.value.privateKey.trim(),
    });
    toast.success('Sertifikat manual tersimpan.');
    showManual.value = false;
    manual.value = { domainId: null, certificate: '', privateKey: '' };
    await load();
  } catch (err) {
    toast.error(errorMessage(err, 'Gagal mengunggah sertifikat.'));
  } finally {
    busy.value = null;
  }
}

function daysLeftText(cert) {
  if (cert.daysLeft === null) return 'kedaluwarsa';
  return `${cert.daysLeft} hari lagi`;
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div class="glass-card rounded-card px-4 py-3">
        <div class="text-[11px] uppercase tracking-wide text-text-muted">Sertifikat aktif</div>
        <div class="stat-number text-xl font-medium">{{ activeCount }}</div>
      </div>
      <div class="glass-card rounded-card px-4 py-3">
        <div class="text-[11px] uppercase tracking-wide text-text-muted">Segera kedaluwarsa</div>
        <div class="stat-number text-xl font-medium" :class="warningCount ? 'text-warning' : ''">
          {{ warningCount }}
        </div>
      </div>
      <div class="glass-card rounded-card px-4 py-3">
        <div class="text-[11px] uppercase tracking-wide text-text-muted">Total domain</div>
        <div class="stat-number text-xl font-medium">{{ domains.length }}</div>
      </div>
    </div>

    <div v-if="canManage" class="flex flex-wrap gap-2">
      <Btn @click="showIssue = true"><Plus :size="15" /> Terbitkan SSL</Btn>
      <Btn variant="outline" @click="showManual = true"><Lock :size="15" /> Unggah Sertifikat Manual</Btn>
      <Btn variant="ghost" :loading="loading" @click="load"><RefreshCw :size="14" /> Muat ulang</Btn>
    </div>

    <div class="overflow-hidden rounded-card border border-border bg-bg-surface">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
            <th class="px-4 py-3 font-medium">Domain</th>
            <th class="px-4 py-3 font-medium">Penerbit</th>
            <th class="px-4 py-3 font-medium">Berlaku hingga</th>
            <th class="px-4 py-3 font-medium">Status</th>
            <th class="px-4 py-3 font-medium">Auto-renew</th>
            <th class="px-4 py-3 text-right font-medium">Aksi</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="cert in certs" :key="cert.id" class="transition hover:bg-bg-elevated/50">
            <td class="px-4 py-3">
              <span class="flex items-center gap-2 font-medium">
                <ShieldCheck :size="14" :class="cert.status === 'active' ? 'text-success' : 'text-warning'" />
                {{ cert.domain }}
              </span>
            </td>
            <td class="px-4 py-3 code-area text-[13px] text-text-muted">{{ cert.issuer }}</td>
            <td class="px-4 py-3 code-area text-[13px] text-text-muted">
              {{ cert.expiresAt ? new Date(cert.expiresAt).toLocaleDateString('id-ID') : '—' }}
            </td>
            <td class="px-4 py-3">
              <Badge :tone="tone(cert)">{{ cert.status }} · {{ daysLeftText(cert) }}</Badge>
            </td>
            <td class="px-4 py-3">
              <label
                v-if="canManage"
                class="inline-flex cursor-pointer items-center gap-2 text-xs text-text-muted"
                :title="cert.autoRenew ? 'Klik untuk menonaktifkan' : 'Klik untuk mengaktifkan'"
                @click.prevent="toggleAutoRenew(cert)"
              >
                <input type="checkbox" class="accent-accent" :checked="cert.autoRenew" @click.stop="toggleAutoRenew(cert)" />
                {{ cert.autoRenew ? 'on' : 'off' }}
              </label>
              <span v-else class="text-xs text-text-muted">{{ cert.autoRenew ? 'on' : 'off' }}</span>
            </td>
            <td class="px-4 py-3">
              <div class="flex justify-end gap-2" v-if="canManage">
                <Btn
                  size="sm"
                  variant="outline"
                  :loading="busy === `renew-${cert.id}`"
                  @click="renew(cert)"
                >
                  <RefreshCw :size="12" /> Perpanjang
                </Btn>
                <Btn size="sm" variant="danger" :loading="busy === `revoke-${cert.id}`" @click="revoke(cert)">
                  <ShieldX :size="12" /> Cabut
                </Btn>
              </div>
            </td>
          </tr>

          <tr v-if="!loading && certs.length === 0">
            <td colspan="6" class="px-4 py-10 text-center text-text-muted">
              Belum ada sertifikat SSL. Terbitkan untuk domain pertama Anda.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal terbitkan -->
    <Modal :open="showIssue" title="Terbitkan Sertifikat SSL" @close="showIssue = false">
      <div class="space-y-4">
        <Field label="Domain" required>
          <select v-model="issueDomainId" class="field-input">
            <option :value="null" disabled>Pilih domain…</option>
            <option v-for="d in domains" :key="d.id" :value="d.id">{{ d.name }}</option>
          </select>
        </Field>
        <p class="text-xs text-text-muted">
          Certbot akan dieksekusi di server (mode dry-run bila <code class="code-area">PANEL_DRY_RUN=1</code>).
        </p>
        <div class="flex justify-end gap-2 border-t border-border pt-3">
          <Btn variant="outline" @click="showIssue = false">Batal</Btn>
          <Btn :loading="busy === 'issue'" :disabled="!issueDomainId" @click="issue">Terbitkan</Btn>
        </div>
      </div>
    </Modal>

    <!-- Modal manual -->
    <Modal :open="showManual" title="Unggah Sertifikat Manual" wide @close="showManual = false">
      <div class="space-y-4">
        <Field label="Domain" required>
          <select v-model="manual.domainId" class="field-input">
            <option :value="null" disabled>Pilih domain…</option>
            <option v-for="d in domains" :key="d.id" :value="d.id">{{ d.name }}</option>
          </select>
        </Field>
        <Field label="Certificate (PEM)" required>
          <textarea v-model="manual.certificate" class="field-input code-area h-32" placeholder="-----BEGIN CERTIFICATE-----" />
        </Field>
        <Field label="Private key (PEM)" required>
          <textarea v-model="manual.privateKey" class="field-input code-area h-32" placeholder="-----BEGIN PRIVATE KEY-----" />
        </Field>
        <div class="flex justify-end gap-2 border-t border-border pt-3">
          <Btn variant="outline" @click="showManual = false">Batal</Btn>
          <Btn :loading="busy === 'manual'" :disabled="!manual.domainId || !manual.certificate || !manual.privateKey" @click="uploadManual">
            Simpan
          </Btn>
        </div>
      </div>
    </Modal>
  </div>
</template>
