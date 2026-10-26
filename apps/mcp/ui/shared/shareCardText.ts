// What a share card (F4) carries and how it is laid out, without any drawing: `cardText` is the one place that decides what is on it, so the
// preview, the saved image and the text alternative cannot differ. No DOM here, so the server's tests can import it.
import type { Celebration } from '../../src/analytics/celebrationTypes';

export const FORMATS = {
  feed: { width: 1080, height: 1350, label: 'Feed 4:5' },
  story: { width: 1080, height: 1920, label: 'Story 9:16' },
  square: { width: 1080, height: 1080, label: 'Square 1:1' },
} as const;
export type CardFormat = keyof typeof FORMATS;

export interface CardOptions {
  format: CardFormat;
  theme: 'light' | 'dark';
  /** Off by default: the card carries a name only when the person turns it on and types one. */
  showName: boolean;
  name: string;
  showDate: boolean;
  /** Which of the milestone's "what it took" numbers go on the card, by index. */
  numbers: boolean[];
  /** Off by default and only for the goal weight: the one card that can carry a body weight. */
  showGoalWeight: boolean;
  /** The small "Fitwell" line, which the person can remove. */
  showBrand: boolean;
}

export const defaultOptions = (c: Celebration): CardOptions => ({
  format: 'feed',
  theme: 'light',
  showName: false,
  name: '',
  showDate: true,
  numbers: c.took.map(() => true),
  showGoalWeight: false,
  showBrand: true,
});

export interface CardContent {
  /** The number in the ring, or null for the tick of the goal weight. */
  big: string | null;
  title: string;
  detail: string | null;
  lines: string[];
  name: string | null;
  brand: string | null;
}

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDay = (d: string) => `${Number(d.slice(8, 10))} ${months[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const kg = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} kg`;

/** Exactly the words the card carries. A body weight is here only when the person asked for it on this card. */
export function cardText(c: Celebration, o: CardOptions): CardContent {
  const lines: string[] = [];
  c.took.forEach((t, i) => {
    if (o.numbers[i]) lines.push(`${t.value} ${t.label.toLowerCase()}`);
  });
  if (o.showGoalWeight && c.kind === 'goal_weight' && c.goalKg !== null) lines.push(`Goal ${kg(c.goalKg)}`);
  if (o.showDate) lines.push(longDay(c.achievedAt));
  const name = o.showName && o.name.trim() !== '' ? o.name.trim().slice(0, 40) : null;
  return {
    big: c.kind === 'goal_weight' ? null : `${c.atLeast ? '≥' : ''}${c.threshold}`,
    title: c.atLeast ? `At least ${c.title}` : c.title,
    detail: c.detail,
    lines,
    name,
    brand: o.showBrand ? 'Fitwell' : null,
  };
}

/** The card as one sentence, for the canvas's text alternative. */
export const describeCard = (content: CardContent) =>
  [content.title, content.detail, ...content.lines, content.name, content.brand].filter((s): s is string => Boolean(s)).join('. ');
