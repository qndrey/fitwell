import { signal } from '@preact/signals';
import type { IDBPDatabase } from 'idb';
import { DEFAULT_SETTINGS, type Goals, type Settings } from './db/schema';
import { loadGoals, saveGoals } from './db/goals';
import { getDb } from './db/open';
import { ensureMeta } from './db/meta';
import { loadSettings, saveSettings } from './db/settings';
import { onChange } from './db/broadcast';
import { installErrorHandling } from './errors';
import { bodyWeightKg } from './domain/met';
import { latestWeightEntry } from './features/body/store';

export const settings = signal<Settings>(DEFAULT_SETTINGS);
export const goals = signal<Goals>({ id: 'goals', updatedAt: 0 });
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
    goals.value = await loadGoals(db);
    applyTheme(settings.value.theme);
    onChange(async (c) => {
      if (c.store === 'goals') goals.value = await loadGoals(await getDb());
      if (c.store === 'settings') {
        settings.value = await loadSettings(await getDb());
        applyTheme(settings.value.theme);
      }
    });
  } catch {
    storageAvailable.value = false;
  }
}

/** Body weight for calorie estimates: the latest logged weight (Gate 5) else the one set in Settings, else none. */
export function currentWeightKg(): number | undefined {
  return bodyWeightKg(latestWeightEntry.value?.kg, settings.value.fallbackWeightKg);
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

export async function updateGoals(patch: Partial<Omit<Goals, 'id' | 'updatedAt'>>): Promise<void> {
  goals.value = { ...goals.value, ...patch };
  if (!storageAvailable.value) return;
  try {
    goals.value = await saveGoals(await getDb(), patch);
  } catch {
    storageAvailable.value = false;
  }
}
