import { useEffect, useState } from 'preact/hooks';
import { saveBackupFile } from '../../backup/save';
import { firstDataAt } from '../../db/foodStore';
import { getDb } from '../../db/open';
import { saveSettings } from '../../db/settings';
import { backupReminderDue } from '../../domain/backupReminder';
import { onChange } from '../../db/broadcast';
import { settings } from '../../state';
import { t } from '../../i18n';
import { Button, Card } from '../../ui';
import { showToast } from '../food/toast';

/** A quiet card, never a modal and never blocking. Hidden for a week when dismissed. */
export function BackupReminder() {
  const [first, setFirst] = useState<number | undefined>();
  useEffect(() => {
    const load = () => void firstDataAt().then(setFirst);
    load();
    return onChange((c) => c.store === 'foodEntries' && load());
  }, []);

  const s = settings.value;
  if (!backupReminderDue({ now: Date.now(), firstDataAt: first, lastBackupAt: s.lastBackupAt, dismissedAt: s.backupReminderDismissedAt, everyDays: s.backupReminderDays })) return null;

  return (
    <Card label={t('backup.reminder.region')} compact>
      <p class="mb-3">{s.lastBackupAt ? t('backup.reminder') : t('backup.reminder.first')}</p>
      <div class="cluster gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={async () => {
            await saveBackupFile();
            showToast(t('backup.saved'));
          }}
        >
          {t('backup.reminder.now')}
        </Button>
        <Button size="sm" onClick={async () => void saveSettings(await getDb(), { backupReminderDismissedAt: Date.now() })}>
          {t('backup.reminder.later')}
        </Button>
      </div>
    </Card>
  );
}
