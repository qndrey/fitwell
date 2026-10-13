import type { FoodEntry } from '@fitwell/core/schema';
import { MAX_ATTEMPTS } from '../../queue/machine';
import { online } from '../../state';
import { Button, Icon, Sheet } from '../../ui';
import { t } from '../../i18n';
import { deleteEntry, editUnresolved, retryLookup } from './actions';
import { PendingForm } from './PendingForm';
import { entryLabel } from './format';

export function pendingStatus(e: FoodEntry): string {
  if (e.state !== 'pending') return '';
  if ((e.lookup?.attempts ?? 0) >= MAX_ATTEMPTS) return t('pending.stuck');
  if (!online.value) return t('pending.waitingOffline');
  return e.lookup?.attempts ? t('pending.retrying') : t('pending.waiting');
}

/** Edit what was typed, look it up now, or remove it. */
export function PendingEntrySheet({ entry, onClose }: { entry: FoodEntry; onClose: () => void }) {
  return (
    <Sheet title={entryLabel(entry)} onClose={onClose}>
      <p class="t-caption mb-3" role="status">{pendingStatus(entry)}</p>
      <PendingForm
        initialText={entry.queryText ?? ''}
        initialGrams={entry.quantity.amount}
        submitLabel={t('common.save')}
        onSubmit={async (text, grams) => {
          await editUnresolved(entry, { text, grams });
          onClose();
        }}
      />
      <div class="cluster between mt-4">
        <Button
          disabled={!online.value}
          onClick={async () => {
            await retryLookup(entry);
            onClose();
          }}
        >
          <Icon name="search" size="sm" />{t('pending.lookNow')}
        </Button>
        <Button
          onClick={async () => {
            await deleteEntry(entry);
            onClose();
          }}
        >
          <Icon name="trash" size="sm" />{t('food.remove')}
        </Button>
      </div>
    </Sheet>
  );
}
