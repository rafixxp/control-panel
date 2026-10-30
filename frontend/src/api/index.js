import axios from 'axios';

/**
 * Instance Axios dengan interceptor:
 * - menyisipkan Bearer access token
 * - refresh token otomatis sekali saat 401 (single-flight), lalu retry
 */
const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 30_000,
});

let accessToken = null;
let onUnauthorized = null;
let refreshPromise = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

/** Dipanggil store auth:callback saat refresh juga gagal → logout. */
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post('/api/auth/refresh', {}, { withCredentials: true })
      .then((res) => {
        setAccessToken(res.data.accessToken);
        return res.data.accessToken;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const isAuthRoute = original?.url?.includes('/auth/login') || original?.url?.includes('/auth/refresh');
    const status = error.response?.status;

    if (status === 401 && !original._retried && !isAuthRoute) {
      original._retried = true;
      try {
        await refreshAccessToken();
        return api(original);
      } catch {
        setAccessToken(null);
        if (onUnauthorized) onUnauthorized();
      }
    }
    return Promise.reject(error);
  },
);

/** Pesan error yang konsisten dari respons backend. */
export function errorMessage(err, fallback = 'Terjadi kesalahan.') {
  return err?.response?.data?.message || err?.message || fallback;
}

export default api;
