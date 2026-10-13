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
  primary: string[];
  secondary: string[];
  custom?: boolean;
}

interface Index {
  meta: { id: string; name: string; url: string; commit: string; license: string };
  categories: string[];
  equipment: string[];
  muscles: string[];
  exercises: { id: string; name: string; category: string; level: string; equipment: string; primary: string[]; secondary: string[] }[];
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
      exercises: raw.exercises.map((e): Exercise => ({ ref: `ex:${e.id}`, name: e.name, category: e.category, level: e.level, equipment: e.equipment, primary: e.primary, secondary: e.secondary })),
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

/** Name search (typo-tolerant), narrowed by muscle and equipment. Filters apply to primary and secondary muscles. */
export function searchExercises(index: Searchable<Exercise>[], all: Exercise[], f: ExerciseFilter, limit = 40): Exercise[] {
  const keep = (e: Exercise) => (!f.muscle || e.primary.includes(f.muscle) || e.secondary.includes(f.muscle)) && (!f.equipment || e.equipment === f.equipment);
  if (f.query.trim()) return search(index, f.query, 400).filter(keep).slice(0, limit);
  return all.filter(keep).slice(0, limit);
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
