import { useEffect, useState } from 'preact/hooks';
import { favoritesRepo, favoriteId } from '../../db/foodStore';
import type { FoodEntry, Slot } from '../../db/schema';
import { Button, Icon, Sheet } from '../../ui';
import { t } from '../../i18n';
import { changeEntry, deleteEntry, setFavorite, updateManualValues } from './actions';
import { ValuesForm } from './ValuesForm';
import { quantityText } from './format';
import { QuantityForm } from './QuantityForm';
import { SlotPicker } from './SlotPicker';

export function EntrySheet({ entry, onClose }: { entry: FoodEntry; onClose: () => void }) {
  const food = entry.food;
  const [slot, setSlot] = useState<Slot>(entry.slot);
  const [fav, setFav] = useState<boolean | null>(null);
  useEffect(() => {
    if (food) void favoritesRepo.get(favoriteId(food)).then((f) => setFav(!!f));
  }, [food]);
  if (!food) {
    if (!entry.manual) return null;
    // Values typed by hand: edit them, or remove the entry.
    return (
      <Sheet title={entry.queryText ?? ''} onClose={onClose}>
        <p class="t-caption mb-3">{quantityText(entry.quantity)} · {t('manual.badge')}</p>
        <ValuesForm
          initial={entry.nutrition}
          submitLabel={t('common.save')}
          onSubmit={async (n) => {
            await updateManualValues(entry, n, entry.quantity.amount);
            onClose();
          }}
        />
        <div class="mt-4">
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

  return (
    <Sheet title={food.name} onClose={onClose} pinned={<SlotPicker value={slot} onChange={setSlot} name="edit-slot" />}>
      <div class="mt-3">
        <QuantityForm
          food={food}
          initial={entry.quantity}
          submitLabel={t('common.save')}
          onSubmit={async (quantity) => {
            await changeEntry(entry, { slot, quantity });
            onClose();
          }}
        />
      </div>
      <div class="cluster between mt-4">
        {fav !== null && (
          <Button
            aria-pressed={fav}
            onClick={async () => {
              await setFavorite(food, !fav);
              setFav(!fav);
            }}
          >
            <Icon name="star" size="sm" filled={!!fav} />{t('food.favorite')}
          </Button>
        )}
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
