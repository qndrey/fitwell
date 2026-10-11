import { useEffect, useRef, useState } from 'preact/hooks';
import { Button, Card, Choice, Field, Fieldset, Icon, Screen, Segmented, TextInput } from '../../ui';
import { parseAmount } from '../../domain/nutrition';
import { displayWeight, toKg, weightUnit, type UnitSystem } from '../../domain/units';
import { BackupSection } from './BackupSection';
import { DeleteAllSheet } from './DeleteAllSheet';
import { GoalsCard } from './GoalsCard';
import { InstallCard } from './InstallCard';
import { goals, settings, updateGoals, updateSettings } from '../../state';
import { ManageMeasurements } from '../body/ManageMeasurements';
import type { ThemePreference } from '../../db/schema';
import { t, type Key } from '../../i18n';

const THEMES: ThemePreference[] = ['system', 'light', 'dark'];

export function Settings() {
  const [deleting, setDeleting] = useState(false);
  return (
    <Screen title={t('nav.settings')}>
      <Card>
        <Fieldset legend={t('settings.theme')}>
          {THEMES.map((th) => (
            <Choice
              key={th}
              type="radio"
              name="theme"
              checked={settings.value.theme === th}
              onChange={() => void updateSettings({ theme: th })}
              label={t(`settings.theme.${th}` as Key)}
            />
          ))}
        </Fieldset>
      </Card>
      <Card>
        <div class="stack gap-3">
          <Segmented<UnitSystem>
            legend={t('settings.units')}
            name="units"
            value={settings.value.units}
            onChange={(v) => void updateSettings({ units: v })}
            options={[{ value: 'metric', label: t('settings.units.metric') }, { value: 'imperial', label: t('settings.units.imperial') }]}
          />
          <WeightField />
        </div>
      </Card>
      <GoalsCard />
      <BodyTrackingCard />
      <Card>
        <div class="stack gap-3">
          <Choice
            type="checkbox"
            checked={settings.value.habitOnly}
            onChange={(on) => void updateSettings({ habitOnly: on })}
            label={t('settings.habitOnly')}
            help={t('settings.habitOnly.help')}
          />
          <Choice
            type="checkbox"
            checked={settings.value.onlineLookup}
            onChange={(on) => void updateSettings({ onlineLookup: on })}
            label={t('settings.online')}
            help={t('settings.online.help')}
          />
        </div>
      </Card>
      <InstallCard />
      <BackupSection />
      <Card labelledBy="ai-h">
        <div class="stack gap-3">
          <h2 id="ai-h">{t('ai.title')}</h2>
          <p class="t-caption">{t('ai.open.help')}</p>
          <Button block onClick={() => (location.hash = '#/ai')}>{t('ai.open')}</Button>
        </div>
      </Card>
      <Card labelledBy="delete-h">
        <div class="stack gap-3">
          <h2 id="delete-h">{t('delete.title')}</h2>
          <p class="t-caption">{t('delete.help')}</p>
          <Button block variant="danger" onClick={() => setDeleting(true)}><Icon name="trash" size="sm" />{t('delete.open')}</Button>
        </div>
        {deleting && <DeleteAllSheet onClose={() => setDeleting(false)} />}
      </Card>
      <Card labelledBy="about-h">
        <div class="stack gap-3">
          <h2 id="about-h">{t('about.title')}</h2>
          <p class="t-caption">{t('about.open.help')}</p>
          <Button block onClick={() => (location.hash = '#/about')}>{t('about.open')}</Button>
        </div>
      </Card>
    </Screen>
  );
}

/** Body weight used for calorie estimates until you log your own weight. */
function WeightField() {
  const units = settings.value.units;
  const saved = settings.value.fallbackWeightKg;
  const [text, setText] = useState(saved ? String(displayWeight(saved, units)) : '');
  const [error, setError] = useState('');
  useSyncOnChange(() => setText(saved ? String(displayWeight(saved, units)) : ''), [units, saved]);
  return (
    <Field label={`${t('settings.weight')} (${weightUnit(units)})`} hint={t('settings.weight.help')} error={error}>
      {(c) => (
        <TextInput
          {...c}
          inputMode="decimal"
          autocomplete="off"
          value={text}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          onBlur={(e) => {
            const text = (e.target as HTMLInputElement).value; // the field's own value: state may not have caught up yet
            if (text.trim() === '') return (setError(''), void updateSettings({ fallbackWeightKg: undefined }));
            const n = parseAmount(text);
            if (n === null || n < 20 || n > 400) return setError(t('settings.weight.error'));
            setError('');
            void updateSettings({ fallbackWeightKg: toKg(n, units) });
          }}
        />
      )}
    </Field>
  );
}

function BodyTrackingCard() {
  const s = settings.value;
  const [managing, setManaging] = useState(false);
  return (
    <Card labelledBy="body-h">
      <div class="stack gap-4">
        <h2 id="body-h">{t('settings.body')}</h2>
        <Choice type="checkbox" checked={s.hideBodyTracking} onChange={(on) => void updateSettings({ hideBodyTracking: on })} label={t('settings.hideBody')} help={t('settings.hideBody.help')} />
        <GoalWeightField />
        <Button block onClick={() => setManaging(true)}>{t('measure.manage')}</Button>
        <Segmented<'0' | '1' | '2' | '4'>
          legend={t('measure.remind')}
          name="measure-remind"
          value={String(s.measurementReminderWeeks ?? 0) as '0' | '1' | '2' | '4'}
          onChange={(v) => void updateSettings({ measurementReminderWeeks: v === '0' ? undefined : (Number(v) as 1 | 2 | 4) })}
          options={[{ value: '0', label: t('measure.remind.off') }, { value: '1', label: t('measure.remind.1') }, { value: '2', label: t('measure.remind.2') }, { value: '4', label: t('measure.remind.4') }]}
        />
        <p class="t-caption">{t('measure.remind.help')}</p>
      </div>
      {managing && <ManageMeasurements onClose={() => setManaging(false)} />}
    </Card>
  );
}

/** Optional goal weight. It works for losing, keeping or gaining: it is only ever shown as "your goal". */
function GoalWeightField() {
  const units = settings.value.units;
  const saved = goals.value.goalWeightKg;
  const [text, setText] = useState(saved ? String(displayWeight(saved, units)) : '');
  const [error, setError] = useState('');
  useSyncOnChange(() => setText(saved ? String(displayWeight(saved, units)) : ''), [units, saved]);
  return (
    <Field label={`${t('weight.goal')} (${weightUnit(units)})`} hint={t('weight.goal.help')} error={error}>
      {(c) => (
        <TextInput
          {...c}
          inputMode="decimal"
          autocomplete="off"
          value={text}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          onBlur={(e) => {
            const text = (e.target as HTMLInputElement).value; // the field's own value: state may not have caught up yet
            if (text.trim() === '') return (setError(''), void updateGoals({ goalWeightKg: undefined }));
            const n = parseAmount(text);
            if (n === null || n < 20 || n > 400) return setError(t('settings.weight.error'));
            setError('');
            void updateGoals({ goalWeightKg: toKg(n, units) });
          }}
        />
      )}
    </Field>
  );
}

/** Runs when the dependencies change, not on first render: otherwise it can undo what was typed before it ran. */
function useSyncOnChange(fn: () => void, deps: unknown[]): void {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    fn();
  }, deps);
}
