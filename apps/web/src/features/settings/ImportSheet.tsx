import { useState } from 'preact/hooks';
import { Button, Notice, SectionTitle, Sheet } from '../../ui';
import { saveBackupFile } from '../../backup/save';
import { applyImport, countsOf, type Counts, type ImportMode } from '../../backup/import';
import type { Backup } from '../../backup/schema';
import { getDb } from '../../db/open';
import { t } from '../../i18n';
import { showToast } from '../food/toast';

const KEYS: (keyof Counts)[] = ['foodEntries', 'workouts', 'customFoods', 'favorites', 'savedMeals', 'weights', 'measurements'];
const LABEL = { foodEntries: 'count.entries', customFoods: 'count.customFoods', favorites: 'count.favorites', savedMeals: 'count.savedMeals', workouts: 'count.workouts', weights: 'count.weights', measurements: 'count.measurements' } as const;

function CountList({ counts }: { counts: Counts }) {
  return (
    <ul class="plain">
      {KEYS.map((k) => (
        <li key={k}>{counts[k]} {t(LABEL[k])}</li>
      ))}
    </ul>
  );
}

export function ImportSheet({ backup, current, onClose }: { backup: Backup; current: Counts; onClose: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(mode: ImportMode) {
    setBusy(true);
    setError('');
    try {
      await applyImport(await getDb(), backup, mode);
      showToast(t('restore.done'));
      onClose();
    } catch {
      setError(t('restore.failed'));
      setBusy(false);
    }
  }

  return (
    <Sheet title={t('restore.title')} onClose={onClose}>
      <div class="stack gap-4">
        <p>{t('restore.madeOn')} {new Date(backup.exportedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.</p>
        <div class="two-col">
          <div><SectionTitle>{t('restore.contains')}</SectionTitle><CountList counts={countsOf(backup.data)} /></div>
          <div><SectionTitle>{t('restore.here')}</SectionTitle><CountList counts={current} /></div>
        </div>
        {error && <Notice attention role="alert">{error}</Notice>}

        {!confirming ? (
          <div class="stack gap-2">
            <Button variant="primary" block disabled={busy} onClick={() => void run('merge')}>{t('restore.merge')}</Button>
            <p class="t-caption">{t('restore.merge.help')}</p>
            <Button block disabled={busy} onClick={() => setConfirming(true)}>{t('restore.replace')}</Button>
            <p class="t-caption">{t('restore.replace.help')}</p>
          </div>
        ) : (
          <div class="stack gap-3" role="group" aria-labelledby="confirm-h">
            <h3 id="confirm-h">{t('restore.confirm')}</h3>
            <p>{t('restore.confirm.help')}</p>
            <Button block onClick={() => void saveBackupFile().then(() => showToast(t('backup.saved')))}>{t('restore.backupFirst')}</Button>
            <Button variant="danger" block disabled={busy} onClick={() => void run('replace')}>{t('restore.confirm.yes')}</Button>
            <Button block disabled={busy} onClick={() => setConfirming(false)}>{t('common.back')}</Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
