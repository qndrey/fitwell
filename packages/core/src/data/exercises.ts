import { prepare, search, type Searchable } from '../search/rank';
import { tokenize } from '../search/text';
import type { CustomExercise } from '../schema';

export interface Exercise {
  /** "ex:<id>" (bundled) or "cx:<id>" (yours). Stable: user data refers to this. */
  ref: string;
  name: string;
  category?: string;
  level?: string;
  equipment: string;
  /** push, pull or static, when the library says. */
  force?: string;
  /** compound or isolation, when the library says. */
  mechanic?: string;
  primary: string[];
  secondary: string[];
  custom?: boolean;
}

interface Index {
  meta: { id: string; name: string; url: string; commit: string; license: string };
  categories: string[];
  equipment: string[];
  muscles: string[];
  exercises: { id: string; name: string; category: string; level: string; equipment: string; force?: string; mechanic?: string; primary: string[]; secondary: string[] }[];
}

let cache: Promise<{ meta: Index['meta']; equipment: string[]; muscles: string[]; exercises: Exercise[] }> | null = null;

/** The bundled library (read-only). Lazy: its own chunk, fetched when an exercise is first picked. */
export function loadExercises() {
  cache ??= import('./generated/exercises.index.json').then((m) => {
    const raw = m.default as unknown as Index;
    return {
      meta: raw.meta,
      equipment: raw.equipment,
      muscles: raw.muscles,
      exercises: raw.exercises.map((e): Exercise => ({ ref: `ex:${e.id}`, name: e.name, category: e.category, level: e.level, equipment: e.equipment, ...(e.force ? { force: e.force } : {}), ...(e.mechanic ? { mechanic: e.mechanic } : {}), primary: e.primary, secondary: e.secondary })),
    };
  });
  cache.catch(() => (cache = null));
  return cache;
}

let instr: Promise<Record<string, string[]>> | null = null;
/** How-to text for one exercise; the file is only fetched when someone opens "How to". */
export async function loadInstructions(ref: string): Promise<string[]> {
  instr ??= import('./generated/exercises.instructions.json').then((m) => m.default as unknown as Record<string, string[]>);
  instr.catch(() => (instr = null));
  return (await instr)[ref.replace(/^ex:/, '')] ?? [];
}

export const fromCustom = (c: CustomExercise): Exercise => ({ ref: `cx:${c.id}`, name: c.name, equipment: c.equipment ?? 'other', primary: c.primary, secondary: [], custom: true });

export interface ExerciseFilter {
  query: string;
  muscle?: string;
  equipment?: string;
}

/** The staples most people mean (names as in the library): a nudge up so they lead their search. */
const STAPLES = new Set(
  [
    'Barbell Squat', 'Bodyweight Squat', 'Goblet Squat', 'Front Barbell Squat', 'Barbell Bench Press - Medium Grip', 'Dumbbell Bench Press', 'Incline Dumbbell Press',
    'Barbell Deadlift', 'Romanian Deadlift', 'Pullups', 'Chin-Up', 'Pushups', 'Barbell Curl', 'Dumbbell Bicep Curl', 'Hammer Curls', 'Bent Over Barbell Row',
    'One-Arm Dumbbell Row', 'Standing Military Press', 'Dumbbell Shoulder Press', 'Dumbbell Lunges', 'Barbell Hip Thrust', 'Plank', 'Crunches', 'Triceps Pushdown',
    'Wide-Grip Lat Pulldown', 'Seated Cable Rows', 'Leg Press', 'Lying Leg Curls', 'Leg Extensions', 'Standing Calf Raises', 'Side Lateral Raise',
    'Dips - Triceps Version', 'Hanging Leg Raise', 'Face Pull',
  ].map((n) => n.toLowerCase()),
);
/** "Squat To A Bench": the words after to/with/on describe the variant, not the movement. */
const MODIFIER = /\b(?:to|with|on|off|from|over|behind|against)\b(.*)$/i;

const UNUSUAL = /\b(bands?|chains?|jerk|sled|plate movers|reverse band|speed|pins?|board|deficit|rack|anderson|jefferson|frankenstein|bradford|rocky|kneeling|suspended|isometric|with a twist)\b/i;

/**
 * Name search (typo-tolerant), narrowed by muscle and equipment. Filters apply to primary and secondary muscles.
 * Text matches are then re-ranked for how people look for exercises: ones you have done (`yours`) first, then common
 * movements (those we can draw) and names that end in the word you typed ("Barbell Squat"), odd variants (bands, chains,
 * jerks) last. The plain text order breaks ties.
 */
export function searchExercises(
  index: Searchable<Exercise>[],
  all: Exercise[],
  f: ExerciseFilter,
  limit = 40,
  yours: ReadonlySet<string> = new Set(),
  /** "A movement we can draw", i.e. a common one. A caller with illustrations can pass its matcher; core has no drawings. */
  isCommon: (name: string) => unknown = () => false,
): Exercise[] {
  const keep = (e: Exercise) => (!f.muscle || e.primary.includes(f.muscle) || e.secondary.includes(f.muscle)) && (!f.equipment || e.equipment === f.equipment);
  if (!f.query.trim()) return all.filter(keep).slice(0, limit);
  const words = tokenize(f.query);
  const lastWord = words[words.length - 1] ?? '';
  const hits = search(index, f.query, 400).filter(keep);
  const scored = hits.map((e, i) => {
    const tokens = tokenize(e.name);
    let score = -i * 0.05;
    if (yours.has(e.ref)) score += 6;
    if (isCommon(e.name)) score += 1.5;
    if (tokens[tokens.length - 1]?.startsWith(lastWord)) score += 1.5;
    if (UNUSUAL.test(e.name)) score -= 2.5;
    if (STAPLES.has(e.name.toLowerCase())) score += 3;
    const tail = MODIFIER.exec(e.name)?.[1];
    if (tail && words.every((w) => tokenize(tail).some((t) => t.startsWith(w))) && !words.every((w) => tokenize(e.name.slice(0, e.name.length - tail.length)).some((t) => t.startsWith(w)))) score -= 3;
    return { e, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.e);
}

export const prepareExercises = (list: Exercise[]) => prepare(list, (e) => e.name);

// Name words that don't make an exercise a variation: equipment and the default grip/stance.
const NEUTRAL = new Set(['barbell', 'dumbbell', 'dumbbells', 'kettlebell', 'kettlebells', 'medium', 'grip', 'standing', 'bicep', 'biceps']);
const LEVEL: Record<string, number> = { beginner: 0, intermediate: 1, expert: 2 };

/**
 * The search ranks short names first, which favours odd variations ("Bench Press with Chains", "Squat Jerk").
 * Reorders hits so the plain lift comes first: fewest name words beyond what was asked (ignoring equipment and
 * grip words), then the strength category, then easier levels, then search order.
 */
export function plainFirst(query: string, hits: Exercise[]): Exercise[] {
  const asked = tokenize(query);
  const extra = (e: Exercise) => tokenize(e.name).filter((t) => !NEUTRAL.has(t) && !asked.some((q) => t.startsWith(q))).length;
  return hits
    .map((e, i) => ({ e, i, x: extra(e), c: e.category === 'strength' ? 0 : 1, l: LEVEL[e.level ?? ''] ?? 1 }))
    .sort((a, b) => a.x - b.x || a.c - b.c || a.l - b.l || a.i - b.i)
    .map((r) => r.e);
}

export interface SubstituteOptions {
  /** Equipment the person has (their profile); bodyweight exercises always count. Empty or absent: anything. */
  equipment?: readonly string[];
  /** Equipment to avoid right now, e.g. ["barbell"] when the rack is taken. */
  excludeEquipment?: readonly string[];
  limit?: number;
}

const LIFTING = new Set(['strength', 'powerlifting', 'olympic weightlifting', 'strongman']);
/** "dumbbells" and "Dumbbell" are the same equipment. */
const kit = (s: string) => s.trim().toLowerCase().replace(/s$/, '');

/**
 * Exercises that can stand in for `target` (the machine is busy, the person has no barbell, a joint objects): they must
 * work at least one of its main muscles and be the same kind of exercise (a lift for a lift, a stretch for a stretch).
 * Ranked by how much the main muscles overlap, then the helping muscles, the same push/pull and compound/isolation
 * character, and how common the exercise is; odd variants (chains, bands, jerks) sink. A different piece of equipment
 * gets a small nudge, since that is usually why someone swaps.
 */
export function substitutes(target: Exercise, all: Exercise[], o: SubstituteOptions = {}): Exercise[] {
  const overlap = (a: string[], b: string[]) => {
    const union = new Set([...a, ...b]).size;
    return union ? a.filter((x) => b.includes(x)).length / union : 0;
  };
  const have = o.equipment?.length ? new Set(o.equipment.map(kit)) : null;
  const avoid = new Set((o.excludeEquipment ?? []).map(kit));
  const usable = (e: Exercise) => !avoid.has(kit(e.equipment)) && (!have || have.has(kit(e.equipment)) || e.equipment === 'body only' || e.equipment === 'none');
  const sameKind = (e: Exercise) => (LIFTING.has(target.category ?? 'strength') ? LIFTING.has(e.category ?? 'strength') : e.category === target.category);
  return all
    .filter((e) => e.ref !== target.ref && e.primary.some((m) => target.primary.includes(m)) && sameKind(e) && usable(e))
    .map((e) => {
      let score = 4 * overlap(e.primary, target.primary) + 1.5 * overlap(e.secondary, target.secondary);
      if (e.mechanic && e.mechanic === target.mechanic) score += 1;
      if (e.force && e.force === target.force) score += 1;
      if (STAPLES.has(e.name.toLowerCase())) score += 1;
      if (UNUSUAL.test(e.name) || MODIFIER.test(e.name)) score -= 1.5;
      if (kit(e.equipment) !== kit(target.equipment)) score += 0.25;
      return { e, score };
    })
    .sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name))
    .slice(0, o.limit ?? 8)
    .map((x) => x.e);
}
