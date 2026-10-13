import { signal } from '@preact/signals';
import { latestMeasurementDay, latestWeight, listMeasurementTypes } from '../../db/bodyStore';
import { onChange } from '../../db/broadcast';
import type { MeasurementType, WeightEntry } from '../../db/schema';

/** The most recent logged weight (drives calorie estimates), the measurement types, and when you last measured. */
export const latestWeightEntry = signal<WeightEntry | undefined>(undefined);
export const measurementTypes = signal<MeasurementType[]>([]);
export const lastMeasurementDay = signal<string | undefined>(undefined);

export function watchBody(): () => void {
  let live = true;
  const load = () => {
    void latestWeight().then((w) => live && (latestWeightEntry.value = w));
    void listMeasurementTypes().then((l) => live && (measurementTypes.value = l));
    void latestMeasurementDay().then((d) => live && (lastMeasurementDay.value = d));
  };
  load();
  const off = onChange((c) => {
    if (['weightEntries', 'measurementTypes', 'measurementEntries'].includes(c.store)) load();
  });
  return () => {
    live = false;
    off();
  };
}
