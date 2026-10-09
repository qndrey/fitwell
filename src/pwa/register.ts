import { signal } from '@preact/signals';
import { registerSW } from 'virtual:pwa-register';

export const updateAvailable = signal(false);
let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  applyUpdate = registerSW({
    onNeedRefresh() {
      updateAvailable.value = true;
    },
  });
}

/** Activates the waiting worker and reloads. Only called from a user action. */
export function applyPendingUpdate(): void {
  void applyUpdate?.(true);
}
