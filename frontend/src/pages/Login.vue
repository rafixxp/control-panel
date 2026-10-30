<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Lock, Server, ShieldCheck, User } from 'lucide-vue-next';
import Btn from '../components/ui/Btn.vue';
import Field from '../components/ui/Field.vue';
import { useAuthStore } from '../stores/auth.store';
import { errorMessage } from '../api';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const identifier = ref('');
const password = ref('');
const rememberMe = ref(true);
const error = ref('');

async function submit() {
  error.value = '';
  try {
    await auth.login({ identifier: identifier.value.trim(), password: password.value, rememberMe: rememberMe.value });
    router.push(typeof route.query.redirect === 'string' ? route.query.redirect : { name: 'dashboard' });
  } catch (err) {
    error.value = errorMessage(err, 'Login gagal. Periksa kembali data Anda.');
  }
}
</script>

<template>
  <div class="flex min-h-full items-center justify-center bg-bg-base p-4">
    <div class="w-full max-w-sm">
      <div class="mb-6 text-center">
        <span class="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-card bg-accent text-lg font-semibold text-white">
          N
        </span>
        <h1 class="text-xl font-semibold tracking-tight">NodePanel</h1>
        <p class="mt-1 text-sm text-text-muted">Web hosting control panel</p>
      </div>

      <form
        class="glass-card space-y-4 rounded-card p-6"
        @submit.prevent="submit"
      >
        <Field label="Email atau username" required>
          <div class="relative">
            <User :size="15" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              v-model="identifier"
              class="field-input !pl-9"
              type="text"
              autocomplete="username"
              placeholder="admin@localhost"
              required
            />
          </div>
        </Field>

        <Field label="Password" required>
          <div class="relative">
            <Lock :size="15" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              v-model="password"
              class="field-input !pl-9"
              type="password"
              autocomplete="current-password"
              placeholder="••••••••"
              required
            />
          </div>
        </Field>

        <label class="flex cursor-pointer items-center gap-2 text-sm text-text-muted">
          <input v-model="rememberMe" type="checkbox" class="accent-accent" />
          Tetap masuk selama 30 hari
        </label>

        <p
          v-if="error"
          class="rounded-btn border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {{ error }}
        </p>

        <Btn type="submit" class="w-full" :loading="auth.loading">Masuk</Btn>

        <p class="text-center text-xs text-text-muted">
          Rate limit: 5 percobaan per 15 menit.
        </p>
      </form>

      <div class="mt-6 flex items-center justify-center gap-4 text-xs text-text-muted">
        <span class="inline-flex items-center gap-1.5"><Server :size="13" /> Port 2087</span>
        <span class="inline-flex items-center gap-1.5"><ShieldCheck :size="13" /> JWT + refresh token</span>
      </div>
    </div>
  </div>
</template>
