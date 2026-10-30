<script setup>
defineProps({
  label: { type: String, default: '' },
  hint: { type: String, default: '' },
  error: { type: String, default: '' },
  required: { type: Boolean, default: false },
});
</script>

<template>
  <label class="block">
    <span v-if="label" class="mb-1.5 flex items-baseline justify-between text-xs font-medium text-text-muted">
      <span>
        {{ label }}
        <span v-if="required" class="text-danger">*</span>
      </span>
      <span v-if="hint" class="font-normal text-text-muted/70">{{ hint }}</span>
    </span>
    <slot />
    <span v-if="error" class="mt-1 block text-xs text-danger">{{ error }}</span>
  </label>
</template>
