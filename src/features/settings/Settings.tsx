import { Screen } from '../../components/Screen';
import { settings, updateSettings } from '../../state';
import type { ThemePreference } from '../../db/schema';
import { t, type Key } from '../../i18n';

const THEMES: ThemePreference[] = ['system', 'light', 'dark'];

export function Settings() {
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
      <p class="muted">{t('settings.privacy')}</p>
    </Screen>
  );
}
