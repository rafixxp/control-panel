<script setup>
import { RouterView } from 'vue-router';
import ConfirmHost from './components/ui/ConfirmHost.vue';
import { installGlobalAuthHandler } from './stores/auth.store';
import router from './router';

installGlobalAuthHandler(router);
</script>

<template>
  <RouterView />
  <ConfirmHost />
</template>
