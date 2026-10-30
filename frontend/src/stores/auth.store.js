import { defineStore } from 'pinia';
import api, { setAccessToken, setUnauthorizedHandler } from '../api';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null,
    token: null,
    initialized: false,
    loading: false,
  }),

  getters: {
    isAuthenticated: (state) => Boolean(state.token),
    isSuperAdmin: (state) => state.user?.role === 'SUPER_ADMIN',
    canManageServer: (state) => ['SUPER_ADMIN', 'ADMIN'].includes(state.user?.role),
  },

  actions: {
    /** Coba pulihkan sesi dari refresh cookie (30 hari). */
    async init() {
      if (this.initialized) return;
      try {
        const { data } = await api.post('/auth/refresh');
        this.token = data.accessToken;
        this.user = data.user;
        setAccessToken(data.accessToken);
      } catch {
        this.token = null;
        this.user = null;
        setAccessToken(null);
      } finally {
        this.initialized = true;
      }
    },

    async login({ identifier, password, rememberMe }) {
      this.loading = true;
      try {
        const { data } = await api.post('/auth/login', { identifier, password, rememberMe });
        this.token = data.accessToken;
        this.user = data.user;
        setAccessToken(data.accessToken);
        return data.user;
      } finally {
        this.loading = false;
      }
    },

    async fetchMe() {
      const { data } = await api.get('/auth/me');
      this.user = data.user;
      return data.user;
    },

    async logout() {
      try {
        await api.post('/auth/logout');
      } finally {
        this.reset();
      }
    },

    reset() {
      this.user = null;
      this.token = null;
      setAccessToken(null);
    },
  },
});

/** Dipanggil API saat refresh token juga gagal → paksa logout. */
export function installGlobalAuthHandler(router) {
  setUnauthorizedHandler(() => {
    const auth = useAuthStore();
    auth.reset();
    if (router.currentRoute.value.path !== '/login') router.push({ name: 'login' });
  });
}
