import type { CardioDetails, FoodEntry, Goals, Slot, WeightEntry, Workout } from '../db/schema';
import { SLOTS } from '../db/schema';
import { addDays, formatDay, type Day } from '../domain/dates';
import { roundForDisplay } from '../domain/nutrition';
import { dayTotals } from '../domain/totals';
import { displayDistance, displayWeight, distanceUnit, weightUnit, type UnitSystem } from '../domain/units';
import { cardioKcal, summarizeSets } from '../domain/workouts';

/**
 * Text that people paste into an AI chat of their own choosing. Plain English on purpose (not in the UI strings):
 * it is addressed to the AI, and the app never sends it anywhere itself.
 */
export interface LoggedData {
  entries: FoodEntry[];
  workouts: Workout[];
  weights: WeightEntry[];
}

export type AnalysisKind = 'food' | 'workouts' | 'both';

export interface AnalysisInput {
  kind: AnalysisKind;
  from: Day;
  to: Day;
  units: UnitSystem;
  data: LoggedData;
  goals?: Pick<Goals, 'kcal' | 'proteinG' | 'carbsG' | 'fatG' | 'workoutsPerWeek' | 'goalWeightKg'>;
  /** Leave calories and macros out (the person chose to track habits only). */
  habitOnly?: boolean;
}

const live = <T extends { deletedAt?: number }>(l: T[]) => l.filter((x) => x.deletedAt === undefined);
const dayLabel = (d: Day) => `${d} (${formatDay(d, { weekday: 'short' }, 'en')})`;
const num = (n: number) => String(Math.round(n * 10) / 10);

function foodName(e: FoodEntry): string {
  return (e.food?.name ?? e.queryText ?? 'unnamed food').trim();
}

function quantityText(e: FoodEntry): string {
  const q = e.quantity;
  return q.unit === 'g' ? `${num(q.amount)} g` : `${num(q.amount)} × ${q.portionLabel ?? 'portion'}`;
}

/** One line per day, then one per meal: totals first so the AI sees the shape of the day. */
export function foodSection(entries: FoodEntry[], from: Day, to: Day, habitOnly = false): string {
  const byDay = new Map<Day, FoodEntry[]>();
  for (const e of live(entries)) if (e.day >= from && e.day <= to) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
  if (byDay.size === 0) return 'No food was logged in this period.';
  const out: string[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const list = byDay.get(day)!;
    const tot = dayTotals(list);
    const r = roundForDisplay(tot);
    const head = habitOnly ? `${dayLabel(day)}: ${list.length} item(s)` : `${dayLabel(day)}: ${r.kcal} kcal, protein ${num(r.protein)} g, carbs ${num(r.carbs)} g, fat ${num(r.fat)} g`;
    out.push(head + (tot.pendingCount ? ` (+${tot.pendingCount} item(s) without nutrition values)` : ''));
    for (const slot of SLOTS as readonly Slot[]) {
      const items = list.filter((e) => e.slot === slot);
      if (!items.length) continue;
      const text = items.map((e) => `${foodName(e)} ${quantityText(e)}${!habitOnly && e.state === 'resolved' && e.nutrition ? ` (${Math.round(e.nutrition.kcal)} kcal)` : ''}`).join('; ');
      out.push(`  ${slot[0]!.toUpperCase()}${slot.slice(1)}: ${text}`);
    }
  }
  return out.join('\n');
}

function cardioText(c: CardioDetails, units: UnitSystem, habitOnly: boolean): string {
  const bits = [`${c.activityName} ${Math.round(c.durationMin)} min`];
  if (c.distanceKm) bits.push(`${num(displayDistance(c.distanceKm, units))} ${distanceUnit(units)}`);
  const k = cardioKcal(c);
  if (!habitOnly && k !== undefined) bits.push(`about ${Math.round(k)} kcal`);
  return bits.join(', ');
}

/** One line per workout; strength sessions list each exercise with its working sets (warm-ups left out). */
export function workoutSection(workouts: Workout[], from: Day, to: Day, units: UnitSystem, habitOnly = false): string {
  const list = live(workouts).filter((w) => w.day >= from && w.day <= to).sort((a, b) => a.day.localeCompare(b.day) || a.createdAt - b.createdAt);
  if (!list.length) return 'No workouts were logged in this period.';
  const out: string[] = [];
  for (const w of list) {
    if (w.type === 'cardio' && w.cardio) {
      out.push(`${dayLabel(w.day)}: Cardio: ${cardioText(w.cardio, units, habitOnly)}`);
      continue;
    }
    out.push(`${dayLabel(w.day)}: Strength${w.name?.trim() ? ` "${w.name.trim()}"` : ''}`);
    let prev: string | undefined;
    for (const e of w.exercises ?? []) {
      const sets = summarizeSets(e.sets, units, e) || 'no working sets';
      const tag = e.supersetId ? (prev === e.supersetId ? ' (superset with the one above)' : ' (superset start)') : '';
      prev = e.supersetId;
      out.push(`  - ${e.exerciseName}: ${sets}${e.load === 'bodyweight' ? ' [bodyweight]' : ''}${tag}`);
    }
  }
  return out.join('\n');
}

function weightSection(weights: WeightEntry[], from: Day, to: Day, units: UnitSystem): string {
  const list = live(weights).filter((w) => w.day >= from && w.day <= to).sort((a, b) => a.day.localeCompare(b.day));
  if (!list.length) return '';
  return `Body weight (${weightUnit(units)}): ${list.map((w) => `${w.day} ${num(displayWeight(w.kg, units))}`).join(', ')}`;
}

function goalsText(g: AnalysisInput['goals'], units: UnitSystem, habitOnly: boolean): string {
  if (!g) return '';
  const bits: string[] = [];
  if (!habitOnly) {
    if (g.kcal) bits.push(`${g.kcal} kcal a day`);
    if (g.proteinG) bits.push(`protein ${g.proteinG} g`);
    if (g.carbsG) bits.push(`carbs ${g.carbsG} g`);
    if (g.fatG) bits.push(`fat ${g.fatG} g`);
  }
  if (g.workoutsPerWeek) bits.push(`${g.workoutsPerWeek} workouts a week`);
  if (g.goalWeightKg) bits.push(`goal weight ${num(displayWeight(g.goalWeightKg, units))} ${weightUnit(units)}`);
  return bits.length ? `My own goals: ${bits.join(', ')}.` : '';
}

const MANNER = 'Be factual and kind. Do not shame or moralise, do not give medical advice or diagnose anything, and say when the data is too thin to conclude anything.';

/** The "analyse my data" prompt: what to do, then the data. */
export function analysisPrompt(i: AnalysisInput): string {
  const habit = !!i.habitOnly;
  const what = i.kind === 'food' ? 'food log' : i.kind === 'workouts' ? 'workout log' : 'food and workout logs';
  const sections: string[] = [];
  if (i.kind !== 'workouts') sections.push(`FOOD\n${foodSection(i.data.entries, i.from, i.to, habit)}`);
  if (i.kind !== 'food') sections.push(`WORKOUTS\n${workoutSection(i.data.workouts, i.from, i.to, i.units, habit)}`);
  const w = weightSection(i.data.weights, i.from, i.to, i.units);
  if (w) sections.push(w);
  const task =
    i.kind === 'food'
      ? 'Summarise how I ate: typical days, what stands out, how it compares with my goals, and two or three small, practical ideas.'
      : i.kind === 'workouts'
        ? 'Summarise my training: how often I trained, what I did most and least, how loads and volume changed, and two or three small, practical ideas for what to do next.'
        : 'Summarise my eating and training together: patterns, what stands out, and two or three small, practical ideas.';
  return [
    `Here is my ${what} from Fitwell, a private fitness tracker, from ${i.from} to ${i.to}. Weights are in ${weightUnit(i.units)}.`,
    task,
    MANNER,
    goalsText(i.goals, i.units, habit),
    '',
    ...sections.flatMap((s) => [s, '']),
  ]
    .filter((l, idx, a) => !(l === '' && a[idx - 1] === ''))
    .join('\n')
    .trimEnd();
}

/** The exact shape the app accepts back. Kept in one place so the prompt and the importer cannot drift apart. */
export const WORKOUT_JSON_EXAMPLE = `{
  "fitwell": "workout",
  "version": 1,
  "day": "2026-10-12",
  "name": "Push day",
  "units": "kg",
  "exercises": [
    { "name": "Barbell Bench Press", "sets": [ { "type": "warmup", "reps": 10, "weight": 40 }, { "reps": 8, "weight": 60 }, { "reps": 8, "weight": 60 } ] },
    { "name": "Dumbbell Shoulder Press", "superset": "A", "sets": [ { "reps": 10, "weight": 16 }, { "reps": 10, "weight": 16 } ] },
    { "name": "Plank", "mode": "time", "load": "bodyweight", "superset": "A", "sets": [ { "seconds": 45 }, { "seconds": 45 } ] },
    { "name": "Push-Up", "load": "bodyweight", "sets": [ { "reps": 12, "added": 0 } ] }
  ]
}`;

export interface RequestInput {
  goal: string;
  day: Day;
  units: UnitSystem;
  data: LoggedData;
  /** How far back the recent training in the prompt reaches. */
  recentDays: number;
}

/** The "ask for a workout" prompt: context, then the JSON format to reply in. */
export function workoutRequestPrompt(i: RequestInput): string {
  const from = addDays(i.day, -i.recentDays);
  const goal = i.goal.trim();
  return [
    `Please plan a strength workout for ${i.day}${goal ? `: ${goal}` : ''}.`,
    '',
    `My recent training from Fitwell, a private fitness tracker (weights in ${weightUnit(i.units)}):`,
    workoutSection(i.data.workouts, from, addDays(i.day, -1), i.units),
    '',
    'Reply with one JSON object only, in a code block, in exactly this format so I can import it into the app:',
    WORKOUT_JSON_EXAMPLE,
    '',
    `Rules: "units" is "kg" or "lb" and I use ${weightUnit(i.units)}. Each set has "reps" and "weight" (or "seconds" for timed exercises with "mode": "time"). Set "type" to "warmup" for warm-ups; otherwise leave it out. For bodyweight exercises use "load": "bodyweight" and "added" for extra weight (0 for none). Give consecutive exercises the same "superset" label to pair them. Use common exercise names (for example "Barbell Squat", "Pull-Up"). At most 12 exercises and 8 sets each.`,
    MANNER,
  ].join('\n');
}
