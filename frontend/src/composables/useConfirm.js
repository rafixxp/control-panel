import { reactive } from 'vue';

/**
 * Konfirmasi aksi berbahaya (mikro-interaksi sesuai design system).
 * Pakai:
 *   const confirm = useConfirm();
 *   if (await confirm({ title: 'Hapus domain?', message: '...', danger: true })) { ... }
 */
export const confirmState = reactive({
  open: false,
  title: '',
  message: '',
  detail: '',
  confirmText: 'Konfirmasi',
  cancelText: 'Batal',
  danger: true,
  resolve: null,
});

export function useConfirm() {
  return ({ title, message = '', detail = '', confirmText = 'Konfirmasi', cancelText = 'Batal', danger = true } = {}) =>
    new Promise((resolve) => {
      Object.assign(confirmState, {
        open: true,
        title,
        message,
        detail,
        confirmText,
        cancelText,
        danger,
        resolve,
      });
    });
}

export function settleConfirm(answer) {
  const resolve = confirmState.resolve;
  confirmState.open = false;
  confirmState.resolve = null;
  if (resolve) resolve(answer);
}
