import { useEffect, useState } from 'preact/hooks';
import { BackupSection } from './BackupSection';
import { Screen } from '../../components/Screen';
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
      <div class="card">
        <fieldset>
          <legend>{t('settings.theme')}</legend>
          {THEMES.map((th) => (
            <label class="choice" key={th}>
              <input
                type="radio"
                name="theme"
                value={th}
                checked={settings.value.theme === th}
                onChange={() => void updateSettings({ theme: th })}
              />
              {t(`settings.theme.${th}` as Key)}
            </label>
          ))}
        </fieldset>
      </div>
      <div class="card">
        <label class="choice">
          <input
            type="checkbox"
            checked={settings.value.habitOnly}
            onChange={(e) => void updateSettings({ habitOnly: (e.target as HTMLInputElement).checked })}
          />
          <span>
            {t('settings.habitOnly')}
            <span class="muted block">{t('settings.habitOnly.help')}</span>
          </span>
        </label>
      </div>
      <BackupSection />
      <p class="muted">{t('settings.privacy')}</p>
      {info && (
        <section class="card" aria-labelledby="sources-h">
          <h2 id="sources-h">{t('about.foodData')}</h2>
          <p>
            {info.attribution}{' '}
            <a href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer noopener">{info.license}</a>.
          </p>
          <p class="muted">{t('about.foodData.note')}</p>
        </section>
      )}
    </Screen>
  );
}
