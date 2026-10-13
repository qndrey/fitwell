import { useState } from 'preact/hooks';
import { measurementTypesRepo } from '../../db/bodyStore';
import type { MeasurementType } from '@fitwell/core/schema';
import { Button, Choice, Field, Icon, SectionTitle, Sheet, TextInput } from '../../ui';
import { t } from '../../i18n';
import { showToast } from '../food/toast';
import { measurementTypes } from './store';

function CustomForm({ initial, onDone, onBack }: { initial?: MeasurementType; onDone: () => void; onBack: () => void }) {
  const [name, setName] = useState(initial?.label ?? '');
  const [unit, setUnit] = useState(initial?.customUnit ?? '');
  const [errors, setErrors] = useState<{ name?: string; unit?: string }>({});
  return (
    <form
      class="stack gap-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const errs: typeof errors = {};
        if (!name.trim()) errs.name = t('exercise.nameError');
        if (!unit.trim()) errs.unit = t('measure.unitError');
        setErrors(errs);
        if (errs.name || errs.unit) return;
        if (initial) await measurementTypesRepo.update(initial.id, { label: name.trim(), customUnit: unit.trim() });
        else await measurementTypesRepo.create({ key: 'custom', label: name.trim(), kind: 'custom', customUnit: unit.trim(), enabled: true, preset: false, order: 100 + measurementTypes.value.filter((m) => !m.preset).length });
        onDone();
      }}
    >
      <Field label={t('exercise.name')} error={errors.name}>{(c) => <TextInput {...c} autocomplete="off" autofocus value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />}</Field>
      <Field label={t('measure.unit')} hint={t('measure.unitHint')} error={errors.unit}>{(c) => <TextInput {...c} autocomplete="off" value={unit} onInput={(e) => setUnit((e.target as HTMLInputElement).value)} />}</Field>
      <div class="cluster between">
        <Button onClick={onBack}>{t('common.back')}</Button>
        <Button type="submit" variant="primary">{t('exercise.save')}</Button>
      </div>
    </form>
  );
}

/** Switch presets on or off, and add, rename or remove your own measurement types. */
export function ManageMeasurements({ onClose }: { onClose: () => void }) {
  const [editing, setEditing] = useState<MeasurementType | 'new' | null>(null);
  const all = measurementTypes.value;
  const presets = all.filter((m) => m.preset);
  const mine = all.filter((m) => !m.preset);

  if (editing) {
    return (
      <Sheet title={editing === 'new' ? t('measure.addOwn') : editing.label} onClose={() => setEditing(null)}>
        <CustomForm initial={editing === 'new' ? undefined : editing} onBack={() => setEditing(null)} onDone={() => setEditing(null)} />
      </Sheet>
    );
  }

  return (
    <Sheet title={t('measure.manage')} onClose={onClose}>
      <p class="t-caption mb-3">{t('measure.manageHelp')}</p>
      <section aria-label={t('measure.presets')}>
        <SectionTitle>{t('measure.presets')}</SectionTitle>
        {presets.map((m) => (
          <Choice key={m.id} type="checkbox" checked={m.enabled} onChange={(on) => void measurementTypesRepo.update(m.id, { enabled: on })} label={m.label} help={m.kind === 'percent' ? t('measure.percent') : undefined} />
        ))}
      </section>
      <section aria-label={t('measure.yours')} class="mt-4">
        <SectionTitle>{t('measure.yours')}</SectionTitle>
        {mine.length === 0 && <p class="muted">{t('measure.noneOwn')}</p>}
        {mine.map((m) => (
          <div key={m.id} class="row-split">
            <div class="grow">
              <Choice type="checkbox" checked={m.enabled} onChange={(on) => void measurementTypesRepo.update(m.id, { enabled: on })} label={`${m.label} (${m.customUnit})`} />
            </div>
            <Button icon aria-label={`${t('measure.edit')} ${m.label}`} onClick={() => setEditing(m)}>{t('measure.editShort')}</Button>
            <Button
              icon
              aria-label={`${t('food.remove')} ${m.label}`}
              onClick={async () => {
                await measurementTypesRepo.remove(m.id);
                showToast(t('measure.typeRemoved'), { label: t('food.undo'), run: () => void measurementTypesRepo.restore(m.id) });
              }}
            >
              <Icon name="trash" size="sm" />
            </Button>
          </div>
        ))}
        <Button block class="mt-3" onClick={() => setEditing('new')}>
          <Icon name="plus" size="sm" />{t('measure.addOwn')}
        </Button>
      </section>
    </Sheet>
  );
}
