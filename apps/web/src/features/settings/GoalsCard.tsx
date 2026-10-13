import { useRef, useState } from 'preact/hooks';
import { parseAmount } from '@fitwell/core/domain/nutrition';
import type { Goals } from '@fitwell/core/schema';
import { goals, updateGoals } from '../../state';
import { Card, Field, TextInput } from '../../ui';
import { t } from '../../i18n';

type Key = 'kcal' | 'proteinG' | 'carbsG' | 'fatG' | 'workoutsPerWeek';

function GoalField({ id, label, unit, max, integer }: { id: Key; label: string; unit?: string; max: number; integer?: boolean }) {
  const saved = goals.value[id];
  const [text, setText] = useState(saved !== undefined ? String(saved) : '');
  const [error, setError] = useState('');
  const lastSaved = useRef(saved);
  // Follow changes made elsewhere (restore, other tab), but never undo what is being typed.
  if (saved !== lastSaved.current) {
    lastSaved.current = saved;
    const shown = saved !== undefined ? String(saved) : '';
    if (shown !== text && (document.activeElement as HTMLElement | null)?.dataset.goal !== id) setText(shown);
  }
  return (
    <Field label={unit ? `${label} (${unit})` : label} error={error} class="grow">
      {(c) => (
        <TextInput
          {...c}
          data-goal={id}
          inputMode={integer ? 'numeric' : 'decimal'}
          autocomplete="off"
          value={text}
          onInput={(e) => (setText((e.target as HTMLInputElement).value), setError(''))}
          onBlur={(e) => {
            const raw = (e.target as HTMLInputElement).value;
            const patch = (value: number | undefined) => void updateGoals({ [id]: value } as Partial<Goals>);
            if (raw.trim() === '') return patch(undefined);
            const n = parseAmount(raw);
            if (n === null || n <= 0 || n > max || (integer && !Number.isInteger(n))) return setError(t('goals.error').replace('{max}', String(max)));
            patch(n);
          }}
        />
      )}
    </Field>
  );
}

/** Optional targets. They are a gentle reference (a line on a chart, a caption), never a limit or a score. */
export function GoalsCard() {
  return (
    <Card labelledBy="goals-h">
      <div class="stack gap-3">
        <h2 id="goals-h">{t('goals.title')}</h2>
        <p class="t-caption">{t('goals.help')}</p>
        <GoalField id="kcal" label={t('goals.kcal')} unit={t('unit.kcal')} max={10000} integer />
        <div class="field-row">
          <GoalField id="proteinG" label={t('macro.protein')} unit="g" max={1000} />
          <GoalField id="carbsG" label={t('macro.carbs')} unit="g" max={1500} />
          <GoalField id="fatG" label={t('macro.fat')} unit="g" max={1000} />
        </div>
        <GoalField id="workoutsPerWeek" label={t('goals.workouts')} max={14} integer />
      </div>
    </Card>
  );
}
