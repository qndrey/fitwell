import { useState } from 'preact/hooks';
import type { FoodItem } from '../../domain/foods';
import { parseAmount, quantityGrams, roundForDisplay, scale, type Quantity } from '../../domain/nutrition';
import { settings } from '../../state';
import { t } from '../../i18n';
import { fmt } from './format';

export function defaultQuantity(food: FoodItem): Quantity {
  const p = food.portions[0];
  return p ? { amount: 1, unit: 'portion', portionLabel: p.label } : { amount: 100, unit: 'g' };
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

  const amount = parseAmount(text);
  const quantity: Quantity | null =
    amount && amount > 0 ? (unit === 'g' ? { amount, unit: 'g' } : { amount, unit: 'portion', portionLabel: unit }) : null;
  const preview = quantity ? roundForDisplay(scale(food.per100g, quantityGrams(quantity, food.portions))) : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!quantity) return setError(t('food.amountError'));
        onSubmit(quantity);
      }}
    >
      <div class="field-row">
        <div class="field grow">
          <label for="qty-amount">{t('food.amount')}</label>
          <input
            id="qty-amount"
            type="text"
            inputMode="decimal"
            autocomplete="off"
            value={text}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'qty-error' : undefined}
            onInput={(e) => {
              setText((e.target as HTMLInputElement).value);
              setError('');
            }}
            onFocus={(e) => (e.target as HTMLInputElement).select()}
          />
        </div>
        <div class="field">
          <label for="qty-unit">{t('food.unit')}</label>
          {food.portions.length > 0 ? (
            <select id="qty-unit" value={unit} onChange={(e) => setUnit((e.target as HTMLSelectElement).value)}>
              <option value="g">g</option>
              {food.portions.map((p) => (
                <option key={p.label} value={p.label}>{`${p.label} (${fmt(p.grams)} g)`}</option>
              ))}
            </select>
          ) : (
            <input id="qty-unit" value="g" readOnly aria-readonly="true" size={3} />
          )}
        </div>
      </div>
      <div class="quick" role="group" aria-label={t('food.quick')}>
        {(unit === 'g' ? [50, 100, 150, 200, 250] : [0.5, 1, 2, 3]).map((n) => (
          <button
            key={n}
            type="button"
            class="btn small"
            aria-pressed={amount === n}
            onClick={() => {
              setText(String(n));
              setError('');
            }}
          >
            {n}
          </button>
        ))}
      </div>
      {error && <p id="qty-error" class="field-error">{error}</p>}
      {preview && !settings.value.habitOnly && (
        <p class="preview" aria-live="polite">
          {preview.kcal} {t('unit.kcal')} · {t('macro.protein.short')} {fmt(preview.protein)} g · {t('macro.carbs.short')} {fmt(preview.carbs)} g · {t('macro.fat.short')} {fmt(preview.fat)} g
        </p>
      )}
      <div class="sticky-action"><button type="submit" class="btn primary wide">{submitLabel}</button></div>
    </form>
  );
}
