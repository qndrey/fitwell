import { signal } from '@preact/signals';
import { applyPendingUpdate, updateAvailable } from '../pwa/register';
import { t } from '../i18n';
import { Button } from './Button';

const dismissed = signal(false);

export function UpdateToast() {
  if (!updateAvailable.value || dismissed.value) return null;
  return (
    <div class="toast">
      <span>{t('update.available')}</span>
      <span class="cluster gap-2">
        <Button size="sm" onClick={() => (dismissed.value = true)}>{t('update.later')}</Button>
        <Button size="sm" variant="primary" onClick={applyPendingUpdate}>{t('update.apply')}</Button>
      </span>
    </div>
  );
}
