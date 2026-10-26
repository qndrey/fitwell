// The colours of one workout on the body figure and in the muscle list beside it. Pure (no DOM), so the tests can reach it.
// One hue only: the muscles that took the most are the strongest, so no colour says good or bad (unlike the weekly muscle map's
// under / in range / over). The numbers are in the list, so colour is never the only signal.

/** Skin and tint of the figure, as in the motion player's palette (`ui/shared/motionView.ts`). A muscle at 0 sets keeps the skin. */
const SKIN = { light: 0xd9b8a0, dark: 0xbf9a83 };
const TINT = { light: 0xe4572e, dark: 0xff7a4d };
/** How far from the skin to the tint, for each level 1 (a little) to 4 (the most). */
const MIX = [0.3, 0.5, 0.75, 1];

/** 1 to 4 by the share of the muscle that took the most sets; 0 for no sets. */
export const sessionLevel = (sets: number, top: number): number => (sets <= 0 || top <= 0 ? 0 : Math.min(4, Math.ceil((sets / top) * 4)));

const channel = (a: number, b: number, t: number, shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);

export function sessionColour(level: number, dark: boolean): number {
  const skin = SKIN[dark ? 'dark' : 'light'];
  if (level <= 0) return skin;
  const tint = TINT[dark ? 'dark' : 'light'];
  const t = MIX[Math.min(4, level) - 1]!;
  return (channel(skin, tint, t, 16) << 16) | (channel(skin, tint, t, 8) << 8) | channel(skin, tint, t, 0);
}

export const cssHex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export interface SessionMuscle {
  muscle: string;
  sets: number;
}

/** A hex colour for each muscle that took sets, by the share of the top one; the rest keep the skin on the figure. */
export function sessionColours(muscles: SessionMuscle[], dark: boolean): Map<string, number> {
  const top = Math.max(0, ...muscles.map((m) => m.sets));
  return new Map(muscles.filter((m) => m.sets > 0).map((m) => [m.muscle, sessionColour(sessionLevel(m.sets, top), dark)]));
}

/** The muscles you mainly see from behind; the figure is seen from one side at a time. */
const BACK = new Set(['lats', 'middle back', 'lower back', 'traps', 'glutes', 'hamstrings', 'triceps', 'calves']);

/** The side of the figure to open on: the one that shows more of the sets of this workout (the front on a tie). */
export function defaultSide(muscles: SessionMuscle[]): 'front' | 'back' {
  const back = muscles.filter((m) => BACK.has(m.muscle)).reduce((n, m) => n + m.sets, 0);
  const total = muscles.reduce((n, m) => n + m.sets, 0);
  return back > total - back ? 'back' : 'front';
}

/** The figure needs three muscle groups to say more than the list does. */
export const FIGURE_MIN_MUSCLES = 3;
/** The list shows this many muscles, the rest behind "+n more". */
export const LIST_SHOWN = 4;
