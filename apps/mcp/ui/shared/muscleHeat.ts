// The colour of each muscle level on the body model and in the lists. Pure (no DOM), so the tests can reach it.
import type { MuscleLevel } from '../../src/analytics/muscleTypes';

/**
 * One colour per level, readable on the skin tone in either theme; never the only signal (the lists say the level in words).
 * "Under the range" is a neutral grey, darker than "not trained": being under is not a warning and not a good sign.
 */
export const HEAT: Record<'light' | 'dark', Record<MuscleLevel, number>> = {
  light: { none: 0xc4bfb7, below: 0x6f6a63, in_range: 0x2e9a5a, high: 0xd8402a },
  dark: { none: 0x77726b, below: 0xa8a29a, in_range: 0x4cc47e, high: 0xff6a52 },
};
