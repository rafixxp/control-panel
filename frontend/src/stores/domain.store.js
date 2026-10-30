import { defineStore } from 'pinia';
import api, { errorMessage } from '../api';

export const useDomainStore = defineStore('domain', {
  state: () => ({
    items: [],
    current: null,
    vhost: null,
    loading: false,
    saving: false,
    error: null,
  }),

  getters: {
    total: (state) => state.items.length,
    withSsl: (state) => state.items.filter((d) => d.ssl?.status === 'active').length,
    suspended: (state) => state.items.filter((d) => d.isSuspended).length,
  },

  actions: {
    async load() {
      this.loading = true;
      this.error = null;
      try {
        const { data } = await api.get('/domains');
        this.items = data.domains;
      } catch (err) {
        this.error = errorMessage(err, 'Gagal memuat daftar domain.');
      } finally {
        this.loading = false;
      }
    },

    async fetchOne(id) {
      const { data } = await api.get(`/domains/${id}`);
      this.current = data.domain;
      return data.domain;
    },

    async fetchVhost(id) {
      try {
        const { data } = await api.get(`/domains/${id}/vhost`);
        this.vhost = data.vhost;
      } catch {
        this.vhost = null;
      }
      return this.vhost;
    },

    async create(payload) {
      this.saving = true;
      try {
        const { data } = await api.post('/domains', payload);
        await this.load();
        return data.domain;
      } finally {
        this.saving = false;
      }
    },

    async update(id, payload) {
      this.saving = true;
      try {
        const { data } = await api.patch(`/domains/${id}`, payload);
        await this.load();
        this.current = data.domain;
        return data.domain;
      } finally {
        this.saving = false;
      }
    },

    async remove(id, { removeFiles = false } = {}) {
      await api.delete(`/domains/${id}`, { params: { removeFiles } });
      this.items = this.items.filter((d) => d.id !== id);
    },

    async openVhost(id) {
      return this.fetchVhost(id);
    },
  },
});
