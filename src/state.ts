import { signal } from '@preact/signals';
import type { IDBPDatabase } from 'idb';
import { DEFAULT_SETTINGS, type Settings } from './db/schema';
import { getDb } from './db/open';
import { ensureMeta } from './db/meta';
import { loadSettings, saveSettings } from './db/settings';
import { onChange } from './db/broadcast';
import { installErrorHandling } from './errors';

export const settings = signal<Settings>(DEFAULT_SETTINGS);
export const storageAvailable = signal(true);
/** Best-effort connectivity hint (the network itself is the real test). */
export const online = signal(navigator.onLine !== false);
window.addEventListener('online', () => (online.value = true));
window.addEventListener('offline', () => (online.value = false));

export function applyTheme(theme: Settings['theme']): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('fitwell-theme', theme); // flash-avoidance mirror only
  } catch {
    /* storage may be blocked */
  }
}

export async function initState(): Promise<void> {
  installErrorHandling();
  try {
    const db: IDBPDatabase = await getDb();
    await ensureMeta(db);
    settings.value = await loadSettings(db);
    applyTheme(settings.value.theme);
    onChange(async (c) => {
      if (c.store === 'settings') {
        settings.value = await loadSettings(await getDb());
        applyTheme(settings.value.theme);
      }
    });
  } catch {
    storageAvailable.value = false;
  }
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id' | 'updatedAt'>>): Promise<void> {
  if (patch.theme) applyTheme(patch.theme);
  settings.value = { ...settings.value, ...patch };
  if (!storageAvailable.value) return;
  try {
    settings.value = await saveSettings(await getDb(), patch);
  } catch {
    storageAvailable.value = false;
  }
}
