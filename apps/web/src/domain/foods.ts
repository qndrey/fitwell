import type { Nutrients, Portion } from './nutrition';

/** `bundled` ids look like "frida:123"; `custom` ids are record ids; `off` ids are barcodes (Gate 3). */
export interface FoodRef {
  kind: 'bundled' | 'off' | 'custom';
  id: string;
}

/** A food as the UI and food-log snapshots see it, whatever its source. */
export interface FoodItem {
  ref: FoodRef;
  name: string;
  brand?: string;
  /** Secondary line, e.g. food group. */
  group?: string;
  per100g: Nutrients;
  portions: Portion[];
}

export const refKey = (r: FoodRef): string => `${r.kind}:${r.id}`;
