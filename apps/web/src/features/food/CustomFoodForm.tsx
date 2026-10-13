import { useState } from 'preact/hooks';
import { customFoodsRepo } from '../../db/foodStore';
import type { FoodItem } from '../../domain/foods';
import { parseAmount, type Nutrients, type Portion } from '../../domain/nutrition';
import { Button, Choice, Field, Fieldset, TextInput } from '../../ui';
import { t } from '../../i18n';

type Basis = 'per100g' | 'perServing';
type Values = { kcal: string; protein: string; carbs: string; fat: string; serving: string };

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
  const [v, setV] = useState<Values>({ kcal: '', protein: '', carbs: '', fat: '', serving: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof Values) => (e: Event) => setV({ ...v, [k]: (e.target as HTMLInputElement).value });

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

  const num = (key: keyof Values, label: string, hint?: string) => (
    <Field label={label} error={errors[key]} hint={hint} class="grow">
      {(c) => <TextInput {...c} inputMode="decimal" autocomplete="off" value={v[key]} onInput={set(key)} />}
    </Field>
  );

  return (
    <form class="stack gap-4" onSubmit={submit} noValidate>
      <Field label={t('custom.name')} error={errors.name}>
        {(c) => <TextInput {...c} autocomplete="off" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />}
      </Field>
      <Fieldset legend={t('custom.basis')}>
        <Choice type="radio" name="basis" checked={basis === 'per100g'} onChange={() => setBasis('per100g')} label={t('custom.per100g')} />
        <Choice type="radio" name="basis" checked={basis === 'perServing'} onChange={() => setBasis('perServing')} label={t('custom.perServing')} />
      </Fieldset>
      {basis === 'perServing' && num('serving', t('custom.servingWeight'))}
      {num('kcal', t('unit.kcal'))}
      <div class="field-row">
        {num('protein', t('macro.protein'))}
        {num('carbs', t('macro.carbs'))}
        {num('fat', t('macro.fat'))}
      </div>
      {basis === 'per100g' && num('serving', t('custom.servingOptional'), t('custom.servingHint'))}
      <div class="cluster between">
        <Button onClick={onCancel}>{t('common.back')}</Button>
        <Button type="submit" variant="primary">{t('custom.save')}</Button>
      </div>
    </form>
  );
}
