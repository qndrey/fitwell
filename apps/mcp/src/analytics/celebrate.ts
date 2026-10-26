// Turns the milestones a person has not seen yet into what the celebration view shows (F3).
import { addDays } from '@fitwell/core/domain/dates';
import type { Day } from '@fitwell/core/domain/dates';
import type { Streak } from '@fitwell/core/domain/streaks';
import type { Achievement, AchievementKind } from '../data/achievements';
import type { DayTotal } from '../data/userData';
import type { Workout } from '../data/workoutData';
import type { Celebration } from './celebrationTypes';
import type { LoadedStreaks } from './streaks';

/** A milestone older than this is not announced as news; it is marked seen without a view. */
export const RECENT_DAYS = 7;

const ORDER: AchievementKind[] = ['goal_weight', 'training_weeks', 'logging_weeks', 'logging_days', 'protein_days'];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The milestones to show now: per streak the highest one reached in the last week that has not been shown, in a fixed order. */
export function toCelebrate(unseen: Achievement[], today: Day): Achievement[] {
  const since = addDays(today, -(RECENT_DAYS - 1));
  const best = new Map<AchievementKind, Achievement>();
  for (const a of unseen) {
    if (a.achievedAt < since || a.achievedAt > today) continue;
    const held = best.get(a.kind);
    if (!held || a.threshold > held.threshold) best.set(a.kind, a);
  }
  return ORDER.flatMap((k) => (best.has(k) ? [best.get(k)!] : []));
}

const counted = (w: Workout) => (w.type === 'strength' ? w.finishedAt !== null : w.type === 'cardio' || w.session !== null);
const doneSets = (w: Workout) => (w.type === 'strength' && w.finishedAt !== null ? w.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done !== false).length, 0) : 0);

function took(kind: AchievementKind, from: Day, to: Day, workouts: Workout[], food: DayTotal[]): Celebration['took'] {
  const inRange = (d: Day) => d >= from && d <= to;
  const ws = workouts.filter((w) => inRange(w.day) && counted(w));
  const days = food.filter((d) => inRange(d.day));
  if (kind === 'training_weeks') {
    const sets = ws.reduce((n, w) => n + doneSets(w), 0);
    return [{ label: 'Workouts', value: ws.length }, ...(sets > 0 ? [{ label: 'Sets', value: sets }] : [])];
  }
  if (kind === 'goal_weight') return [];
  const meals = days.reduce((n, d) => n + d.entries, 0);
  return [{ label: 'Days logged', value: days.length }, { label: 'Entries', value: meals }];
}

function text(kind: AchievementKind, n: number, streak: Streak | null): { title: string; detail: string | null } {
  const target = streak?.running.target ?? 0;
  switch (kind) {
    case 'training_weeks':
      return { title: `${plural(n, 'week')} of training`, detail: target > 0 ? `${plural(target, 'workout')} or more each week` : null };
    case 'logging_days':
      return { title: `${plural(n, 'day')} of logging`, detail: 'Food logged every day' };
    case 'logging_weeks':
      return { title: `${plural(n, 'week')} of logging`, detail: target > 0 ? `${plural(target, 'day')} or more logged each week` : null };
    case 'protein_days':
      return { title: `${plural(n, 'day')} at your protein goal`, detail: 'At least 90 % of the goal each day' };
    case 'goal_weight':
      return { title: 'Goal weight reached', detail: 'Seven days in a row at your goal, by the trend' };
  }
}

export function buildCelebrations(shown: Achievement[], loaded: LoadedStreaks): Celebration[] {
  const { result, workouts, food } = loaded;
  const streakOf = (kind: AchievementKind): Streak | null => {
    const optional = kind === 'training_weeks' ? result.training : kind === 'protein_days' ? result.proteinDays : null;
    if (optional) return optional.status === 'ok' ? optional.streak : null;
    return kind === 'logging_days' ? result.loggingDays : kind === 'logging_weeks' ? result.loggingWeeks : null;
  };
  return shown.map((a): Celebration => {
    const streak = streakOf(a.kind);
    // The run may have ended since the milestone was recorded: then there is no start day and no next milestone.
    const live = streak !== null && streak.current >= a.threshold && streak.startedOn !== null;
    return {
      kind: a.kind,
      threshold: a.threshold,
      achievedAt: a.achievedAt,
      ...text(a.kind, a.threshold, streak),
      atLeast: live && streak.atLeast,
      took: live ? took(a.kind, streak.startedOn!, a.achievedAt, workouts, food) : [],
      next: live ? { ...streak.next, unit: streak.unit } : null,
    };
  });
}
