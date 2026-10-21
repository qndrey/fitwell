// The shape of the progress numbers. Pure types, shared with the dashboard view (which can't see server code).
import type { Day } from '@fitwell/core/domain/dates';
import type { Confidence, WeightGoal } from '@fitwell/core/domain/energy';
import type { Extras } from '@fitwell/core/domain/nutrition';

export interface WeightProgress {
  daily: { day: Day; kg: number }[];
  /** 7-day trailing average; only where the window holds at least 3 weigh-ins (gaps stay gaps). */
  average: { day: Day; kg: number }[];
  latestKg: number | null;
  latestDay: Day | null;
  /** The 7-day average on the last day that has one; null without a trend. */
  trendKg: number | null;
  /** Change of the smoothed line over the period. */
  trendChangeKg: number | null;
  goalKg: number | null;
  /** Distance of the trend weight (the latest weigh-in without a trend) from the goal weight, always positive; the direction is the person's to read. */
  fromGoalKg: number | null;
}

export interface NutritionProgress {
  /** `extras` (fibre, sugars, saturated fat, salt in g) only where a logged food had them. */
  daily: { day: Day; kcal: number; protein: number; carbs: number; fat: number; extras?: Extras }[];
  daysLogged: number;
  /** Average per logged day for each week (Monday first) that has logged days; the first and last week may be partial. */
  weeks: { week: Day; kcal: number; protein: number; daysLogged: number }[];
  /** Average protein per logged day over the period, per kg of the latest 7-day average weight; null without either. */
  proteinPerKg: number | null;
  /** Extras are averaged over the days that have them. */
  averagePerLoggedDay: { kcal: number; protein: number; carbs: number; fat: number; extras?: Extras } | null;
  goals: { kcal: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null; fiberG: number | null; satFatG: number | null; addedSugarG: number | null };
  /** Calories within 10 % of the goal, protein at 90 % of the goal or more; only when that goal is set. */
  adherence: { kcalWithin10Pct: number | null; proteinReached: number | null; ofDays: number };
}

export interface TrainingProgress {
  weeks: { week: Day; /** The week is cut off: it starts before the data (or the period) does, or ends after the period. Left out of averages. */ partial: boolean; strength: number; cardio: number; cardioMin: number; session: number; sessionMin: number; sets: Record<string, number> }[];
  sessions: { strength: number; cardio: number; session: number };
  /** Workouts a week over the full weeks only; the whole period's workouts over one week when there is no full week yet. */
  perWeek: number;
  /** Every workout in the period as a day and a kind, oldest first (a day with two workouts appears twice). */
  days: { day: Day; type: 'strength' | 'cardio' | 'session' }[];
  averageStrengthMin: number | null;
  /** Working sets per primary muscle, averaged over the full weeks in the period. */
  setsPerWeekByMuscle: { muscle: string; sets: number }[];
  goalWorkoutsPerWeek: number | null;
}

export interface RecordsProgress {
  exercises: { id: string; name: string; firstE1rmKg: number; latestE1rmKg: number; bestE1rmKg: number; bestDay: Day; points: { day: Day; e1rmKg: number }[];
    /** One entry per day trained, oldest first: the set with the highest estimate, and whether the day set a new best (beat every earlier day in the period). */
    sessions: { day: Day; topSet: { kg: number; reps: number }; e1rm: number; isBest: boolean }[];
  }[];
}

export interface MeasurementProgress {
  types: { key: string; label: string; unit: 'cm' | '%'; firstDay: Day; first: number; latestDay: Day; latest: number; change: number; points: { day: Day; value: number }[] }[];
}

/** Sleep, steps and water: the days the person logged them. Averages are over those days only. */
export interface MetricsProgress {
  sleep: { daily: { day: Day; hours: number }[]; averageHours: number | null; /** The person's sleep goal in hours a night; null when they have none. */ goalHours: number | null };
  steps: { daily: { day: Day; steps: number }[]; average: number | null };
  water: { daily: { day: Day; ml: number }[]; averageMl: number | null };
}

/** Energy expenditure measured from the person's own intake and weight trend (last 28 days of the period). */
export interface EnergyProgress {
  /** kcal a day; null when the data can't support an estimate (then `reason` says what is missing). */
  expenditureKcal: number | null;
  reason: string | null;
  confidence: Confidence | null;
  from: Day;
  to: Day;
  daysCounted: number;
  /** Days left out as probably not fully logged. */
  daysExcluded: number;
  weighIns: number;
  intakeKcal: number | null;
  /** Slope of the weight trend, kg a week; negative is losing. */
  trendKgPerWeek: number | null;
  trendKg: number | null;
  goalKcal: number | null;
  /** Which way the goal weight lies from the trend weight; null without a goal weight. */
  direction: WeightGoal | null;
  /** Daily calories for that direction at the default rate (0.5 kg a week to lose, 0.25 to gain), from the measured expenditure. */
  suggestedKcal: number | null;
  suggestedRateKgPerWeek: number | null;
  /** When the trend line reaches the goal weight at the current rate; null when flat or heading away. */
  goalDate: Day | null;
  notes: string[];
}

export interface Progress {
  from: Day;
  to: Day;
  days: number;
  /** The first day with anything logged in the period; null when nothing is. Charts and weekly averages start here, not at `from`. */
  dataFrom: Day | null;
  weight: WeightProgress;
  nutrition: NutritionProgress;
  training: TrainingProgress;
  records: RecordsProgress;
  measurements: MeasurementProgress;
  metrics: MetricsProgress;
  energy: EnergyProgress;
}
