import { useState } from 'preact/hooks';
import { parseAmount } from '@fitwell/core/domain/nutrition';
import { Button, Field, TextInput } from '../../ui';
import { t } from '../../i18n';

/** Free-text food + amount in grams. Used to log without nutrition now and sort it out later. */
export function PendingForm({
  initialText,
  initialGrams = 100,
  submitLabel,
  onSubmit,
}: {
  initialText: string;
  initialGrams?: number;
  submitLabel: string;
  onSubmit: (text: string, grams: number) => void;
}) {
  const [text, setText] = useState(initialText);
  const [grams, setGrams] = useState(String(initialGrams));
  const [errors, setErrors] = useState<{ text?: string; grams?: string }>({});
  const amount = parseAmount(grams);

  return (
    <form
      class="stack gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const errs: typeof errors = {};
        if (!text.trim()) errs.text = t('pending.textError');
        if (!amount || amount <= 0) errs.grams = t('food.amountError');
        setErrors(errs);
        if (!errs.text && !errs.grams) onSubmit(text.trim(), amount!);
      }}
    >
      <Field label={t('pending.what')} error={errors.text}>
        {(c) => <TextInput {...c} autocomplete="off" value={text} onInput={(e) => (setText((e.target as HTMLInputElement).value), setErrors({}))} />}
      </Field>
      <Field label={t('pending.amountG')} error={errors.grams}>
        {(c) => <TextInput {...c} inputMode="decimal" autocomplete="off" value={grams} onInput={(e) => (setGrams((e.target as HTMLInputElement).value), setErrors({}))} onFocus={(e) => (e.target as HTMLInputElement).select()} />}
      </Field>
      <div class="quick" role="group" aria-label={t('food.quick')}>
        {[50, 100, 150, 200, 250].map((n) => (
          <Button key={n} size="sm" aria-pressed={amount === n} onClick={() => (setGrams(String(n)), setErrors({}))}>{n}</Button>
        ))}
      </div>
      <p class="t-caption">{t('pending.explain')}</p>
      <div class="sticky-action">
        <Button type="submit" variant="primary" block>{submitLabel}</Button>
      </div>
    </form>
  );
}
