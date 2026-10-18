// How much each muscle group was trained: weekly hard sets against the usual range. Pure: no I/O.
import { addDays, dayNumber, type Day } from '@fitwell/core/domain/dates';
import { sessionMuscleCredit } from '../workout/sessions';
import type { Workout } from '../data/workoutData';
import { MUSCLE_GROUPS, WEEKLY_SET_RANGE, type MuscleLevel, type MuscleLoad, type MuscleMap } from './muscleTypes';

export { MUSCLE_GROUPS, WEEKLY_SET_RANGE, type MuscleLevel, type MuscleLoad, type MuscleMap } from './muscleTypes';

export interface MuscleMapInput {
  /** Workouts of any kind in the period; finished strength workouts and whole-body sessions count. */
  workouts: Workout[];
  to: Day;
  weeks: number;
  /** The muscles of a library exercise id. */
  musclesOf: (exerciseRef: string) => { primary: string[]; secondary: string[] };
}

export const levelFor = (setsPerWeek: number): MuscleLevel => (setsPerWeek <= 0 ? 'none' : setsPerWeek < WEEKLY_SET_RANGE.low ? 'below' : setsPerWeek <= WEEKLY_SET_RANGE.high ? 'in_range' : 'high');

export function buildMuscleMap(i: MuscleMapInput): MuscleMap {
  const from = addDays(i.to, -(i.weeks * 7 - 1));
  const sets = new Map<string, number>();
  const last = new Map<string, Day>();
  const byExercise = new Map<string, Map<string, number>>();
  const strength = i.workouts.filter((w) => w.type === 'strength' && w.finishedAt !== null && w.day >= from && w.day <= i.to);
  for (const w of strength) {
    for (const e of w.exercises) {
      const done = e.sets.filter((s) => s.type === 'working' && s.done !== false).length;
      if (!done) continue;
      const { primary, secondary } = i.musclesOf(e.exerciseRef);
      const credit = [...primary.map((m) => [m, 1] as const), ...secondary.filter((m) => !primary.includes(m)).map((m) => [m, 0.5] as const)];
      for (const [m, k] of credit) {
        sets.set(m, (sets.get(m) ?? 0) + done * k);
        const ex = byExercise.get(m) ?? new Map<string, number>();
        ex.set(e.exerciseName, (ex.get(e.exerciseName) ?? 0) + done * k);
        byExercise.set(m, ex);
        if (k === 1 && (last.get(m) ?? '') < w.day) last.set(m, w.day as Day);
      }
    }
  }
  // Whole-body sessions give a rough credit per muscle, in proportion to their length.
  const classes = i.workouts.filter((w) => w.type === 'session' && w.session && w.day >= from && w.day <= i.to);
  for (const w of classes) {
    const label = w.name ?? w.session!.activityName;
    for (const [m, credit] of Object.entries(sessionMuscleCredit(w.session!.category, w.session!.durationMin))) {
      sets.set(m, (sets.get(m) ?? 0) + credit);
      const ex = byExercise.get(m) ?? new Map<string, number>();
      ex.set(label, (ex.get(label) ?? 0) + credit);
      byExercise.set(m, ex);
      if ((last.get(m) ?? '') < w.day) last.set(m, w.day as Day);
    }
  }
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const muscles = MUSCLE_GROUPS.map((muscle): MuscleLoad => {
    const perWeek = r1((sets.get(muscle) ?? 0) / i.weeks);
    const top = [...(byExercise.get(muscle) ?? [])].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
    return { muscle, setsPerWeek: perWeek, level: levelFor(perWeek), lastTrained: last.get(muscle) ?? null, topExercises: top.map(([name, n]) => ({ name, sets: r1(n) })) };
  });
  return { from, to: i.to, weeks: i.weeks, sessions: strength.length, otherSessions: classes.length, range: { ...WEEKLY_SET_RANGE }, muscles };
}

/** The map in a few lines for the model: which muscles are under, in and over the range, with days since last trained. */
export function describeMuscleMap(m: MuscleMap): string {
  const other = m.otherSessions ?? 0;
  if (!m.sessions && !other) return `No finished strength workouts or sessions between ${m.from} and ${m.to}, so every muscle shows as not trained.`;
  const since = (d: Day | null) => (d ? `, last ${dayNumber(m.to) - dayNumber(d)} d ago` : '');
  const group = (level: MuscleLevel) =>
    m.muscles
      .filter((x) => x.level === level)
      .map((x) => `${x.muscle} ${x.setsPerWeek}${since(x.lastTrained)}`)
      .join('; ');
  const lines = [
    `Weekly hard sets per muscle over ${m.weeks} week${m.weeks === 1 ? '' : 's'} (${m.from} to ${m.to}, ${m.sessions} strength workouts${other ? ` and ${other} whole-body session${other === 1 ? '' : 's'}` : ''}); usual range ${m.range.low}–${m.range.high}. A main muscle counts a set as 1, a helping one as 0.5${other ? '; a Pilates, HIIT, CrossFit or similar session gives a rough credit by its length' : ''}.`,
    ['high', 'in_range', 'below', 'none'].map((l) => {
      const label = { high: 'Over the range', in_range: 'In range', below: 'Under the range', none: 'Not trained' }[l as MuscleLevel];
      const list = group(l as MuscleLevel);
      return list ? `${label}: ${list}.` : '';
    }).filter(Boolean).join('\n'),
  ];
  return lines.join('\n');
}
