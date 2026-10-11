import { useEffect, useRef, useState } from 'preact/hooks';
import { saveBackupFile } from '../../backup/save';
import { currentCounts, parseBackup, type Counts, type ParseError } from '../../backup/import';
import type { Backup } from '../../backup/schema';
import { getDb } from '../../db/open';
import { getStorageEstimate, requestPersistence } from '../../db/persistence';
import { settings } from '../../state';
import { t } from '../../i18n';
import { showToast } from '../food/toast';
import { Button, Card, Icon, Notice } from '../../ui';
import { ImportSheet } from './ImportSheet';

const MAX_BYTES = 200 * 1024 * 1024;

function errorText(e: ParseError | 'too-big'): string {
  if (e === 'too-big') return t('restore.err.tooBig');
  switch (e.kind) {
    case 'not-json': return t('restore.err.notJson');
    case 'not-fitwell': return t('restore.err.notFitwell');
    case 'newer': return t('restore.err.newer');
    case 'invalid': return `${t('restore.err.invalid')} ${e.where || '…'}`;
  }
}

const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(0.1, n / 1e6).toFixed(1)} MB`);

export function BackupSection() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ backup: Backup; current: Counts } | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  async function refreshStorage() {
    setStorage(await getStorageEstimate());
    try {
      setPersisted((await navigator.storage?.persisted?.()) ?? null);
    } catch {
      setPersisted(null);
    }
  }
  useEffect(() => void refreshStorage(), []);

  async function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow choosing the same file again
    if (!file) return;
    setError('');
    if (file.size > MAX_BYTES) return setError(errorText('too-big'));
    const result = parseBackup(await file.text());
    if (!result.ok) return setError(errorText(result.error));
    setPending({ backup: result.backup, current: await currentCounts(await getDb()) });
  }

  const last = settings.value.lastBackupAt;
  return (
    <Card labelledBy="backup-h">
      <div class="stack gap-3">
        <h2 id="backup-h">{t('backup.title')}</h2>
        <p class="muted">{t('backup.intro')}</p>
        <dl class="facts">
          <div><dt>{t('backup.last')}</dt><dd>{last ? new Date(last).toLocaleDateString(undefined, { dateStyle: 'medium' }) : t('backup.never')}</dd></div>
          {storage && <div><dt>{t('backup.storage')}</dt><dd>{mb(storage.usage)}</dd></div>}
          {persisted !== null && <div><dt>{t('backup.protected')}</dt><dd>{persisted ? t('backup.protected.yes') : t('backup.protected.no')}</dd></div>}
        </dl>
        <Button
          variant="primary"
          block
          onClick={async () => {
            const n = await saveBackupFile();
            showToast(`${t('backup.saved')} (${n})`);
          }}
        >
          <Icon name="download" size="sm" />{t('backup.save')}
        </Button>
        <Button block onClick={() => fileInput.current?.click()}><Icon name="upload" size="sm" />{t('backup.restore')}</Button>
        {persisted === false && (
          <Button
            block
            onClick={async () => {
              await requestPersistence();
              await refreshStorage();
            }}
          >
            {t('backup.protect')}
          </Button>
        )}
        <input ref={fileInput} type="file" accept="application/json,.json" class="sr-only" tabIndex={-1} aria-label={t('backup.restore')} onChange={(e) => void onFile(e)} />
        {error && <Notice attention role="alert">{error}</Notice>}
      </div>
      {pending && <ImportSheet backup={pending.backup} current={pending.current} onClose={() => setPending(null)} />}
    </Card>
  );
}
