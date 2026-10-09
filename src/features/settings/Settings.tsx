import { useEffect, useState } from 'preact/hooks';
import { Card, Choice, Field, Fieldset, Screen, Segmented, TextInput } from '../../ui';
import { parseAmount } from '../../domain/nutrition';
import { displayWeight, toKg, weightUnit, type UnitSystem } from '../../domain/units';
import { BackupSection } from './BackupSection';
import { settings, updateSettings } from '../../state';
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
  useEffect(() => setText(saved ? String(displayWeight(saved, units)) : ''), [units, saved]);
  return (
    <Field label={`${t('settings.weight')} (${weightUnit(units)})`} hint={t('settings.weight.help')} error={error}>
      {(c) => (
        <TextInput
          {...c}
          inputMode="decimal"
          autocomplete="off"
          value={text}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          onBlur={() => {
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
