import { isQuotaError } from './db/persistence';
import { saveBackupFile } from './backup/save';
import { showToast } from './features/food/toast';
import { t } from './i18n';

/** Last-resort handler so a full disk is explained calmly instead of failing silently. */
export function installErrorHandling(): void {
  window.addEventListener('unhandledrejection', (e) => {
    if (!isQuotaError(e.reason)) return;
    e.preventDefault();
    showToast(t('error.quota'), { label: t('backup.save'), run: () => void saveBackupFile() }, 12_000);
  });
}
