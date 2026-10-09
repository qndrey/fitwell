import { signal } from '@preact/signals';
import { applyPendingUpdate, updateAvailable } from '../pwa/register';
import { t } from '../i18n';

const dismissed = signal(false);

export function UpdateToast() {
  if (!updateAvailable.value || dismissed.value) return null;
  return (
    <div class="toast" role="status">
      <span>{t('update.available')}</span>
      <span>
        <button class="btn" onClick={() => (dismissed.value = true)}>{t('update.later')}</button>{' '}
        <button class="btn primary" onClick={applyPendingUpdate}>{t('update.apply')}</button>
      </span>
    </div>
  );
}
