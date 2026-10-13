import { SLOTS, type Slot } from '@fitwell/core/schema';
import { Segmented } from '../../ui';
import { t, type Key } from '../../i18n';

export function SlotPicker({ value, onChange, name }: { value: Slot; onChange: (s: Slot) => void; name: string }) {
  return (
    <Segmented
      legend={t('food.meal')}
      name={name}
      value={value}
      onChange={onChange}
      options={SLOTS.map((s) => ({ value: s, label: t(`slot.${s}` as Key) }))}
    />
  );
}
