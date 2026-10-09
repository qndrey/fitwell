import { useEffect, useState } from 'preact/hooks';
import { Card, Choice, Fieldset, Screen } from '../../ui';
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
