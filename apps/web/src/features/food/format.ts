import type { Quantity } from '@fitwell/core/domain/nutrition';
import type { FoodEntry } from '@fitwell/core/schema';
import { looksLikeBarcode } from '@fitwell/core/ean';
import { t } from '../../i18n';

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

/** What to call an entry: its food, its typed text, or "Barcode 1234…" for a scanned code waiting for lookup. */
export function entryLabel(e: Pick<FoodEntry, 'food' | 'queryText'>): string {
  if (e.food) return e.food.name;
  const text = e.queryText ?? '';
  return looksLikeBarcode(text) ? `${t('barcode.label')} ${text}` : text;
}
