const DAY = 86_400_000;
const WEEK = 7 * DAY;

export interface MeasurementReminderInput {
  now: number;
  /** Calendar day (YYYY-MM-DD) of the latest measurements, if any. */
  lastDay: string | undefined;
  everyWeeks: number | undefined;
  dismissedAt: number | undefined;
}

/**
 * A quiet nudge only: you chose an interval, you have measured before, it has been that long, and you haven't
 * said "not now" in the last three days. Newcomers with no measurements are never nagged.
 */
export function measurementReminderDue(i: MeasurementReminderInput): boolean {
  if (!i.everyWeeks || !i.lastDay) return false;
  const [y, m, d] = i.lastDay.split('-').map(Number);
  const last = new Date(y!, m! - 1, d!).getTime();
  if (i.now - last < i.everyWeeks * WEEK) return false;
  if (i.dismissedAt !== undefined && i.now - i.dismissedAt < 3 * DAY) return false;
  return true;
}

/** Calm wording for how far a weight is from a goal; never "ahead" or "behind". */
export function distanceFromGoal(currentKg: number, goalKg: number): number {
  return Math.abs(currentKg - goalKg);
}
