import { useState } from 'preact/hooks';
import type { FoodEntry } from '@fitwell/core/schema';
import { Button, Field, Sheet, TextInput } from '../../ui';
import { t } from '../../i18n';
import { saveSlotAsMeal } from './actions';
import { showToast } from './toast';

export function SaveMealSheet({ entries, onClose }: { entries: FoodEntry[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  return (
    <Sheet title={t('meal.saveTitle')} onClose={onClose}>
      <form
        class="stack gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return setError(t('meal.nameError'));
          await saveSlotAsMeal(entries, name);
          showToast(t('meal.saved'));
          onClose();
        }}
      >
        <Field label={t('meal.name')} error={error}>
          {(c) => (
            <TextInput
              {...c}
              autofocus
              autocomplete="off"
              value={name}
              onInput={(e) => {
                setName((e.target as HTMLInputElement).value);
                setError('');
              }}
            />
          )}
        </Field>
        <p class="muted">{entries.map((e) => e.food?.name).filter(Boolean).join(', ')}</p>
        <Button type="submit" variant="primary" block>{t('meal.save')}</Button>
      </form>
    </Sheet>
  );
}
