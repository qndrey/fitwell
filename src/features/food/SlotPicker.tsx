import { SLOTS, type Slot } from '../../db/schema';
import { t, type Key } from '../../i18n';

export function SlotPicker({ value, onChange, name }: { value: Slot; onChange: (s: Slot) => void; name: string }) {
  return (
    <fieldset class="chips">
      <legend class="sr-only">{t('food.meal')}</legend>
      {SLOTS.map((s) => (
        <label key={s} class="chip">
          <input type="radio" name={name} checked={value === s} onChange={() => onChange(s)} />
          <span>{t(`slot.${s}` as Key)}</span>
        </label>
      ))}
    </fieldset>
  );
}
