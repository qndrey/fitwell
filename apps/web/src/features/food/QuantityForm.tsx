import { useState } from 'preact/hooks';
import type { FoodItem } from '@fitwell/core/domain/foods';
import { parseAmount, quantityGrams, roundForDisplay, scale, type Quantity } from '@fitwell/core/domain/nutrition';
import { settings } from '../../state';
import { Button, Field, Icon, TextInput } from '../../ui';
import { t } from '../../i18n';
import { fmt } from './format';

export function defaultQuantity(food: FoodItem): Quantity {
  const p = food.portions[0];
  return p ? { amount: 1, unit: 'portion', portionLabel: p.label } : { amount: 100, unit: 'g' };
}

/** Five-gram steps for grams; halves for portions. */
const stepFor = (unit: string, amount: number) => (unit !== 'g' ? 0.5 : amount >= 50 ? 10 : 5);
const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

/** Quick amounts around the usual serving (the last amount you logged, or 100 g): half, usual, one and a half, double. */
export function presetsFor(unit: string, usual: number): number[] {
  if (unit !== 'g') return [0.5, 1, 1.5, 2];
  const base = usual > 0 ? usual : 100;
  return [...new Set([round5(base / 2), round5(base), round5(base * 1.5), round5(base * 2)])];
}

export function QuantityForm({
  food,
  initial,
  submitLabel,
  onSubmit,
}: {
  food: FoodItem;
  initial: Quantity;
  submitLabel: string;
  onSubmit: (q: Quantity) => void;
}) {
  const [text, setText] = useState(String(initial.amount));
  const [unit, setUnit] = useState(initial.unit === 'g' ? 'g' : (initial.portionLabel ?? 'g'));
  const [error, setError] = useState('');
  const usualGrams = initial.unit === 'g' ? initial.amount : 100;

  const amount = parseAmount(text);
  const quantity: Quantity | null =
    amount && amount > 0 ? (unit === 'g' ? { amount, unit: 'g' } : { amount, unit: 'portion', portionLabel: unit }) : null;
  const preview = quantity ? roundForDisplay(scale(food.per100g, quantityGrams(quantity, food.portions))) : null;
  const set = (n: number) => {
    setText(String(Math.round(n * 100) / 100));
    setError('');
  };
  const nudge = (dir: 1 | -1) => {
    const cur = amount ?? 0;
    const step = stepFor(unit, cur);
    const next = dir > 0 ? Math.floor(cur / step) * step + step : Math.ceil(cur / step) * step - step;
    if (next > 0) set(next);
  };
  const unitLabel = unit === 'g' ? 'g' : unit;

  return (
    <form
      class="stack gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!quantity) return setError(t('food.amountError'));
        onSubmit(quantity);
      }}
    >
      {food.portions.length > 0 && (
        <div class="quick" role="group" aria-label={t('food.unit')}>
          {[{ label: 'g', value: 'g' }, ...food.portions.map((p) => ({ label: `${p.label} · ${fmt(p.grams)} g`, value: p.label }))].map((o) => (
            <Button
              key={o.value}
              size="sm"
              aria-pressed={unit === o.value}
              onClick={() => {
                if (unit === o.value) return;
                setUnit(o.value);
                set(o.value === 'g' ? usualGrams : 1);
              }}
            >
              {o.label}
            </Button>
          ))}
        </div>
      )}
      <Field label={t('food.amount')} error={error}>
        {(c) => (
          <div class="amount-row">
            <Button icon class="outlined" aria-label={t('food.less')} onClick={() => nudge(-1)}><Icon name="minus" /></Button>
            <span class="input-suffix grow">
              <TextInput
                {...c}
                inputMode="decimal"
                autocomplete="off"
                value={text}
                onInput={(e) => {
                  setText((e.target as HTMLInputElement).value);
                  setError('');
                }}
                onFocus={(e) => (e.target as HTMLInputElement).select()}
              />
              <span class="suffix" aria-hidden="true">{unitLabel}</span>
            </span>
            <Button icon class="outlined" aria-label={t('food.more')} onClick={() => nudge(1)}><Icon name="plus" /></Button>
          </div>
        )}
      </Field>
      <div class="quick" role="group" aria-label={t('food.quick')}>
        {presetsFor(unit, usualGrams).map((n) => (
          <Button key={n} size="sm" aria-pressed={amount === n} onClick={() => set(n)}>
            {unit === 'g' ? `${fmt(n)} g` : fmt(n)}
          </Button>
        ))}
      </div>
      {preview && !settings.value.habitOnly && (
        <p class="t-caption" aria-live="polite">
          {preview.kcal} {t('unit.kcal')} · {t('macro.protein.short')} {fmt(preview.protein)} g · {t('macro.carbs.short')} {fmt(preview.carbs)} g · {t('macro.fat.short')} {fmt(preview.fat)} g
        </p>
      )}
      <div class="sticky-action">
        <Button type="submit" variant="primary" block>{submitLabel}</Button>
      </div>
    </form>
  );
}
