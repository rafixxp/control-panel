<script setup>
import { computed, onMounted, ref } from 'vue';
import {
  ChevronRight,
  Download,
  File as FileIcon,
  Folder,
  FolderPlus,
  Home,
  Pencil,
  PenLine,
  Search,
  Trash2,
  Upload,
} from 'lucide-vue-next';
import Badge from '../components/ui/Badge.vue';
import Btn from '../components/ui/Btn.vue';
import Field from '../components/ui/Field.vue';
import Modal from '../components/ui/Modal.vue';
import { useConfirm } from '../composables/useConfirm';
import { useToast } from '../composables/useToast';
import api, { errorMessage } from '../api';

const confirm = useConfirm();
const toast = useToast();

const roots = ref([]);
const maxUploadMb = ref(100);
const cwd = ref('');
const parent = ref('');
const items = ref([]);
const showHidden = ref(false);
const query = ref('');
const loading = ref(false);
const error = ref('');

const showMkdir = ref(false);
const newFolderName = ref('');

const editor = ref({ open: false, path: '', content: '', saving: false });
const uploadInput = ref(null);
const uploading = ref(false);

const breadcrumbs = computed(() => {
  if (!cwd.value) return [];
  const parts = cwd.value.split('/').filter(Boolean);
  return parts.map((part, index) => ({
    label: part,
    path: `/${parts.slice(0, index + 1).join('/')}`,
  }));
});

function fmtSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function fmtDate(value) {
  return new Date(value).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function load(path = cwd.value) {
  loading.value = true;
  error.value = '';
  try {
    const { data } = await api.get('/files/list', { params: { path, showHidden: showHidden.value } });
    cwd.value = data.path;
    parent.value = data.parent;
    items.value = data.items;
  } catch (err) {
    error.value = errorMessage(err, 'Gagal membaca direktori.');
  } finally {
    loading.value = false;
  }
}

async function loadRoots() {
  try {
    const { data } = await api.get('/files/roots');
    roots.value = data.roots;
    maxUploadMb.value = data.maxUploadMb;
    if (!cwd.value && roots.value.length) await load(roots.value[0]);
  } catch (err) {
    error.value = errorMessage(err, 'Gagal memuat root direktori.');
  }
}

function goTo(path) {
  query.value = '';
  load(path);
}

function goUp() {
  if (parent.value && parent.value !== cwd.value) goTo(parent.value);
}

async function searchNow() {
  if (!query.value.trim()) return load();
  loading.value = true;
  try {
    const { data } = await api.get('/files/search', {
      params: { path: cwd.value, q: query.value.trim(), recursive: true },
    });
    items.value = data.results;
  } catch (err) {
    toast.error(errorMessage(err, 'Pencarian gagal.'));
  } finally {
    loading.value = false;
  }
}

async function mkdir() {
  try {
    const { data } = await api.post('/files/mkdir', { path: cwd.value, name: newFolderName.value.trim() });
    showMkdir.value = false;
    newFolderName.value = '';
    toast.success('Folder dibuat.');
    await load(data.path.split('/').slice(0, -1).join('/') || cwd.value);
  } catch (err) {
    toast.error(errorMessage(err, 'Gagal membuat folder.'));
  }
}

async function renameItem(item) {
  const next = window.prompt('Nama baru:', item.name);
  if (!next || next === item.name) return;
  try {
    await api.post('/files/rename', { path: item.path, name: next.trim() });
    toast.success('Nama diubah.');
    await load();
  } catch (err) {
    toast.error(errorMessage(err, 'Gagal mengganti nama.'));
  }
}

async function removeItem(item) {
  const ok = await confirm({
    title: item.type === 'dir' ? 'Hapus folder?' : 'Hapus file?',
    message:
      item.type === 'dir'
        ? 'Seluruh isi folder ini ikut terhapus permanen. Tindakan tidak bisa dibatalkan.'
        : 'File ini akan dihapus permanen.',
    detail: item.path,
    confirmText: 'Hapus permanen',
  });
  if (!ok) return;

  try {
    await api.delete('/files', { params: { path: item.path } });
    toast.success('Dihapus.');
    await load();
  } catch (err) {
    toast.error(errorMessage(err, 'Gagal menghapus.'));
  }
}

async function openEditor(item) {
  try {
    const { data } = await api.get('/files/read', { params: { path: item.path } });
    if (!data.editable) {
      toast.warning('Jenis file ini tidak bisa diedit.');
      return;
    }
    editor.value = { open: true, path: data.path, content: data.content, saving: false };
  } catch (err) {
    toast.error(errorMessage(err, 'Gagal membuka file.'));
  }
}

async function saveFile() {
  editor.value.saving = true;
  try {
    await api.put('/files/write', { path: editor.value.path, content: editor.value.content });
    toast.success('File tersimpan.');
    editor.value.open = false;
    await load();
  } catch (err) {
    toast.error(errorMessage(err, 'Gagal menyimpan file.'));
  } finally {
    editor.value.saving = false;
  }
}

async function download(item) {
  try {
    const res = await api.get('/files/download', { params: { path: item.path }, responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.name;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    toast.error(errorMessage(err, 'Gagal mengunduh file.'));
  }
}

async function onUpload(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  uploading.value = true;
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  try {
    const { data } = await api.post(`/files/upload?path=${encodeURIComponent(cwd.value)}`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    if (data.ok) toast.success(`${data.uploaded.length} file terunggah.`);
    (data.errors || []).forEach((e) => toast.error(`${e.name}: ${e.error}`));
    await load();
  } catch (err) {
    toast.error(errorMessage(err, 'Gagal mengunggah.'));
  } finally {
    uploading.value = false;
    event.target.value = '';
  }
}

const visibleItems = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return items.value;
  return items.value.filter((i) => i.name.toLowerCase().includes(q));
});

onMounted(loadRoots);
</script>

<template>
  <div class="space-y-4">
    <!-- Toolbar -->
    <div class="glass-card flex flex-wrap items-center gap-2 rounded-card px-3 py-2.5">
      <Btn variant="outline" size="sm" :disabled="!parent || parent === cwd" @click="goUp">Naik</Btn>

      <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm">
        <button class="shrink-0 text-text-muted transition hover:text-accent" title="Root" @click="load(roots[0])">
          <Home :size="14" />
        </button>
        <template v-for="(crumb, i) in breadcrumbs" :key="crumb.path">
          <ChevronRight :size="13" class="shrink-0 text-text-muted/60" />
          <button
            class="shrink-0 truncate transition hover:text-accent"
            :class="i === breadcrumbs.length - 1 ? 'text-text-primary' : 'text-text-muted'"
            @click="goTo(crumb.path)"
          >
            {{ crumb.label }}
          </button>
        </template>
      </div>

      <div class="relative w-full max-w-[180px]">
        <Search :size="14" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          v-model="query"
          class="field-input !py-1 !pl-8 !text-xs"
          placeholder="Cari…"
          @keyup.enter="searchNow"
        />
      </div>

      <label class="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted" title="Tampilkan file tersembunyi">
        <input v-model="showHidden" type="checkbox" class="accent-accent" @change="load()" />
        .dotfile
      </label>

      <Btn size="sm" variant="outline" @click="showMkdir = true"><FolderPlus :size="13" /> Folder</Btn>
      <Btn size="sm" :loading="uploading" @click="uploadInput?.click()"><Upload :size="13" /> Unggah</Btn>
      <input ref="uploadInput" type="file" multiple class="hidden" @change="onUpload" />
    </div>

    <p v-if="error" class="rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
      {{ error }}
    </p>

    <!-- Tabel file -->
    <div class="overflow-hidden rounded-card border border-border bg-bg-surface">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
            <th class="px-4 py-3 font-medium">Nama</th>
            <th class="px-4 py-3 font-medium">Ukuran</th>
            <th class="px-4 py-3 font-medium">Diubah</th>
            <th class="px-4 py-3 text-right font-medium">Aksi</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr
            v-for="item in visibleItems"
            :key="item.path"
            class="group transition hover:bg-bg-elevated/50"
            @dblclick="item.type === 'dir' ? goTo(item.path) : openEditor(item)"
          >
            <td class="px-4 py-2.5">
              <button
                class="flex max-w-full items-center gap-2 text-left transition hover:text-accent"
                @click="item.type === 'dir' ? goTo(item.path) : openEditor(item)"
              >
                <Folder v-if="item.type === 'dir'" :size="15" class="shrink-0 text-accent/70" />
                <FileIcon v-else :size="15" class="shrink-0 text-text-muted" />
                <span class="truncate" :class="item.hidden ? 'text-text-muted' : ''">{{ item.name }}</span>
                <Badge v-if="item.type === 'link'" tone="warning">link</Badge>
              </button>
            </td>
            <td class="px-4 py-2.5 code-area text-[13px] text-text-muted">
              {{ item.type === 'dir' || item.size == null ? '—' : fmtSize(item.size) }}
            </td>
            <td class="px-4 py-2.5 code-area text-[13px] text-text-muted">
              {{ item.modifiedAt ? fmtDate(item.modifiedAt) : '—' }}
            </td>
            <td class="px-4 py-2.5">
              <div class="flex justify-end gap-1 opacity-60 transition group-hover:opacity-100">
                <Btn v-if="item.type !== 'dir'" size="sm" variant="ghost" title="Edit" @click="openEditor(item)">
                  <Pencil :size="13" />
                </Btn>
                <Btn v-if="item.type !== 'dir'" size="sm" variant="ghost" title="Unduh" @click="download(item)">
                  <Download :size="13" />
                </Btn>
                <Btn size="sm" variant="ghost" title="Ganti nama" @click="renameItem(item)">
                  <PenLine :size="13" />
                </Btn>
                <Btn size="sm" variant="ghost" title="Hapus" class="hover:text-danger" @click="removeItem(item)">
                  <Trash2 :size="13" />
                </Btn>
              </div>
            </td>
          </tr>

          <tr v-if="!loading && visibleItems.length === 0">
            <td colspan="4" class="px-4 py-10 text-center text-text-muted">
              {{ loading ? 'Memuat…' : 'Direktori kosong.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="text-xs text-text-muted">
      Root yang diizinkan:
      <span v-for="r in roots" :key="r" class="code-area mr-2 text-text-primary">{{ r }}</span>
      · Maksimal unggahan {{ maxUploadMb }} MB per file.
    </p>

    <!-- Modal folder baru -->
    <Modal :open="showMkdir" title="Folder Baru" @close="showMkdir = false">
      <form class="space-y-4" @submit.prevent="mkdir">
        <Field label="Nama folder" required>
          <input v-model="newFolderName" class="field-input" placeholder="assets" required />
        </Field>
        <div class="flex justify-end gap-2 border-t border-border pt-3">
          <Btn variant="outline" type="button" @click="showMkdir = false">Batal</Btn>
          <Btn type="submit" :disabled="!newFolderName.trim()">Buat</Btn>
        </div>
      </form>
    </Modal>

    <!-- Editor teks -->
    <Modal :open="editor.open" :title="editor.path" wide @close="editor.open = false">
      <div class="space-y-3">
        <textarea
          v-model="editor.content"
          class="field-input code-area h-[50vh] resize-none"
          spellcheck="false"
        />
        <div class="flex justify-end gap-2 border-t border-border pt-3">
          <Btn variant="outline" @click="editor.open = false">Tutup</Btn>
          <Btn :loading="editor.saving" @click="saveFile">Simpan</Btn>
        </div>
      </div>
    </Modal>
  </div>
</template>
