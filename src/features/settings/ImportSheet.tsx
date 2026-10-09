import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet';
import { saveBackupFile } from '../../backup/save';
import { applyImport, countsOf, type Counts, type ImportMode } from '../../backup/import';
import type { Backup } from '../../backup/schema';
import { getDb } from '../../db/open';
import { t } from '../../i18n';
import { showToast } from '../food/toast';

const KEYS: (keyof Counts)[] = ['foodEntries', 'customFoods', 'favorites', 'savedMeals'];
const LABEL = { foodEntries: 'count.entries', customFoods: 'count.customFoods', favorites: 'count.favorites', savedMeals: 'count.savedMeals' } as const;

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
      <p>{t('restore.madeOn')} {new Date(backup.exportedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.</p>
      <div class="two-col">
        <div><h3 class="list-title">{t('restore.contains')}</h3><CountList counts={countsOf(backup.data)} /></div>
        <div><h3 class="list-title">{t('restore.here')}</h3><CountList counts={current} /></div>
      </div>
      {error && <p class="notice" role="alert">{error}</p>}

      {!confirming ? (
        <div class="stack">
          <button type="button" class="btn primary wide" disabled={busy} onClick={() => void run('merge')}>{t('restore.merge')}</button>
          <p class="muted help">{t('restore.merge.help')}</p>
          <button type="button" class="btn wide" disabled={busy} onClick={() => setConfirming(true)}>{t('restore.replace')}</button>
          <p class="muted help">{t('restore.replace.help')}</p>
        </div>
      ) : (
        <div class="stack" role="group" aria-labelledby="confirm-h">
          <h3 id="confirm-h">{t('restore.confirm')}</h3>
          <p>{t('restore.confirm.help')}</p>
          <button type="button" class="btn wide" onClick={() => void saveBackupFile().then(() => showToast(t('backup.saved')))}>{t('restore.backupFirst')}</button>
          <button type="button" class="btn primary wide" disabled={busy} onClick={() => void run('replace')}>{t('restore.confirm.yes')}</button>
          <button type="button" class="btn wide" disabled={busy} onClick={() => setConfirming(false)}>{t('common.back')}</button>
        </div>
      )}
    </Sheet>
  );
}
