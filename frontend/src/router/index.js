import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth.store';

const routes = [
  { path: '/login', name: 'login', component: () => import('../pages/Login.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('../components/layout/AppShell.vue'),
    children: [
      { path: '', name: 'dashboard', component: () => import('../pages/Dashboard.vue') },
      { path: 'domains', name: 'domains', component: () => import('../pages/Domains.vue') },
      { path: 'domains/:id', name: 'domain-edit', component: () => import('../pages/DomainEdit.vue') },
      { path: 'ssl', name: 'ssl', component: () => import('../pages/SSL.vue') },
      { path: 'files', name: 'files', component: () => import('../pages/FileManager.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.initialized) await auth.init();

  if (to.meta.public) {
    return auth.isAuthenticated && to.name === 'login' ? { name: 'dashboard' } : true;
  }
  if (!auth.isAuthenticated) return { name: 'login', query: { redirect: to.fullPath } };
  return true;
});

export default router;
