import { signal } from '@preact/signals';

export interface ToastData {
  message: string;
  action?: { label: string; run: () => void };
}

export const toast = signal<ToastData | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string, action?: ToastData['action'], ms = 6000): void {
  clearTimeout(timer);
  toast.value = { message, action };
  timer = setTimeout(() => (toast.value = null), ms);
}

export function dismissToast(): void {
  clearTimeout(timer);
  toast.value = null;
}
