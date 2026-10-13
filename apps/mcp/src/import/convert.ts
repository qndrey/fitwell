// Converts records of the Fitwell web app's backup file (apps/web/src/backup/schema.ts) into rows for the
// server's tables. Pure and defensive: the file comes from a browser, so every field is checked, and anything
// that can't be converted is counted with a reason instead of failing the import.
import { PRESETS } from '@fitwell/core/data/measurements';
import { isDay } from '@fitwell/core/domain/dates';
import type { CardioDetails } from '@fitwell/core/schema';
import type { StoredExercise, StoredSet, TemplateExercise } from '../data/workoutData';

export const KINDS = ['settings', 'goals', 'customFoods', 'weightEntries', 'measurementEntries', 'workouts', 'workoutTemplates', 'foodEntries'] as const;
export type Kind = (typeof KINDS)[number];
export const MAX_CHUNK = 250;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const nonNeg = (v: unknown): number | undefined => {
  const n = num(v);
  return n !== undefined && n >= 0 ? n : undefined;
};

/** Ids are scoped to the person so two people importing the same file never collide, and re-importing is a no-op. */
export const rowId = (userId: string, id: string) => `${userId}.${id}`;

export interface Converted<R> {
  rows: R[];
  received: number;
  skipped: Record<string, number>;
}

class Tally {
  readonly skipped: Record<string, number> = {};
  skip(reason: string) {
    this.skipped[reason] = (this.skipped[reason] ?? 0) + 1;
  }
}

function convertEach<R>(records: unknown[], one: (r: Obj, t: Tally) => R | null): Converted<R> {
  const t = new Tally();
  const rows: R[] = [];
  for (const r of records) {
    if (!isObj(r)) {
      t.skip('invalid');
      continue;
    }
    if (r.deletedAt !== undefined) {
      t.skip('deleted');
      continue;
    }
    const row = one(r, t);
    if (row) rows.push(row);
  }
  return { rows, received: records.length, skipped: t.skipped };
}

function nutrients(v: unknown): { kcal: number; protein: number; carbs: number; fat: number } | undefined {
  if (!isObj(v)) return undefined;
  const kcal = nonNeg(v.kcal);
  const protein = nonNeg(v.protein);
  const carbs = nonNeg(v.carbs);
  const fat = nonNeg(v.fat);
  return kcal === undefined || protein === undefined || carbs === undefined || fat === undefined ? undefined : { kcal, protein, carbs, fat };
}

const portions = (v: unknown): { label: string; grams: number }[] =>
  Array.isArray(v) ? v.flatMap((p) => (isObj(p) && str(p.label) && (nonNeg(p.grams) ?? 0) > 0 ? [{ label: p.label as string, grams: p.grams as number }] : [])) : [];

// ---------------------------------------------------------------- rows
export interface CustomFoodRow {
  id: string;
  name: string;
  brand: string | null;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  portions: string;
  created_at: number;
  updated_at: number;
}
export interface WeightRow {
  day: string;
  kg: number;
  created_at: number;
  updated_at: number;
}
export interface MeasurementRow {
  day: string;
  values: string;
  updated_at: number;
}
export interface WorkoutRow {
  id: string;
  day: string;
  type: 'strength' | 'cardio';
  name: string | null;
  started_at: number | null;
  finished_at: number | null;
  exercises: string | null;
  cardio: string | null;
  created_at: number;
  updated_at: number;
}
export interface TemplateRow {
  id: string;
  name: string;
  exercises: string;
  created_at: number;
  updated_at: number;
}
export interface FoodEntryRow {
  id: string;
  day: string;
  slot: string;
  food_ref: string | null;
  food_name: string;
  brand: string | null;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  created_at: number;
  updated_at: number;
}

const stamps = (r: Obj) => ({ created_at: num(r.createdAt) ?? Date.now(), updated_at: num(r.updatedAt) ?? num(r.createdAt) ?? Date.now() });

// ---------------------------------------------------------------- converters
export function customFoods(userId: string, records: unknown[]): Converted<CustomFoodRow> {
  return convertEach(records, (r, t) => {
    const id = str(r.id);
    const name = str(r.name);
    const n = nutrients(r.per100g);
    if (!id || !name || !n) return t.skip('invalid'), null;
    return { id: rowId(userId, id), name, brand: str(r.brand) ?? null, ...n, portions: JSON.stringify(portions(r.portions)), ...stamps(r) };
  });
}

export function weightEntries(_userId: string, records: unknown[]): Converted<WeightRow> {
  return convertEach(records, (r, t) => {
    const day = str(r.day);
    const kg = num(r.kg);
    if (!day || !isDay(day) || kg === undefined || kg < 1 || kg > 700) return t.skip('invalid'), null;
    return { day, kg, ...stamps(r) };
  });
}

const PRESET_KEYS = new Set(PRESETS.map((p) => p.key));

/** Values are keyed by measurement type id; presets are "mt:<key>". Your own measurement types have no home here. */
export function measurementEntries(_userId: string, records: unknown[]): Converted<MeasurementRow> {
  return convertEach(records, (r, t) => {
    const day = str(r.day);
    if (!day || !isDay(day) || !isObj(r.values)) return t.skip('invalid'), null;
    const values: Record<string, number> = {};
    let own = 0;
    for (const [typeId, v] of Object.entries(r.values)) {
      const key = typeId.startsWith('mt:') ? typeId.slice(3) : '';
      const n = nonNeg(v);
      if (!PRESET_KEYS.has(key)) own++;
      else if (n !== undefined && n >= 1 && n <= 250 && !(key === 'body-fat' && n > 70)) values[key] = n;
    }
    if (own) t.skip('own_measurement_type');
    if (Object.keys(values).length === 0) return own ? null : (t.skip('invalid'), null);
    return { day, values: JSON.stringify(values), updated_at: stamps(r).updated_at };
  });
}

const setOf = (v: unknown): StoredSet | undefined => {
  if (!isObj(v)) return undefined;
  const reps = nonNeg(v.reps);
  const weightKg = nonNeg(v.weightKg);
  if (!str(v.id) || (v.type !== 'working' && v.type !== 'warmup') || reps === undefined || weightKg === undefined) return undefined;
  const set: StoredSet = { id: v.id as string, type: v.type, reps, weightKg };
  if (nonNeg(v.durationSec) !== undefined) set.durationSec = v.durationSec as number;
  if (nonNeg(v.bodyweightKg) !== undefined) set.bodyweightKg = v.bodyweightKg as number;
  if (typeof v.done === 'boolean') set.done = v.done;
  return set;
};

function exerciseOf(v: unknown): StoredExercise | undefined {
  if (!isObj(v) || !str(v.exerciseRef) || !str(v.exerciseName) || !Array.isArray(v.sets)) return undefined;
  const sets = v.sets.map(setOf);
  if (sets.some((s) => !s)) return undefined;
  const e: StoredExercise = { exerciseRef: v.exerciseRef as string, exerciseName: v.exerciseName as string, sets: sets as StoredSet[] };
  if (str(v.uid)) e.uid = v.uid as string;
  if (str(v.supersetId)) e.supersetId = v.supersetId as string;
  if (v.mode === 'reps' || v.mode === 'time') e.mode = v.mode;
  if (v.load === 'weight' || v.load === 'bodyweight') e.load = v.load;
  return e;
}

function cardioOf(v: unknown): CardioDetails | undefined {
  if (!isObj(v) || !str(v.activityRef) || !str(v.activityName)) return undefined;
  const met = nonNeg(v.met);
  const durationMin = nonNeg(v.durationMin);
  if (met === undefined || durationMin === undefined) return undefined;
  const c: CardioDetails = { activityRef: v.activityRef as string, activityName: v.activityName as string, met, durationMin };
  for (const k of ['distanceKm', 'kcalEstimated', 'kcalOverride', 'weightKgUsed'] as const) if (nonNeg(v[k]) !== undefined) c[k] = v[k] as number;
  return c;
}

export function workouts(userId: string, records: unknown[]): Converted<WorkoutRow> {
  return convertEach(records, (r, t) => {
    const id = str(r.id);
    const day = str(r.day);
    if (!id || !day || !isDay(day) || (r.type !== 'strength' && r.type !== 'cardio')) return t.skip('invalid'), null;
    const s = stamps(r);
    const base = { id: rowId(userId, id), day, name: str(r.name) ?? null, started_at: num(r.startedAt) ?? null, ...s };
    if (r.type === 'cardio') {
      const cardio = cardioOf(r.cardio);
      if (!cardio) return t.skip('invalid'), null;
      return { ...base, type: 'cardio', finished_at: num(r.finishedAt) ?? s.updated_at, exercises: null, cardio: JSON.stringify(cardio) };
    }
    if (!Array.isArray(r.exercises)) return t.skip('invalid'), null;
    const exercises = r.exercises.map(exerciseOf);
    if (exercises.some((e) => !e)) return t.skip('invalid'), null;
    // The server counts a strength workout once it is finished; workouts logged afterwards in the app have no finish time.
    return { ...base, type: 'strength', finished_at: num(r.finishedAt) ?? s.updated_at, exercises: JSON.stringify(exercises), cardio: null };
  });
}

/** Strength templates made only of library exercises, in reps. Others (your own exercises, timed holds, cardio) are skipped. */
export function workoutTemplates(userId: string, records: unknown[]): Converted<TemplateRow> {
  return convertEach(records, (r, t) => {
    const id = str(r.id);
    const name = str(r.name);
    if (!id || !name || !Array.isArray(r.exercises)) return t.skip(r.type === 'cardio' ? 'cardio_template' : 'invalid'), null;
    const out: TemplateExercise[] = [];
    for (const e of r.exercises) {
      const ref = isObj(e) ? str(e.exerciseRef) : undefined;
      if (!isObj(e) || !ref || !ref.startsWith('ex:') || e.mode === 'time' || !Array.isArray(e.sets)) return t.skip('own_exercise_or_timed'), null;
      const sets = e.sets.filter((s): s is Obj => isObj(s));
      const working = sets.filter((s) => s.type === 'working');
      const first = working[0] ?? sets[0];
      const reps = nonNeg(first?.reps);
      if (!first || !reps || reps < 1) return t.skip('invalid'), null;
      const weight = e.load === 'bodyweight' ? undefined : nonNeg(first.weightKg);
      out.push({ id: ref, sets: Math.min(10, (working.length || sets.length)), reps: Math.min(50, Math.round(reps)), ...(weight ? { weightKg: weight } : {}), restSec: 90 });
    }
    if (!out.length) return t.skip('invalid'), null;
    return { id: rowId(userId, id), name, exercises: JSON.stringify(out.slice(0, 15)), ...stamps(r) };
  });
}

const SLOTS = new Set(['breakfast', 'lunch', 'dinner', 'snacks']);

/** Grams for an entry: stored grams, else the typed grams or portions, else worked back from calories and the food's values. */
function gramsOf(r: Obj, food: Obj | undefined, kcal: number): number | undefined {
  const g = nonNeg(r.grams);
  if (g) return g;
  const q = isObj(r.quantity) ? r.quantity : undefined;
  const amount = nonNeg(q?.amount);
  if (q?.unit === 'g' && amount) return amount;
  if (q?.unit === 'portion' && amount && food) {
    const p = portions(food.portions).find((x) => x.label === q.portionLabel);
    if (p) return p.grams * amount;
  }
  const per = isObj(food?.per100g) ? nonNeg((food!.per100g as Obj).kcal) : undefined;
  return per && per > 0 && kcal > 0 ? (kcal / per) * 100 : undefined;
}

/** Only resolved entries count (pending lookups have no values yet). */
export function foodEntries(userId: string, records: unknown[]): Converted<FoodEntryRow> {
  return convertEach(records, (r, t) => {
    const id = str(r.id);
    const day = str(r.day);
    const slot = str(r.slot);
    if (!id || !day || !isDay(day) || !slot || !SLOTS.has(slot)) return t.skip('invalid'), null;
    if (r.state !== 'resolved') return t.skip('not_resolved'), null;
    const n = nutrients(r.nutrition);
    if (!n) return t.skip('invalid'), null;
    const food = isObj(r.food) ? r.food : undefined;
    const grams = gramsOf(r, food, n.kcal);
    if (!grams || grams <= 0) return t.skip('no_weight'), null;
    const ref = food && isObj(food.ref) ? food.ref : undefined;
    const refId = str(ref?.id);
    const foodRef = !refId ? null : ref!.kind === 'bundled' ? refId : ref!.kind === 'off' ? `off:${refId}` : ref!.kind === 'custom' ? `custom:${rowId(userId, refId)}` : null;
    return { id: rowId(userId, id), day, slot, food_ref: foodRef, food_name: str(food?.name) ?? str(r.queryText) ?? 'Food', brand: str(food?.brand) ?? null, grams, ...n, ...stamps(r) };
  });
}

// ---------------------------------------------------------------- single documents
export interface ImportedGoals {
  kcal?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  workoutsPerWeek?: number;
  goalWeightKg?: number;
}
export function goalsDoc(v: unknown): ImportedGoals | null {
  if (!isObj(v)) return null;
  const out: ImportedGoals = {};
  for (const k of ['kcal', 'proteinG', 'carbsG', 'fatG', 'workoutsPerWeek', 'goalWeightKg'] as const) if (nonNeg(v[k]) !== undefined) out[k] = v[k] as number;
  return Object.keys(out).length ? out : null;
}

export interface ImportedSettings {
  units?: 'metric' | 'imperial';
}
/** Only the unit choice: the app's fallback body weight is a stand-in for weigh-ins, which are imported instead. */
export function settingsDoc(v: unknown): ImportedSettings | null {
  if (!isObj(v)) return null;
  return v.units === 'metric' || v.units === 'imperial' ? { units: v.units } : null;
}
