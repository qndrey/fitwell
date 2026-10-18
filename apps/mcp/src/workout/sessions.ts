// Whole-body sessions (Pilates, HIIT, CrossFit, Hyrox, ...): which muscles they work, as rough credit in hard sets.
import type { SessionCategory } from '@fitwell/core/data/activities';
import type { CardioDetails } from '@fitwell/core/schema';

export interface SessionDetails extends CardioDetails {
  category: SessionCategory;
  /** What was done, in the person's words ("Fran, then 5 km row"). */
  notes?: string;
}

interface Profile {
  label: string;
  /** The activity whose MET value is used when none is given. */
  defaultActivity: string;
  /** Hard-set credit per hour for each muscle group (a strength set counts 1). Rough estimates, below what lifting gives. */
  perHour: Record<string, number>;
}

export const SESSION_PROFILES: Record<SessionCategory, Profile> = {
  pilates: { label: 'Pilates', defaultActivity: 'act:pilates', perHour: { abdominals: 4, 'lower back': 2, glutes: 3, adductors: 2, hamstrings: 1, shoulders: 1 } },
  yoga: { label: 'Yoga', defaultActivity: 'act:yoga', perHour: { abdominals: 1.5, shoulders: 2, quadriceps: 1.5, glutes: 1.5, hamstrings: 1, 'lower back': 1 } },
  hiit: { label: 'HIIT', defaultActivity: 'act:hiit', perHour: { quadriceps: 4, glutes: 4, hamstrings: 2, calves: 2, abdominals: 3, shoulders: 2, chest: 2 } },
  crossfit: { label: 'CrossFit', defaultActivity: 'act:crossfit', perHour: { quadriceps: 5, glutes: 5, hamstrings: 3, abdominals: 4, shoulders: 5, lats: 3, traps: 2, chest: 2, triceps: 2, biceps: 2, 'lower back': 2 } },
  hyrox: { label: 'Hyrox', defaultActivity: 'act:hyrox-training', perHour: { quadriceps: 5, glutes: 5, hamstrings: 4, calves: 3, abdominals: 3, shoulders: 3, lats: 2, chest: 2, forearms: 2 } },
  functional: { label: 'Functional training', defaultActivity: 'act:functional-training', perHour: { quadriceps: 3, glutes: 3, hamstrings: 2, abdominals: 3, shoulders: 2, lats: 2, chest: 1.5, 'lower back': 1 } },
};

/** Hard sets of credit per muscle group for a session of the given length. */
export function sessionMuscleCredit(category: SessionCategory, minutes: number): Record<string, number> {
  const hours = minutes / 60;
  return Object.fromEntries(Object.entries(SESSION_PROFILES[category].perHour).map(([m, rate]) => [m, rate * hours]));
}
