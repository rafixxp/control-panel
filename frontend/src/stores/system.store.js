import { defineStore } from 'pinia';
import { io } from 'socket.io-client';
import api, { errorMessage } from '../api';

let socket = null;

export const useSystemStore = defineStore('system', {
  state: () => ({
    stats: null,
    services: [],
    activity: [],
    expiringSsl: [],
    bandwidth: [],
    domains: 0,
    databases: 0,
    users: 0,
    connected: false,
    loading: false,
    error: null,
    lastUpdate: null,
  }),

  actions: {
    async loadSummary() {
      this.loading = true;
      this.error = null;
      try {
        const { data } = await api.get('/dashboard/summary');
        this.stats = data.stats;
        this.services = data.services || [];
        this.activity = data.activity || [];
        this.expiringSsl = data.expiringSsl || [];
        this.domains = data.domains ?? 0;
        this.databases = data.databases ?? 0;
        this.users = data.users ?? 0;
        this.lastUpdate = Date.now();
      } catch (err) {
        this.error = errorMessage(err, 'Gagal memuat ringkasan dashboard.');
      } finally {
        this.loading = false;
      }
    },

    async loadBandwidth(hours = 6) {
      const { data } = await api.get('/dashboard/bandwidth', { params: { hours } });
      this.bandwidth = data.points || [];
      return data;
    },

    async controlService(key, action) {
      const { data } = await api.post(`/dashboard/services/${key}/${action}`);
      await this.loadSummary();
      return data;
    },

    connect(token) {
      if (socket || !token) return;
      socket = io({
        path: '/socket.io',
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 8,
      });

      socket.on('connect', () => {
        this.connected = true;
      });
      socket.on('disconnect', () => {
        this.connected = false;
      });
      socket.on('system:stats', (payload) => {
        this.stats = payload;
        if (Array.isArray(payload.services)) this.services = payload.services;
        this.lastUpdate = Date.now();
      });
      socket.on('connect_error', () => {
        this.connected = false;
      });
    },

    disconnect() {
      if (socket) {
        socket.disconnect();
        socket = null;
      }
      this.connected = false;
    },
  },
});
