import type { Quantity } from '../../domain/nutrition';

const num = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
export const fmt = (n: number): string => num.format(n);

export function quantityText(q: Quantity): string {
  return q.unit === 'g' ? `${fmt(q.amount)} g` : `${fmt(q.amount)} × ${q.portionLabel ?? ''}`.trim();
}

/** Picks a sensible default meal for the time of day. */
export function defaultSlot(now = new Date()): 'breakfast' | 'lunch' | 'dinner' | 'snacks' {
  const h = now.getHours();
  if (h < 10) return 'breakfast';
  if (h < 14) return 'lunch';
  if (h < 16) return 'snacks';
  if (h < 21) return 'dinner';
  return 'snacks';
}
