// The colours of one workout on the body figure and in the list beside it (ui/shared/sessionHeat.ts): one hue, by the share of the top muscle.
import { describe, expect, it } from 'vitest';
import { cssHex, defaultSide, sessionColour, sessionColours, sessionLevel } from '../ui/shared/sessionHeat';

const luminance = (n: number) => 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);

describe('session levels', () => {
  it('are 1 to 4 by the share of the muscle that took the most sets, and 0 for none', () => {
    expect([0, 1, 2, 3, 4, 6, 8].map((n) => sessionLevel(n, 8))).toEqual([0, 1, 1, 2, 2, 3, 4]);
    expect(sessionLevel(0.5, 8)).toBe(1);
    expect(sessionLevel(3, 0)).toBe(0);
  });
});

describe('session colours', () => {
  it('start at the skin and end at the tint, in either theme, with no colour for good or bad', () => {
    expect(cssHex(sessionColour(0, false))).toBe('#d9b8a0');
    expect(cssHex(sessionColour(4, false))).toBe('#e4572e');
    expect(cssHex(sessionColour(0, true))).toBe('#bf9a83');
    expect(cssHex(sessionColour(4, true))).toBe('#ff7a4d');
  });

  it('move steadily from one level to the next, so a deeper colour always means more sets', () => {
    for (const dark of [false, true]) {
      const steps = [0, 1, 2, 3, 4].map((l) => sessionColour(l, dark));
      expect(new Set(steps).size).toBe(5);
      const lum = steps.map(luminance);
      const moves = lum.slice(1).map((v, i) => Math.sign(v - lum[i]!));
      expect(new Set(moves).size).toBe(1); // monotonic in one direction
    }
  });

  it('colours only the muscles that took sets, by the share of the top one', () => {
    const colours = sessionColours([{ muscle: 'chest', sets: 8 }, { muscle: 'triceps', sets: 4 }, { muscle: 'neck', sets: 0 }], false);
    expect([...colours.keys()]).toEqual(['chest', 'triceps']);
    expect(colours.get('chest')).toBe(sessionColour(4, false));
    expect(colours.get('triceps')).toBe(sessionColour(2, false));
  });
});

describe('the side the figure opens on', () => {
  it('is the side that shows more of the sets, and the front on a tie', () => {
    expect(defaultSide([{ muscle: 'chest', sets: 6 }, { muscle: 'lats', sets: 2 }])).toBe('front');
    expect(defaultSide([{ muscle: 'lats', sets: 5 }, { muscle: 'biceps', sets: 2 }, { muscle: 'hamstrings', sets: 1 }])).toBe('back');
    expect(defaultSide([{ muscle: 'chest', sets: 3 }, { muscle: 'lats', sets: 3 }])).toBe('front');
  });
});
