import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet';
import type { FoodEntry } from '../../db/schema';
import { t } from '../../i18n';
import { saveSlotAsMeal } from './actions';
import { showToast } from './toast';

export function SaveMealSheet({ entries, onClose }: { entries: FoodEntry[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  return (
    <Sheet title={t('meal.saveTitle')} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return setError(t('meal.nameError'));
          await saveSlotAsMeal(entries, name);
          showToast(t('meal.saved'));
          onClose();
        }}
      >
        <div class="field">
          <label for="meal-name">{t('meal.name')}</label>
          <input
            id="meal-name"
            type="text"
            autofocus
            autocomplete="off"
            value={name}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'meal-err' : undefined}
            onInput={(e) => {
              setName((e.target as HTMLInputElement).value);
              setError('');
            }}
          />
          {error && <span id="meal-err" class="field-error">{error}</span>}
        </div>
        <p class="muted">{entries.map((e) => e.food?.name).filter(Boolean).join(', ')}</p>
        <button type="submit" class="btn primary wide">{t('meal.save')}</button>
      </form>
    </Sheet>
  );
}
