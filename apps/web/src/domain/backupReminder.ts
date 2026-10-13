const DAY = 86_400_000;

export interface ReminderInput {
  now: number;
  /** Time of the first record the user ever created; undefined means there is nothing to protect yet. */
  firstDataAt: number | undefined;
  lastBackupAt: number | undefined;
  dismissedAt: number | undefined;
  everyDays: number;
}

/** Gentle nudge: only when there is data, the last backup (or first data) is old, and not snoozed in the last week. */
export function backupReminderDue(i: ReminderInput): boolean {
  if (i.firstDataAt === undefined) return false;
  const since = i.lastBackupAt ?? i.firstDataAt;
  if (i.now - since < i.everyDays * DAY) return false;
  if (i.dismissedAt !== undefined && i.now - i.dismissedAt < 7 * DAY) return false;
  return true;
}
