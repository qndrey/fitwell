import { useEffect, useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet';
import { favoritesRepo, favoriteId } from '../../db/foodStore';
import type { FoodEntry, Slot } from '../../db/schema';
import { t } from '../../i18n';
import { changeEntry, deleteEntry, setFavorite } from './actions';
import { QuantityForm } from './QuantityForm';
import { SlotPicker } from './SlotPicker';

export function EntrySheet({ entry, onClose }: { entry: FoodEntry; onClose: () => void }) {
  const food = entry.food;
  const [slot, setSlot] = useState<Slot>(entry.slot);
  const [fav, setFav] = useState<boolean | null>(null);
  useEffect(() => {
    if (food) void favoritesRepo.get(favoriteId(food)).then((f) => setFav(!!f));
  }, [food]);
  if (!food) return null; // unresolved entries get their own review flow later

  return (
    <Sheet title={food.name} onClose={onClose}>
      <SlotPicker value={slot} onChange={setSlot} name="edit-slot" />
      <QuantityForm
        food={food}
        initial={entry.quantity}
        submitLabel={t('common.save')}
        onSubmit={async (quantity) => {
          await changeEntry(entry, { slot, quantity });
          onClose();
        }}
      />
      <div class="actions">
        {fav !== null && (
          <button
            type="button"
            class="btn"
            aria-pressed={fav}
            onClick={async () => {
              await setFavorite(food, !fav);
              setFav(!fav);
            }}
          >
            <span aria-hidden="true">{fav ? '★ ' : '☆ '}</span>{t('food.favorite')}
          </button>
        )}
        <button
          type="button"
          class="btn"
          onClick={async () => {
            await deleteEntry(entry);
            onClose();
          }}
        >
          {t('food.remove')}
        </button>
      </div>
    </Sheet>
  );
}
