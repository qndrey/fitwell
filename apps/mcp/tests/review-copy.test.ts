import { describe, expect, it } from 'vitest';
import { CONFIDENCE_WORD, gain, mondayOf, shortName, weekTitle } from '../ui/review/copy';

describe('review copy', () => {
  it('names the confidence of the burn estimate in plain words', () => {
    expect(CONFIDENCE_WORD).toEqual({ high: 'reliable', medium: 'fair', low: 'rough' });
  });
  it('shortens exercise names and shows a record as a gain', () => {
    expect(shortName('Barbell Bench Press - Medium Grip')).toBe('Barbell Bench Press');
    expect(shortName('Dumbbell Curl')).toBe('Dumbbell Curl');
    expect(shortName('Plank (static hold)')).toBe('Plank');
    expect(gain(103.2, 100)).toBe('+3.2 kg');
    expect(gain(65, 60)).toBe('+5 kg');
  });
  it('finds the Monday of a week, across a month end', () => {
    expect(mondayOf('2026-10-21')).toBe('2026-10-19'); // a Wednesday
    expect(mondayOf('2026-10-25')).toBe('2026-10-19'); // the Sunday
    expect(mondayOf('2026-11-01')).toBe('2026-10-26');
  });
  it('says "This week" or "Last week" when the review is one of them', () => {
    expect(weekTitle('2026-10-19', '2026-10-21')).toBe('This week');
    expect(weekTitle('2026-10-12', '2026-10-21')).toBe('Last week');
    expect(weekTitle('2026-10-05', '2026-10-21')).toBeNull();
    expect(weekTitle('2026-10-19', '2026-10-25')).toBe('This week');
    expect(weekTitle('2026-10-26', '2026-10-21')).toBeNull(); // a week that has not started
  });
});
