import type { Day } from '@fitwell/core/domain/dates';

/** Today's date ('YYYY-MM-DD') in an IANA time zone. Falls back to UTC for an unknown zone. */
export function todayIn(timeZone: string, now: Date = new Date()): Day {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The meal for the local time of day: before 10:30 breakfast, before 15:00 lunch, before 21:00 dinner, else snacks. */
export function slotAt(timeZone: string, now: Date = new Date()): 'breakfast' | 'lunch' | 'dinner' | 'snacks' {
  let hm = now.getUTCHours() * 60 + now.getUTCMinutes();
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    hm = Number(parts.find((p) => p.type === 'hour')!.value) * 60 + Number(parts.find((p) => p.type === 'minute')!.value);
  } catch {
    /* unknown zone: UTC */
  }
  return hm < 630 ? 'breakfast' : hm < 900 ? 'lunch' : hm < 1260 ? 'dinner' : 'snacks';
}
