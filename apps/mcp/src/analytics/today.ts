// The Today view's data (D3): one read that every one-tap action also returns fresh.
import { addDays, weekStart } from '@fitwell/core/domain/dates';
import { sum } from '@fitwell/core/domain/nutrition';
import type { BodyData } from '../data/bodyData';
import type { PlanData } from '../data/planData';
import { slotAt, todayIn } from '../data/time';
import type { UserData } from '../data/userData';
import type { WorkoutData } from '../data/workoutData';
import { SLOT_NAMES } from '../planning/check';
import type { TodayMeal, TodayView } from './todayTypes';

export interface TodayDeps {
  data: UserData;
  plans: PlanData;
  workouts: WorkoutData;
  body: BodyData;
}

export const QUICK_ADD_DAYS = 45;
export const QUICK_ADD_SHOWN = 6;
const DAY_MS = 86_400_000;

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

export async function buildToday(deps: TodayDeps, now: Date = new Date()): Promise<TodayView> {
  const profile = await deps.data.profile();
  const day = todayIn(profile.timeZone, now);
  const [goals, entries, plan, metrics, workouts, templates, candidates] = await Promise.all([
    deps.data.goals(),
    deps.data.foodEntries(day),
    deps.plans.plan(weekStart(day)),
    deps.body.metricsOn(day),
    deps.workouts.between(day, day),
    deps.workouts.templates(),
    deps.data.quickAddCandidates(addDays(day, -QUICK_ADD_DAYS), addDays(day, -0), QUICK_ADD_SHOWN * 3),
  ]);
  const eaten = sum(entries);

  const planned: TodayMeal[] = SLOT_NAMES.flatMap((slot) => {
    const items = (plan?.items ?? []).filter((i) => i.day === day && i.slot === slot);
    if (!items.length) return [];
    return [{ slot, items: items.map((i) => ({ name: i.name, kcal: r0(i.kcal), logged: i.loggedAt !== undefined })), kcal: r0(items.reduce((n, i) => n + i.kcal, 0)), allLogged: items.every((i) => i.loggedAt !== undefined) }];
  });

  // Foods to log again: not for anything that matches an allergy word (by name, as the other quick ways of logging check).
  const allergies = profile.diet.allergies.map((a) => a.trim().toLowerCase()).filter(Boolean);
  const quickAdd = candidates
    .filter((e) => !allergies.some((a) => e.foodName.toLowerCase().includes(a)))
    .slice(0, QUICK_ADD_SHOWN)
    .map((e) => ({ entryId: e.id, name: e.foodName, grams: r0(e.grams), kcal: r0(e.kcal), protein: r1(e.protein), estimated: e.estimated }));

  const doneToday = workouts
    .filter((w) => w.type !== 'strength' || w.finishedAt !== null)
    .map((w) => ({
      name: w.name ?? (w.type === 'strength' ? 'Strength workout' : w.type === 'cardio' ? (w.cardio?.activityName ?? 'Cardio') : (w.session?.category ?? 'Session')),
      type: w.type,
      minutes: w.type === 'strength' ? (w.startedAt && w.finishedAt && w.finishedAt > w.startedAt ? Math.max(1, r0((w.finishedAt - w.startedAt) / 60_000)) : null) : r0((w.cardio?.durationMin ?? w.session?.durationMin ?? 0)) || null,
    }));
  // A suggestion, not a plan: the saved workout that has waited longest.
  const sorted = [...templates].sort((a, b) => (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0));
  const next = sorted[0];
  const suggested = next ? { name: next.name, daysSince: next.lastUsedAt === null ? null : Math.max(0, Math.floor((now.getTime() - next.lastUsedAt) / DAY_MS)) } : null;

  return {
    day,
    slot: slotAt(profile.timeZone, now),
    goals: { kcal: goals?.kcal ?? null, proteinG: goals?.proteinG ?? null },
    eaten: { kcal: r0(eaten.kcal), protein: r1(eaten.protein), carbs: r1(eaten.carbs), fat: r1(eaten.fat) },
    remaining: { kcal: goals?.kcal != null ? r0(goals.kcal - eaten.kcal) : null, protein: goals?.proteinG != null ? r1(goals.proteinG - eaten.protein) : null },
    planned,
    quickAdd,
    waterMl: metrics?.waterMl ?? 0,
    steps: metrics?.steps ?? null,
    training: { doneToday, suggested },
  };
}
