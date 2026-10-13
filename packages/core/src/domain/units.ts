export type UnitSystem = 'metric' | 'imperial';

const LB_PER_KG = 2.2046226218;
const MI_PER_KM = 0.6213711922;

export const cmToIn = (cm: number): number => cm / 2.54;
export const inToCm = (inch: number): number => inch * 2.54;
export const lengthUnit = (u: UnitSystem): string => (u === 'metric' ? 'cm' : 'in');
export const displayLength = (cm: number, u: UnitSystem): number => Math.round((u === 'metric' ? cm : cmToIn(cm)) * 10) / 10;
export const toCm = (value: number, u: UnitSystem): number => (u === 'metric' ? value : inToCm(value));

export const kgToLb = (kg: number): number => kg * LB_PER_KG;
export const lbToKg = (lb: number): number => lb / LB_PER_KG;
export const kmToMi = (km: number): number => km * MI_PER_KM;
export const miToKm = (mi: number): number => mi / MI_PER_KM;

export const weightUnit = (u: UnitSystem): string => (u === 'metric' ? 'kg' : 'lb');
export const distanceUnit = (u: UnitSystem): string => (u === 'metric' ? 'km' : 'mi');

/** kg (stored) → number in the user's unit, rounded for display (0.1; weights lifted are shown to 0.5 steps by the caller if wanted). */
/**
 * Weight in the user's unit, to 0.1. With `digits: 2` a second decimal survives when it is a plate step
 * (62.25 kg, 1.75 lb) but not unit-conversion noise (60 kg reads 132.3 lb, not 132.28).
 */
export function displayWeight(kg: number, u: UnitSystem, digits: 1 | 2 = 1): number {
  const v = u === 'metric' ? kg : kgToLb(kg);
  const hundredths = Math.round(v * 100);
  return digits === 2 && hundredths % 5 === 0 ? hundredths / 100 : Math.round(v * 10) / 10;
}
export const toKg = (value: number, u: UnitSystem): number => (u === 'metric' ? value : lbToKg(value));

export function displayDistance(km: number, u: UnitSystem): number {
  const v = u === 'metric' ? km : kmToMi(km);
  return Math.round(v * 100) / 100;
}
export const toKm = (value: number, u: UnitSystem): number => (u === 'metric' ? value : miToKm(value));
