// The cron job behind the email digests (E1): once an hour it looks at each person who turned a digest on and sends what is due in their own local time.
// Weekly summary: Sunday evening, once a week. Nudge: after 3 or more days without a log, in the evening, once per lapse (not again until they log and lapse anew).
import { dayNumber, weekStart } from '@fitwell/core/domain/dates';
import type { Day } from '@fitwell/core/domain/dates';
import { loadProgress } from '../analytics/load';
import { loadStreaks } from '../analytics/streaks';
import type { Mailer } from '../auth/mailer';
import { BodyData } from '../data/bodyData';
import { claim, recipients, release, type DigestKind } from '../data/digests';
import { todayIn } from '../data/time';
import { UserData } from '../data/userData';
import { WorkoutData } from '../data/workoutData';
import { nudgeMail, quietWeek, unsubscribeUrl, weeklyMail } from './compose';

/** Local evening: digests go out from 18:00 to 21:59, so a missed hourly run is made up within the evening and nothing arrives at night. */
export const SEND_FROM_HOUR = 18;
export const SEND_UNTIL_HOUR = 22;
export const NUDGE_AFTER_DAYS = 3;
/** Nobody who has not logged anything for this long is nudged: that is a person who left, not one who is taking a few days off. */
export const NUDGE_UNTIL_DAYS = 45;

export interface DigestDeps {
  db: D1Database;
  mailer: Mailer;
  publicUrl: string;
  now?: () => number;
  /** Addresses that never get email (the reviewers' demo account, the local dev person). */
  skip?: (email: string) => boolean;
}

export interface DigestRun {
  weekly: number;
  nudge: number;
  failed: number;
}

/** The person's local hour and weekday (0 = Sunday) at `now`. */
function localClock(timeZone: string, now: number): { hour: number; weekday: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(now));
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')?.value ?? 'Sun');
    return { hour, weekday };
  } catch {
    return { hour: 0, weekday: 1 }; // an unknown zone gets nothing rather than something at the wrong time
  }
}

export async function runDigests(deps: DigestDeps): Promise<DigestRun> {
  const now = deps.now?.() ?? Date.now();
  const out: DigestRun = { weekly: 0, nudge: 0, failed: 0 };
  let people: Awaited<ReturnType<typeof recipients>>;
  try {
    people = await recipients(deps.db);
  } catch (e) {
    // The list could not be read (for instance the migration is not applied yet): say so and stop, rather than failing the whole run every hour.
    console.error('digest recipients', e instanceof Error ? e.message : String(e));
    return { ...out, failed: 1 };
  }
  for (const r of people) {
    if (deps.skip?.(r.email)) continue;
    try {
      const data = new UserData(deps.db, r.id);
      const profile = await data.profile();
      const { hour, weekday } = localClock(profile.timeZone, now);
      if (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) continue;
      const today = todayIn(profile.timeZone, new Date(now));
      const workouts = new WorkoutData(deps.db, r.id);
      const body = new BodyData(deps.db, r.id);
      const send = async (kind: DigestKind, period: string, build: () => Promise<{ to: string; subject: string; text: string; html: string; headers?: Record<string, string> } | null>) => {
        if (!(await claim(deps.db, r.id, kind, period, now))) return;
        try {
          const mail = await build();
          if (!mail) {
            await release(deps.db, r.id, kind, period); // nothing to say: nothing is recorded, so a later run in the window may still have something
            return;
          }
          await deps.mailer.send(mail);
          out[kind === 'weekly' ? 'weekly' : 'nudge']++;
        } catch (e) {
          await release(deps.db, r.id, kind, period); // retried by the next hourly run while the evening lasts
          throw e;
        }
      };
      if (r.weekly && weekday === 0) {
        const monday = weekStart(today);
        await send('weekly', monday, async () => {
          const progress = await loadProgress({ data, workouts, body }, 7, today);
          if (quietWeek(progress)) return null;
          const { result } = await loadStreaks({ data, workouts, body });
          const url = unsubscribeUrl(deps.publicUrl, r.id, r.token, 'weekly');
          return weeklyMail({ to: r.email, progress, streaks: { trainingWeeks: result.training.status === 'ok' ? result.training.streak.current : 0, loggingDays: result.loggingDays.current }, url });
        });
      }
      if (r.nudge) {
        const last = await lastLogDay(deps.db, r.id);
        if (last) {
          const ago = dayNumber(today) - dayNumber(last);
          if (ago >= NUDGE_AFTER_DAYS && ago <= NUDGE_UNTIL_DAYS) {
            await send('nudge', last, async () => nudgeMail({ to: r.email, lastDay: last, today, daysAgo: ago, url: unsubscribeUrl(deps.publicUrl, r.id, r.token, 'nudge') }));
          }
        }
      }
    } catch (e) {
      out.failed++;
      console.error('digest', r.id, e instanceof Error ? e.message : String(e));
    }
  }
  return out;
}

/** The last local day anything was logged: food, a workout or a weigh-in. */
async function lastLogDay(db: D1Database, userId: string): Promise<Day | null> {
  const r = await db
    .prepare('SELECT MAX(d) AS day FROM (SELECT MAX(day) AS d FROM food_entries WHERE user_id = ?1 UNION ALL SELECT MAX(day) FROM workouts WHERE user_id = ?1 UNION ALL SELECT MAX(day) FROM weights WHERE user_id = ?1)')
    .bind(userId)
    .first<{ day: string | null }>();
  return r?.day ?? null;
}

