import { describe, expect, it } from 'vitest';
import { calendarRows, crossesYear, fmtDay, niceTicks, rangeLabel } from '../ui/shared/chartMath';

describe('niceTicks', () => {
  it('picks round values inside the range', () => {
    expect(niceTicks(78.5, 83.7, 3)).toEqual([80, 82]);
    expect(niceTicks(0, 100, 4)).toEqual([0, 50, 100]);
    expect(niceTicks(0, 2200, 4)).toEqual([0, 1000, 2000]);
    expect(niceTicks(0.2, 0.9, 6)).toEqual([0.2, 0.4, 0.6, 0.8]);
  });
  it('stays inside the range and keeps the step 1, 2 or 5 times a power of ten', () => {
    for (const [lo, hi] of [[3.2, 9.9], [-4, 7], [1200, 4800], [0.01, 0.05]] as const) {
      const t = niceTicks(lo, hi);
      expect(t.length).toBeGreaterThan(0);
      expect(t[0]!).toBeGreaterThanOrEqual(lo);
      expect(t[t.length - 1]!).toBeLessThanOrEqual(hi);
      const step = t.length > 1 ? Math.round((t[1]! - t[0]!) * 1e9) / 1e9 : 1;
      expect([1, 2, 5]).toContain(Math.round(step / 10 ** Math.floor(Math.log10(step))));
    }
  });
  it('has nothing to say about an empty or backwards range', () => {
    expect(niceTicks(5, 5)).toEqual([]);
    expect(niceTicks(6, 5)).toEqual([]);
  });
});

describe('dates', () => {
  it('formats a day, with the year only when asked', () => {
    expect(fmtDay('2026-11-19')).toBe('19 Nov');
    expect(fmtDay('2026-11-19', true)).toBe('19 Nov 2026');
  });
  it('adds the year to a range that crosses one', () => {
    expect(crossesYear('2026-01-01', '2026-12-31')).toBe(false);
    expect(rangeLabel('2026-10-20', '2026-11-19')).toBe('20 Oct to 19 Nov');
    expect(rangeLabel('2025-11-19', '2026-02-04')).toBe('19 Nov 2025 to 4 Feb 2026');
  });
});

describe('calendarRows', () => {
  it('lays weeks out Monday to Sunday and counts trained days, the heaviest workout of a day winning', () => {
    const rows = calendarRows(['2026-10-12', '2026-10-19'], [{ day: '2026-10-12', type: 'cardio' }, { day: '2026-10-12', type: 'strength' }, { day: '2026-10-14', type: 'session' }, { day: '2026-10-20', type: 'cardio' }], '2026-10-21');
    expect(rows.map((r) => [r.week, r.trained])).toEqual([['2026-10-12', 2], ['2026-10-19', 1]]);
    expect(rows[0]!.cells.map((c) => c.kind)).toEqual(['strength', null, 'session', null, null, null, null]);
    expect(rows[0]!.cells[6]!.day).toBe('2026-10-18');
  });
  it('leaves days after the last day open, and keeps the last 12 weeks', () => {
    const rows = calendarRows(['2026-10-19'], [], '2026-10-21');
    expect(rows[0]!.cells.map((c) => c.future)).toEqual([false, false, false, true, true, true, true]);
    const weeks = Array.from({ length: 14 }, (_, i) => new Date(Date.parse('2026-07-20T00:00:00Z') + i * 7 * 86_400_000).toISOString().slice(0, 10));
    expect(calendarRows(weeks, [], '2026-10-25')).toHaveLength(12);
    expect(calendarRows(weeks, [], '2026-10-25')[11]!.week).toBe(weeks[13]);
  });
});
