import { describe, expect, it } from 'vitest';
import { extrasLine, macroText, NO_LIMITS, subline } from '../ui/food/copy';

describe('food summary copy', () => {
  it('counts the foods instead of joining their names', () => {
    expect(subline('13 Oct', ['lunch'], 2)).toBe('13 Oct · lunch · 2 foods');
    expect(subline('13 Oct', ['breakfast', 'snack'], 1)).toBe('13 Oct · breakfast, snack · 1 food');
  });
  it('puts a unit on macros', () => {
    expect(macroText(240, 150)).toEqual({ value: '240', unit: '/150 g' });
    expect(macroText(1234, null)).toEqual({ value: '1,234', unit: ' g' });
  });
  it('folds the extras into one line, with ≥ for minimums and – for unknown', () => {
    expect(extrasLine({ satFat: 4.1, sugar: 30, fiber: 12.34, salt: 1 }, ['sugar'])).toBe('Sat. fat 4.1 g · Trans fat – · Sugar ≥30 g · Added sugar – · Fiber 12.3 g · Salt 1 g');
    expect(NO_LIMITS).toBe('No limits set. Ask Claude to set fibre or sugar goals.');
  });
});
