import type { FoodItem } from '../domain/foods';
import type { Nutrients, Portion, Quantity } from '../domain/nutrition';

/** Fields every user-owned record carries (sync-ready; see TECH_SPEC §3.1). */
export interface Base {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Tombstone. Records with this set are hidden from normal queries. */
  deletedAt?: number;
  rev: number;
}

export type ThemePreference = 'light' | 'dark' | 'system';

export interface Settings {
  id: 'settings';
  units: 'metric' | 'imperial';
  theme: ThemePreference;
  habitOnly: boolean;
  hideBodyTracking: boolean;
  fallbackWeightKg?: number;
  measurementReminderWeeks?: 1 | 2 | 4;
  backupReminderDays: number;
  lastBackupAt?: number;
  updatedAt: number;
}

export interface Goals {
  id: 'goals';
  kcal?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  workoutsPerWeek?: number;
  goalWeightKg?: number;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  units: 'metric',
  theme: 'system',
  habitOnly: false,
  hideBodyTracking: false,
  backupReminderDays: 14,
  updatedAt: 0,
};

export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snacks';
export const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner', 'snacks'];

/** See PLAN §8. Gate 1 only creates `resolved` entries; the other states arrive with the pending queue. */
export type EntryState = 'resolved' | 'pending' | 'awaiting_confirmation' | 'unmatched';

export interface FoodEntry extends Base {
  day: string;
  slot: Slot;
  state: EntryState;
  /** Snapshot of the food at logging time, so later edits to a custom food never change history. */
  food?: FoodItem;
  /** Free text for entries that are not resolved yet. */
  queryText?: string;
  quantity: Quantity;
  grams?: number;
  nutrition?: Nutrients;
}

export interface CustomFood extends Base {
  name: string;
  brand?: string;
  per100g: Nutrients;
  portions: Portion[];
}

export interface Favorite extends Base {
  food: FoodItem;
}

export interface SavedMealItem {
  food: FoodItem;
  quantity: Quantity;
}

export interface SavedMeal extends Base {
  name: string;
  items: SavedMealItem[];
}
