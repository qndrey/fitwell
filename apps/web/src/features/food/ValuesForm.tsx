import { useState } from 'preact/hooks';
import { parseAmount, type Nutrients } from '@fitwell/core/domain/nutrition';
import { Button, Field, TextInput } from '../../ui';
import { t } from '../../i18n';

/** Totals for the logged amount, typed by hand. Calories are required; macros default to 0. */
export function ValuesForm({ initial, submitLabel, onSubmit }: { initial?: Nutrients; submitLabel: string; onSubmit: (n: Nutrients) => void }) {
  const [v, setV] = useState({
    kcal: initial ? String(Math.round(initial.kcal)) : '',
    protein: initial ? String(initial.protein) : '',
    carbs: initial ? String(initial.carbs) : '',
    fat: initial ? String(initial.fat) : '',
  });
  const [err, setErr] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (e: Event) => (setV({ ...v, [k]: (e.target as HTMLInputElement).value }), setErr({}));
  const field = (k: keyof typeof v, label: string) => (
    <Field label={label} error={err[k]} class="grow">
      {(c) => <TextInput {...c} inputMode="decimal" autocomplete="off" value={v[k]} onInput={set(k)} />}
    </Field>
  );
  return (
    <form
      class="stack gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const errors: Record<string, string> = {};
        const kcal = parseAmount(v.kcal);
        if (kcal === null) errors.kcal = t('custom.numberError');
        const macro = (k: 'protein' | 'carbs' | 'fat') => {
          if (v[k].trim() === '') return 0;
          const n = parseAmount(v[k]);
          if (n === null) errors[k] = t('custom.numberError');
          return n ?? 0;
        };
        const [protein, carbs, fat] = [macro('protein'), macro('carbs'), macro('fat')];
        setErr(errors);
        if (Object.keys(errors).length === 0) onSubmit({ kcal: kcal!, protein, carbs, fat });
      }}
    >
      {field('kcal', t('unit.kcal'))}
      <div class="field-row">
        {field('protein', `${t('macro.protein')} (g)`)}
        {field('carbs', `${t('macro.carbs')} (g)`)}
        {field('fat', `${t('macro.fat')} (g)`)}
      </div>
      <div class="sticky-action">
        <Button type="submit" variant="primary" block>{submitLabel}</Button>
      </div>
    </form>
  );
}
