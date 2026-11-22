// The coach roster (B7): one row per trainee, built from the same reads as list_assignments and get_trainee_food, so it can show nothing they do not.
import { addDays } from '@fitwell/core/domain/dates';
import { type CoachingData, MAX_TRAINEES } from '../data/coaching';
import type { CoachRoster, RosterTrainee } from './coachTypes';

/** How far back the roster looks at assigned workouts. */
export const ROSTER_DAYS = 28;

export async function buildRoster(coaching: CoachingData, today: string): Promise<CoachRoster> {
  const { asCoach } = await coaching.list();
  const programs = await coaching.programsByMe();
  const since = addDays(today, -(ROSTER_DAYS - 1));
  const trainees: RosterTrainee[] = [];
  for (const c of asCoach) {
    const base = { coachingId: c.coachingId, who: c.with, status: c.status, since: c.since, shareResults: c.shareResults, shareFood: c.shareFood, targetsWaiting: c.proposedTargets !== null };
    if (c.status === 'pending') {
      trainees.push({ ...base, workouts: { assigned: 0, done: 0, skipped: 0, waiting: 0, overdue: 0, adherencePct: null }, lastDone: null, next: null, program: null, food: null });
      continue;
    }
    const all = await coaching.assignedByMe(c.coachingId, 100);
    const recent = all.filter((a) => a.assignedOn >= since);
    const open = (a: (typeof all)[number]) => a.status === 'assigned' || a.status === 'started';
    const done = recent.filter((a) => a.status === 'done').length;
    const skipped = recent.filter((a) => a.status === 'skipped').length;
    const overdue = recent.filter((a) => open(a) && a.dueOn !== null && a.dueOn < today).length;
    const due = done + skipped + overdue;
    const soonest = all.filter(open).sort((a, b) => (a.dueOn ?? '9999-12-31').localeCompare(b.dueOn ?? '9999-12-31') || a.assignedOn.localeCompare(b.assignedOn))[0];
    const program = programs.find((p) => p.coachingId === c.coachingId);
    let food: RosterTrainee['food'] = null;
    if (c.shareFood) {
      const f = await coaching.foodFor(c.coachingId, 8); // today plus the 7 finished days before it
      if (f.ok) food = { loggedDays: f.food.average?.loggedDays ?? 0, kcal: f.food.average?.kcal ?? null, goalKcal: f.food.goals.kcal, proteinG: f.food.average?.protein ?? null, goalProteinG: f.food.goals.proteinG };
    }
    trainees.push({
      ...base,
      workouts: { assigned: recent.length, done, skipped, waiting: recent.filter(open).length, overdue, adherencePct: due > 0 ? Math.round((done / due) * 100) : null },
      lastDone: all.filter((a) => a.doneOn).map((a) => a.doneOn!).sort().pop() ?? null,
      next: soonest ? { name: soonest.name, dueOn: soonest.dueOn, started: soonest.status === 'started' } : null,
      program: program ? { name: program.name, status: program.status, sessionsDone: program.sessionsDone, sessionsTotal: program.sessionsTotal } : null,
      food,
    });
  }
  return { today, trainees, limit: MAX_TRAINEES };
}
