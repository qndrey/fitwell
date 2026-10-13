import { useEffect, useState } from 'preact/hooks';
import { saveWeight, weightBefore, weightFor, weightRepo, weightId } from '../../db/bodyStore';
import { formatDay } from '@fitwell/core/domain/dates';
import { parseAmount } from '@fitwell/core/domain/nutrition';
import { displayWeight, toKg, weightUnit } from '@fitwell/core/domain/units';
import { currentWeightKg, settings } from '../../state';
import { Button, Field, Icon, Sheet, TextInput } from '../../ui';
import { t } from '../../i18n';
import { showToast } from '../food/toast';

/** Log (or replace) the weight for one day. Starts from your last weight so a small change is two taps. */
export function WeightSheet({ day, onClose }: { day: string; onClose: () => void }) {
  const units = settings.value.units;
  const unit = weightUnit(units);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [existing, setExisting] = useState<boolean>(false);
  const [prev, setPrev] = useState<{ kg: number; day: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const [today, before] = await Promise.all([weightFor(day), weightBefore(day)]);
      setExisting(!!today);
      setPrev(before ? { kg: before.kg, day: before.day } : null);
      const start = today?.kg ?? before?.kg ?? currentWeightKg();
      if (start) setText(String(displayWeight(start, units)));
    })();
  }, [day]);

  const value = parseAmount(text);
  const step = (delta: number) => {
    const base = value ?? (prev ? displayWeight(prev.kg, units) : 0);
    setText(String(Math.max(0, Math.round((base + delta) * 10) / 10)));
    setError('');
  };

  async function save() {
    if (value === null || value < 20 || value > 400) return setError(t('weight.error'));
    await saveWeight(day, toKg(value, units));
    showToast(t('weight.saved'));
    onClose();
  }

  return (
    <Sheet title={t('weight.title')} onClose={onClose}>
      <form class="stack gap-4" noValidate onSubmit={(e) => (e.preventDefault(), void save())}>
        <p class="t-caption">{formatDay(day)}{prev ? ` · ${t('weight.last')} ${displayWeight(prev.kg, units)} ${unit}, ${formatDay(prev.day, { month: 'short', day: 'numeric' })}` : ''}</p>
        <div class="cluster gap-2 nowrap">
          <Button icon aria-label={`${t('weight.less')} 0.1 ${unit}`} onClick={() => step(-0.1)}><Icon name="minus" /></Button>
          <Field label={`${t('weight.label')} (${unit})`} error={error} class="grow">
            {(c) => <TextInput {...c} inputMode="decimal" autocomplete="off" autofocus value={text} onInput={(e) => (setText((e.target as HTMLInputElement).value), setError(''))} onFocus={(e) => (e.target as HTMLInputElement).select()} />}
          </Field>
          <Button icon aria-label={`${t('weight.more')} 0.1 ${unit}`} onClick={() => step(0.1)}><Icon name="plus" /></Button>
        </div>
        <div class="sticky-action">
          <Button type="submit" variant="primary" block>{t('common.save')}</Button>
        </div>
        {existing && (
          <Button
            onClick={async () => {
              await weightRepo.remove(weightId(day));
              showToast(t('weight.removed'));
              onClose();
            }}
          >
            <Icon name="trash" size="sm" />{t('food.remove')}
          </Button>
        )}
      </form>
    </Sheet>
  );
}
