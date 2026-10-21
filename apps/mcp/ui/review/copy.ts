// Wording and week arithmetic for the weekly review. Pure (no DOM), so the tests can reach it.
export type Confidence = 'low' | 'medium' | 'high';

/** What the energy estimate's confidence means to a person, in one word. */
export const CONFIDENCE_WORD: Record<Confidence, string> = { high: 'reliable', medium: 'fair', low: 'rough' };

/** "Barbell Bench Press - Medium Grip" → "Barbell Bench Press": the variant after the dash is noise in a tile. */
export const shortName = (name: string) => name.split(' - ')[0]!.replace(/\s*\(.*\)\s*$/, '').trim();

const DAY = 86_400_000;
const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY);
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** The Monday of the week that contains `day`. */
export const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

/** "This week" or "Last week" when the review is one of them, else null. */
export function weekTitle(weekStart: string, today: string): string | null {
  const diff = dayNumber(mondayOf(today)) - dayNumber(weekStart);
  return diff === 0 ? 'This week' : diff === 7 ? 'Last week' : null;
}

/** A change in kg for a record: "+3.2 kg". */
export const gain = (now: number, before: number) => `+${(Math.round((now - before) * 10) / 10).toLocaleString('en-GB', { maximumFractionDigits: 1 })} kg`;
