import { useEffect, useRef, useState } from 'preact/hooks';
import { Button, Card, Choice, Field, Fieldset, Screen, Segmented, TextInput } from '../../ui';
import { parseAmount } from '../../domain/nutrition';
import { displayWeight, toKg, weightUnit, type UnitSystem } from '../../domain/units';
import { BackupSection } from './BackupSection';
import { goals, settings, updateGoals, updateSettings } from '../../state';
import { ManageMeasurements } from '../body/ManageMeasurements';
import type { ThemePreference } from '../../db/schema';
import { t, type Key } from '../../i18n';
import { loadBundledFoods, type DatasetInfo } from '../../data/bundledFoods';

const THEMES: ThemePreference[] = ['system', 'light', 'dark'];

export function Settings() {
  const [info, setInfo] = useState<DatasetInfo | null>(null);
  useEffect(() => {
    void loadBundledFoods().then((d) => setInfo(d.info));
  }, []);
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
      <BodyTrackingCard />
      <Card>
        <Choice
          type="checkbox"
          checked={settings.value.habitOnly}
          onChange={(on) => void updateSettings({ habitOnly: on })}
          label={t('settings.habitOnly')}
          help={t('settings.habitOnly.help')}
        />
      </Card>
      <Card>
        <Choice
          type="checkbox"
          checked={settings.value.onlineLookup}
          onChange={(on) => void updateSettings({ onlineLookup: on })}
          label={t('settings.online')}
          help={t('settings.online.help')}
        />
      </Card>
      <BackupSection />
      <p class="muted">{t('settings.privacy')}</p>
      <Card labelledBy="ex-h">
        <div class="stack gap-2">
          <h2 id="ex-h">{t('workout.title')}</h2>
          <p class="t-caption">{t('about.exercises')}</p>
        </div>
      </Card>
      <Card labelledBy="scan-h">
        <div class="stack gap-2">
          <h2 id="scan-h">{t('scan.title')}</h2>
          <p class="t-caption">{t('about.scan')}</p>
        </div>
      </Card>
      <Card labelledBy="fonts-h">
        <div class="stack gap-2">
          <h2 id="fonts-h">{t('about.fonts')}</h2>
          <p class="t-caption">{t('about.fonts.text')}</p>
        </div>
      </Card>
      {info && (
        <Card labelledBy="sources-h">
          <div class="stack gap-2">
            <h2 id="sources-h">{t('about.foodData')}</h2>
            <p>
              {info.attribution}{' '}
              <a href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer noopener">{info.license}</a>.
            </p>
            <p class="t-caption">{t('about.foodData.note')}</p>
          </div>
        </Card>
      )}
      <Card labelledBy="off-h">
        <div class="stack gap-2">
          <h2 id="off-h">Open Food Facts</h2>
          <p>{t('about.off')}</p>
          <p class="t-caption">
            <a href="https://world.openfoodfacts.org/legal" rel="noreferrer noopener">{t('about.off.licence')}</a>
          </p>
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
