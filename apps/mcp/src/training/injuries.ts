// What an injury means for exercises (A11): which muscles an area is loaded through, and which exercises to flag. A flag says "this loads the area" or "you said to avoid this", never
// that an exercise is safe or unsafe: the absence of a flag is not a clearance, and nothing here diagnoses.
import type { Exercise } from '@fitwell/core/data/exercises';

/** The library's muscle groups an area is loaded through (an exercise whose main muscles include one is flagged). `other` has none: only the person's own words flag. */
export const AREA_MUSCLES = {
  neck: ['neck', 'traps'],
  shoulder: ['shoulders', 'chest', 'traps'],
  elbow: ['biceps', 'triceps', 'forearms'],
  wrist: ['forearms'],
  upper_back: ['middle back', 'lats', 'traps'],
  lower_back: ['lower back', 'hamstrings', 'glutes'],
  hip: ['glutes', 'abductors', 'adductors'],
  knee: ['quadriceps', 'hamstrings'],
  ankle: ['calves'],
  other: [],
} as const satisfies Record<string, readonly string[]>;

export type InjuryArea = keyof typeof AREA_MUSCLES;
export const INJURY_AREAS = Object.keys(AREA_MUSCLES) as [InjuryArea, ...InjuryArea[]];

export interface InjuryFlag {
  area: InjuryArea;
  /** In plain words, for the person: "loads the shoulder" or `you said to avoid "overhead"`. */
  why: string;
}

const AREA_NAME: Record<InjuryArea, string> = { neck: 'neck', shoulder: 'shoulder', elbow: 'elbow', wrist: 'wrist', upper_back: 'upper back', lower_back: 'lower back', hip: 'hip', knee: 'knee', ankle: 'ankle', other: 'area you mentioned' };

/** The phrases of what to avoid: split at commas, semicolons, new lines and "and"; too short ones are left out so a stray letter matches nothing. */
const phrases = (avoid: string) =>
  avoid
    .toLowerCase()
    .split(/[,;\n]| and /)
    .map((p) => p.trim())
    .filter((p) => p.length >= 4);

/** Why an exercise is flagged for these injuries (one flag per injury at most; the person's own words come first). */
export function flagExercise(e: Pick<Exercise, 'name' | 'primary'>, injuries: { area: InjuryArea; avoid: string }[]): InjuryFlag[] {
  const name = e.name.toLowerCase();
  const flags: InjuryFlag[] = [];
  for (const inj of injuries) {
    const said = phrases(inj.avoid).find((p) => name.includes(p));
    if (said) flags.push({ area: inj.area, why: `you said to avoid "${said}"` });
    else if ((AREA_MUSCLES[inj.area] as readonly string[]).some((m) => e.primary.includes(m))) flags.push({ area: inj.area, why: `loads the ${AREA_NAME[inj.area]}` });
  }
  return flags;
}

/** The same list with the exercises that are not flagged first (the order within each part is kept): substitutes rank around the injury. */
export function unflaggedFirst<T extends Pick<Exercise, 'name' | 'primary'>>(list: T[], injuries: { area: InjuryArea; avoid: string }[]): T[] {
  if (!injuries.length) return list;
  const clear = list.filter((e) => flagExercise(e, injuries).length === 0);
  return [...clear, ...list.filter((e) => !clear.includes(e))];
}
