import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { measurementReminderDue, distanceFromGoal } from '../../src/domain/body';
import { cmToIn, displayLength, inToCm, toCm } from '../../src/domain/units';
import { PRESETS, presetId } from '../../src/data/measurements';

describe('measurement reminder', () => {
  const NOW = new Date(2026, 9, 9, 12).getTime();
  const base = { now: NOW, lastDay: '2026-09-18', everyWeeks: 2 as number | undefined, dismissedAt: undefined as number | undefined };
  it('is due once the chosen interval has passed since the last measurements', () => {
    expect(measurementReminderDue(base)).toBe(true); // 3 weeks ago, every 2
    expect(measurementReminderDue({ ...base, lastDay: '2026-09-30' })).toBe(false);
    expect(measurementReminderDue({ ...base, lastDay: '2026-09-25' })).toBe(true); // exactly 2 weeks (+ afternoon)
    expect(measurementReminderDue({ ...base, everyWeeks: 4 })).toBe(false);
  });
  it('never nags: off, never measured, or snoozed in the last three days', () => {
    expect(measurementReminderDue({ ...base, everyWeeks: undefined })).toBe(false);
    expect(measurementReminderDue({ ...base, lastDay: undefined })).toBe(false);
    expect(measurementReminderDue({ ...base, dismissedAt: NOW - 86_400_000 })).toBe(false);
    expect(measurementReminderDue({ ...base, dismissedAt: NOW - 4 * 86_400_000 })).toBe(true);
  });
  it('goal distance is direction-neutral', () => {
    expect(distanceFromGoal(80, 75)).toBe(5);
    expect(distanceFromGoal(70, 75)).toBe(5);
  });
});

describe('lengths', () => {
  it('cm ↔ in without visible drift', () => {
    expect(cmToIn(2.54)).toBeCloseTo(1, 10);
    expect(inToCm(10)).toBeCloseTo(25.4, 10);
    expect(displayLength(toCm(32, 'imperial'), 'imperial')).toBe(32);
    expect(displayLength(81.5, 'metric')).toBe(81.5);
    expect(displayLength(toCm(31.5, 'imperial'), 'imperial')).toBe(31.5);
  });
});

describe('presets', () => {
  it('cover the brief, have unique stable ids and a how-to hint', () => {
    expect(PRESETS.map((p) => p.key)).toEqual(['waist', 'hips', 'chest', 'neck', 'arm-left', 'arm-right', 'thigh-left', 'thigh-right', 'calf-left', 'calf-right', 'body-fat']);
    expect(new Set(PRESETS.map((p) => presetId(p.key))).size).toBe(PRESETS.length);
    for (const p of PRESETS) expect(p.hint.length).toBeGreaterThan(40);
    expect(PRESETS.find((p) => p.key === 'body-fat')!.kind).toBe('percent');
    expect(PRESETS.find((p) => p.key === 'body-fat')!.hint).toMatch(/does not estimate/);
  });
});

vi.mock('../../src/db/open', async (orig) => {
  const real = await orig<typeof import('../../src/db/open')>();
  let p: Promise<unknown> | null = null;
  return { ...real, getDb: () => (p ??= real.openDatabase({ name: 'body-test' })) };
});
const body = await import('../../src/db/bodyStore');

describe('weight store', () => {
  it('one entry per day: logging the same day again replaces it (and keeps one row)', async () => {
    const a = await body.saveWeight('2026-10-01', 80);
    const b = await body.saveWeight('2026-10-01', 79.4);
    expect(b.id).toBe(a.id);
    expect(b.rev).toBe(2);
    expect((await body.weightFor('2026-10-01'))!.kg).toBe(79.4);
    expect((await body.weightRepo.list()).filter((w) => w.day === '2026-10-01')).toHaveLength(1);
  });
  it('latest and previous weights, ignoring deleted ones and later days', async () => {
    await body.saveWeight('2026-10-03', 79);
    await body.saveWeight('2026-10-05', 78.6);
    await body.saveWeight('2026-10-07', 99);
    await body.weightRepo.remove(body.weightId('2026-10-07'));
    expect((await body.latestWeight())!.day).toBe('2026-10-05');
    expect((await body.latestWeight('2026-10-04'))!.kg).toBe(79);
    expect((await body.weightBefore('2026-10-05'))!.day).toBe('2026-10-03');
    expect(await body.weightBefore('2026-10-01')).toBeUndefined();
  });
  it('re-logging a deleted day brings it back', async () => {
    const again = await body.saveWeight('2026-10-07', 78.2);
    expect(again.deletedAt).toBeUndefined();
    expect((await body.latestWeight())!.kg).toBe(78.2);
  });
});

describe('measurement types and entries', () => {
  it('seeds presets once and never overwrites what you changed', async () => {
    await body.ensureMeasurementTypes();
    const first = await body.listMeasurementTypes();
    expect(first.map((m) => m.key)).toEqual(PRESETS.map((p) => p.key));
    expect(first.filter((m) => m.enabled).map((m) => m.key)).toEqual(['waist', 'hips', 'chest']);
    await body.measurementTypesRepo.update(presetId('waist'), { enabled: false });
    await body.measurementTypesRepo.update(presetId('neck'), { enabled: true });
    await body.ensureMeasurementTypes();
    const again = await body.listMeasurementTypes();
    expect(again.find((m) => m.key === 'waist')!.enabled).toBe(false);
    expect(again.find((m) => m.key === 'neck')!.enabled).toBe(true);
    expect(again).toHaveLength(PRESETS.length);
  });
  it('custom types sort after presets and can be removed and restored', async () => {
    const mine = await body.measurementTypesRepo.create({ key: 'custom', label: 'Wrist', kind: 'custom', customUnit: 'mm', enabled: true, preset: false, order: 100 });
    expect((await body.listMeasurementTypes()).at(-1)!.label).toBe('Wrist');
    await body.measurementTypesRepo.remove(mine.id);
    expect((await body.listMeasurementTypes()).some((m) => m.label === 'Wrist')).toBe(false);
    await body.measurementTypesRepo.restore(mine.id);
    expect((await body.listMeasurementTypes()).some((m) => m.label === 'Wrist')).toBe(true);
  });
  it('one set per day, partial values, editing the day updates it', async () => {
    await body.saveMeasurements('2026-10-02', { [presetId('waist')]: 90 });
    const e = await body.saveMeasurements('2026-10-02', { [presetId('waist')]: 89.5, [presetId('hips')]: 101 });
    expect(e.rev).toBe(2);
    expect((await body.measurementsFor('2026-10-02'))!.values).toEqual({ [presetId('waist')]: 89.5, [presetId('hips')]: 101 });
    expect((await body.measurementEntriesRepo.list()).filter((m) => m.day === '2026-10-02')).toHaveLength(1);
  });
  it('last values per type come from the most recent earlier day that had them', async () => {
    await body.saveMeasurements('2026-10-04', { [presetId('waist')]: 88.8 });
    await body.saveMeasurements('2026-10-08', { [presetId('chest')]: 100 });
    const last = await body.lastValues('2026-10-09');
    expect(last[presetId('waist')]).toBe(88.8);
    expect(last[presetId('hips')]).toBe(101);
    expect(last[presetId('chest')]).toBe(100);
    expect((await body.lastValues('2026-10-03'))[presetId('waist')]).toBe(89.5);
    expect(await body.latestMeasurementDay()).toBe('2026-10-08');
  });
});
