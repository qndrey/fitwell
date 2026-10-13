import { describe, expect, it } from 'vitest';
import { addDays, dayDiff, isDay, parseDay, toDay, today } from '../../src/domain/dates';

describe('dates (TZ=America/New_York)', () => {
  it('round-trips a day', () => {
    expect(toDay(parseDay('2026-10-09'))).toBe('2026-10-09');
  });
  it('validates days', () => {
    expect(isDay('2026-02-29')).toBe(false);
    expect(isDay('2028-02-29')).toBe(true);
    expect(isDay('2026-1-1')).toBe(false);
  });
  it('adds days across spring-forward (2026-03-08)', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-03-09', -2)).toBe('2026-03-07');
  });
  it('adds days across fall-back (2026-11-01)', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });
  it('counts whole days across DST changes', () => {
    expect(dayDiff('2026-03-01', '2026-03-15')).toBe(14);
    expect(dayDiff('2026-10-25', '2026-11-08')).toBe(14);
    expect(dayDiff('2026-12-31', '2026-01-01')).toBe(-364);
  });
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
  it('uses local time for today, even late at night', () => {
    expect(today(new Date(2026, 5, 1, 23, 59))).toBe('2026-06-01');
    expect(today(new Date(2026, 5, 2, 0, 1))).toBe('2026-06-02');
  });
});
