import { useState } from 'preact/hooks';
import { saveBackupFile } from '../../backup/save';
import { deleteEverything } from '../../db/deleteAll';
import { Button, Field, Icon, Notice, Sheet, TextInput } from '../../ui';
import { t } from '../../i18n';
import { showToast } from '../food/toast';

/** Erases everything on this device. Needs the word typed in, and offers a backup first. */
export function DeleteAllSheet({ onClose }: { onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const word = t('delete.word');
  const ready = typed.trim().toLowerCase() === word.toLowerCase();

  return (
    <Sheet title={t('delete.title')} onClose={onClose}>
      <form
        class="stack gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) return;
          setBusy(true);
          setFailed(false);
          try {
            await deleteEverything();
          } catch {
            setBusy(false);
            setFailed(true);
          }
        }}
      >
        <p>{t('delete.explain')}</p>
        <Button onClick={() => void saveBackupFile().then(() => showToast(t('backup.saved')))}>
          <Icon name="download" size="sm" />{t('restore.backupFirst')}
        </Button>
        <Field label={t('delete.type').replace('{word}', word)}>
          {(c) => <TextInput {...c} autocomplete="off" autocapitalize="off" value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />}
        </Field>
        {failed && <Notice attention role="alert">{t('delete.failed')}</Notice>}
        <Button type="submit" variant="danger" block disabled={!ready || busy}>{t('delete.confirm')}</Button>
      </form>
    </Sheet>
  );
}
