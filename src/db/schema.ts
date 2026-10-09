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
