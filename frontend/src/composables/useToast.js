import { useToast as useVueToast } from 'vue-toastification';

/** Toast wrapper agar pemakaian konsisten di seluruh halaman. */
export function useToast() {
  const toast = useVueToast();
  return {
    success: (message) => toast.success(message),
    error: (message) => toast.error(message),
    info: (message) => toast.info(message),
    warning: (message) => toast.warning(message),
  };
}
