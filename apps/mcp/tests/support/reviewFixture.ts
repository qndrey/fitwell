// A hand-made review for the pure tests of the automatic notes (no server): a complete Monday-to-Sunday week by default.
import type { WeekReview } from '../../src/analytics/reviewTypes';

type Core = Omit<WeekReview, 'notes'>;
const DAYS = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];

/** `workouts` maps a day offset (0 = Monday) to the kind of workout. */
export function fixture(o: { workouts?: Record<number, 'strength' | 'cardio' | 'session'>; over?: Partial<Core>; nutrition?: Partial<Core['nutrition']>; training?: Partial<Core['training']>; weight?: Partial<Core['weight']>; energy?: Partial<Core['energy']> } = {}): Core {
  const workouts = o.workouts ?? { 0: 'strength', 2: 'strength', 4: 'cardio' };
  const base: Core = {
    period: 'week',
    weekStart: '2026-10-12',
    weekEnd: '2026-10-18',
    inProgress: false,
    daysCounted: 7,
    days: DAYS.map((day, i) => ({ day, kcal: 2300, proteinG: 140, workout: workouts[i] ?? null, weighIn: null })),
    nutrition: { daysLogged: 7, average: { kcal: 2354, protein: 146, carbs: 260, fat: 70 }, previousAverage: { kcal: 2300, protein: 140 }, goals: { kcal: 2300, proteinG: 140, fiberG: null, satFatG: null, addedSugarG: null }, kcalWithin10Pct: 6, proteinReached: 6 },
    training: { strength: 2, cardio: 1, cardioMin: 35, session: 0, sessionMin: 0, previousSessions: 3, goalPerWeek: 3, records: [] },
    weight: { weighIns: 5, averageKg: 79.7, previousAverageKg: 80.1, changeKg: -0.4, goalKg: 78 },
    habits: { sleepHours: null, previousSleepHours: null, steps: null, previousSteps: null, waterMl: null, previousWaterMl: null },
    energy: { from: '2026-09-21', to: '2026-10-18', daysCounted: 28, weighIns: 18, expenditureKcal: null, intakeKcal: null, trendKgPerWeek: null, confidence: null, direction: null, suggestedKcal: null, suggestedRateKgPerWeek: null, goalKcal: 2300, goalDate: null, notes: [], reason: null } as unknown as WeekReview['energy'],
    plan: null,
    highlights: [],
    suggestions: [],
  };
  return { ...base, ...o.over, nutrition: { ...base.nutrition, ...o.nutrition }, training: { ...base.training, ...o.training }, weight: { ...base.weight, ...o.weight }, energy: { ...base.energy, ...o.energy } };
}
