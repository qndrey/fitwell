import { useState } from 'preact/hooks';
import { customFoodsRepo } from '../../db/foodStore';
import type { FoodItem } from '../../domain/foods';
import { parseAmount, type Nutrients, type Portion } from '../../domain/nutrition';
import { t } from '../../i18n';

type Basis = 'per100g' | 'perServing';

export function CustomFoodForm({
  initialName,
  onCreated,
  onCancel,
}: {
  initialName: string;
  onCreated: (food: FoodItem) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [basis, setBasis] = useState<Basis>('per100g');
  const [v, setV] = useState({ kcal: '', protein: '', carbs: '', fat: '', serving: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (e: Event) => setV({ ...v, [k]: (e.target as HTMLInputElement).value });

  async function submit(e: Event) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = t('custom.nameError');
    const kcal = parseAmount(v.kcal);
    if (kcal === null) errs.kcal = t('custom.numberError');
    const macro = (s: string, k: string) => {
      if (s.trim() === '') return 0;
      const n = parseAmount(s);
      if (n === null) errs[k] = t('custom.numberError');
      return n ?? 0;
    };
    const [protein, carbs, fat] = [macro(v.protein, 'protein'), macro(v.carbs, 'carbs'), macro(v.fat, 'fat')];
    const serving = v.serving.trim() === '' ? null : parseAmount(v.serving);
    if (basis === 'perServing' && !(serving && serving > 0)) errs.serving = t('custom.servingError');
    else if (v.serving.trim() !== '' && !(serving && serving > 0)) errs.serving = t('custom.servingError');
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const given: Nutrients = { kcal: kcal!, protein, carbs, fat };
    const k = basis === 'perServing' ? 100 / serving! : 1;
    const per100g: Nutrients = { kcal: given.kcal * k, protein: given.protein * k, carbs: given.carbs * k, fat: given.fat * k };
    const portions: Portion[] = serving ? [{ label: t('custom.serving'), grams: serving }] : [];
    const rec = await customFoodsRepo.create({ name: name.trim(), per100g, portions });
    onCreated({ ref: { kind: 'custom', id: rec.id }, name: rec.name, per100g, portions });
  }

  const field = (id: keyof typeof v | 'name', label: string, value: string, onInput: (e: Event) => void, hint?: string) => (
    <div class="field">
      <label for={`cf-${id}`}>{label}</label>
      <input
        id={`cf-${id}`}
        type="text"
        inputMode={id === 'name' ? 'text' : 'decimal'}
        autocomplete="off"
        value={value}
        onInput={onInput}
        aria-invalid={errors[id] ? 'true' : undefined}
        aria-describedby={errors[id] ? `cf-${id}-err` : undefined}
      />
      {hint && !errors[id] && <span class="hint">{hint}</span>}
      {errors[id] && <span id={`cf-${id}-err`} class="field-error">{errors[id]}</span>}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate>
      {field('name', t('custom.name'), name, (e) => setName((e.target as HTMLInputElement).value))}
      <fieldset>
        <legend>{t('custom.basis')}</legend>
        <label class="choice">
          <input type="radio" name="basis" checked={basis === 'per100g'} onChange={() => setBasis('per100g')} />
          {t('custom.per100g')}
        </label>
        <label class="choice">
          <input type="radio" name="basis" checked={basis === 'perServing'} onChange={() => setBasis('perServing')} />
          {t('custom.perServing')}
        </label>
      </fieldset>
      {basis === 'perServing' && field('serving', t('custom.servingWeight'), v.serving, set('serving'))}
      {field('kcal', t('unit.kcal'), v.kcal, set('kcal'))}
      <div class="field-row">
        <div class="grow">{field('protein', t('macro.protein'), v.protein, set('protein'))}</div>
        <div class="grow">{field('carbs', t('macro.carbs'), v.carbs, set('carbs'))}</div>
        <div class="grow">{field('fat', t('macro.fat'), v.fat, set('fat'))}</div>
      </div>
      {basis === 'per100g' && field('serving', t('custom.servingOptional'), v.serving, set('serving'), t('custom.servingHint'))}
      <div class="actions">
        <button type="button" class="btn" onClick={onCancel}>{t('common.back')}</button>
        <button type="submit" class="btn primary">{t('custom.save')}</button>
      </div>
    </form>
  );
}
