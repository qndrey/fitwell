// What the coach roster view draws (B7): each trainee with how the assigned work is going. Only what the trainee's choices allow:
// status counts and days of assigned workouts and programs always; daily food totals only when they share food. Never what anyone ate or lifted.
export interface RosterPerson {
  /** A trainee is shown by nickname when they have one (then no email), else by email. Text from another person. */
  nickname: string | null;
  email: string | null;
}

export interface RosterTrainee {
  /** What list_assignments, get_trainee_food and the other coaching tools take. */
  coachingId: string;
  who: RosterPerson;
  /** pending: the offer has not been answered. */
  status: 'pending' | 'active';
  since: string;
  shareResults: boolean;
  shareFood: boolean;
  /** Assigned workouts of the last 28 days. adherencePct is done over (done + skipped + overdue): what has come due; null when nothing has. */
  workouts: { assigned: number; done: number; skipped: number; waiting: number; overdue: number; adherencePct: number | null };
  /** The day the last assigned workout was finished. */
  lastDone: string | null;
  /** The soonest assigned workout that is not finished (by day, then by when it was assigned). */
  next: { name: string; dueOn: string | null; started: boolean } | null;
  program: { name: string; status: 'waiting' | 'running' | 'ended' | 'skipped'; sessionsDone: number | null; sessionsTotal: number } | null;
  /** Only when the trainee shares food: the last 7 finished days. */
  food: { loggedDays: number; kcal: number | null; goalKcal: number | null; proteinG: number | null; goalProteinG: number | null } | null;
  /** Targets this coach proposed that the trainee has not answered. */
  targetsWaiting: boolean;
}

export interface CoachRoster {
  /** The coach's own day. */
  today: string;
  trainees: RosterTrainee[];
  /** The most trainees a coach can have. */
  limit: number;
}
