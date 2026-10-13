import { useEffect, useState } from 'preact/hooks';
import { lastValues, measurementEntriesRepo, measurementId, measurementsFor, saveMeasurements } from '../../db/bodyStore';
import type { MeasurementType } from '../../db/schema';
import { PRESETS } from '../../data/measurements';
import { formatDay } from '../../domain/dates';
import { parseAmount } from '../../domain/nutrition';
import { displayLength, lengthUnit, toCm } from '../../domain/units';
import { settings } from '../../state';
import { Button, Field, Icon, Notice, Sheet, TextInput } from '../../ui';
import { t } from '../../i18n';
import { showToast } from '../food/toast';
import { measurementTypes } from './store';

export const unitFor = (m: MeasurementType, units: 'metric' | 'imperial'): string => (m.kind === 'length' ? lengthUnit(units) : m.kind === 'percent' ? '%' : (m.customUnit ?? ''));
const show = (m: MeasurementType, v: number, units: 'metric' | 'imperial') => (m.kind === 'length' ? displayLength(v, units) : Math.round(v * 10) / 10);

/** One set of measurements per day. Only the types you switched on appear; fill in what you measured. */
export function MeasurementsSheet({ day, onClose }: { day: string; onClose: () => void }) {
  const units = settings.value.units;
  const types = measurementTypes.value.filter((m) => m.enabled);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [last, setLast] = useState<Record<string, number>>({});
  const [existing, setExisting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');

  useEffect(() => {
    void (async () => {
      const [entry, previous] = await Promise.all([measurementsFor(day), lastValues(day)]);
      setExisting(!!entry);
      setLast(previous);
      if (entry) {
        const next: Record<string, string> = {};
        for (const m of measurementTypes.value) if (entry.values[m.id] !== undefined) next[m.id] = String(show(m, entry.values[m.id]!, units));
        setVals(next);
      }
    })();
  }, [day]);

  async function save() {
    const errs: Record<string, string> = {};
    const out: Record<string, number> = {};
    for (const m of types) {
      const raw = (vals[m.id] ?? '').trim();
      if (raw === '') continue;
      const n = parseAmount(raw);
      if (n === null || (m.kind === 'percent' && n > 100)) errs[m.id] = t('custom.numberError');
      else out[m.id] = m.kind === 'length' ? toCm(n, units) : n;
    }
    // Values for types that are switched off right now are kept as they were.
    const entry = await measurementsFor(day);
    for (const [k, v] of Object.entries(entry?.values ?? {})) if (!types.some((m) => m.id === k) && !(k in out)) out[k] = v;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (Object.keys(out).length === 0) return setFormError(t('measure.none'));
    await saveMeasurements(day, out);
    showToast(t('measure.saved'));
    onClose();
  }

  return (
    <Sheet title={t('measure.title')} onClose={onClose}>
      {types.length === 0 ? (
        <div class="stack gap-3">
          <Notice quiet>{t('measure.noneOn')}</Notice>
          <Button
            variant="primary"
            block
            onClick={() => {
              onClose();
              location.hash = '#/settings';
            }}
          >
            {t('measure.choose')}
          </Button>
        </div>
      ) : (
        <form class="stack gap-4" noValidate onSubmit={(e) => (e.preventDefault(), void save())}>
          <p class="t-caption">{formatDay(day)}. {t('measure.partial')}</p>
          {formError && <Notice quiet role="status">{formError}</Notice>}
          {types.map((m) => {
            const hint = PRESETS.find((p) => `mt:${p.key}` === m.id)?.hint;
            const placeholder = last[m.id] !== undefined ? String(show(m, last[m.id]!, units)) : '';
            return (
              <div key={m.id} class="stack gap-1">
                <Field label={`${m.label} (${unitFor(m, units)})`} error={errors[m.id]}>
                  {(c) => <TextInput {...c} inputMode="decimal" autocomplete="off" placeholder={placeholder} value={vals[m.id] ?? ''} onInput={(e) => (setVals({ ...vals, [m.id]: (e.target as HTMLInputElement).value }), setFormError(''))} />}
                </Field>
                {hint && (
                  <details class="howto">
                    <summary>{t('measure.how')}</summary>
                    <p class="t-caption">{hint}</p>
                  </details>
                )}
              </div>
            );
          })}
          <div class="sticky-action">
            <Button type="submit" variant="primary" block>{t('common.save')}</Button>
          </div>
          {existing && (
            <Button
              onClick={async () => {
                await measurementEntriesRepo.remove(measurementId(day));
                showToast(t('measure.removed'));
                onClose();
              }}
            >
              <Icon name="trash" size="sm" />{t('food.remove')}
            </Button>
          )}
        </form>
      )}
    </Sheet>
  );
}
