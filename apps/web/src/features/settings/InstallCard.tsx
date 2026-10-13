import { signal } from '@preact/signals';
import { getDb } from '../../db/open';
import { saveSettings } from '../../db/settings';
import { settings } from '../../state';
import { Button, Card, Icon } from '../../ui';
import { t } from '../../i18n';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Chrome/Edge/Android offer a one-tap install through this event; iPhone and iPad have no such event. */
const deferred = signal<InstallPrompt | null>(null);
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred.value = e as InstallPrompt;
});
window.addEventListener('appinstalled', () => (deferred.value = null));

export const isStandalone = (): boolean => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function isIos(ua = navigator.userAgent, platform = navigator.platform, touchPoints = navigator.maxTouchPoints): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1); // iPadOS reports as a Mac
}

/** "Add to Home Screen": installed apps are less likely to be cleaned up by the browser, and open like an app. */
export function InstallCard({ compact = false }: { compact?: boolean }) {
  const standalone = isStandalone();
  const ios = isIos();
  if (standalone) return null;
  if (compact ? !ios : !deferred.value && !ios) return null;
  if (compact && settings.value.installHintDismissedAt !== undefined) return null;

  return (
    <Card labelledBy="install-h" compact={compact}>
      <div class="stack gap-2">
        <h2 id="install-h">{t('install.title')}</h2>
        <p class="t-caption">{deferred.value ? t('install.android') : t('install.ios')}</p>
        <div class="cluster gap-2">
          {deferred.value && (
            <Button
              variant="primary"
              size="sm"
              onClick={async () => {
                await deferred.value?.prompt();
                deferred.value = null;
              }}
            >
              <Icon name="download" size="sm" />{t('install.button')}
            </Button>
          )}
          {compact && <Button size="sm" onClick={async () => void saveSettings(await getDb(), { installHintDismissedAt: Date.now() })}>{t('backup.reminder.later')}</Button>}
        </div>
      </div>
    </Card>
  );
}
