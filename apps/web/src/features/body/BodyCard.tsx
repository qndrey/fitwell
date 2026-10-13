import { useEffect, useState } from 'preact/hooks';
import { weightFor } from '../../db/bodyStore';
import { onChange } from '../../db/broadcast';
import { getDb } from '../../db/open';
import { saveSettings } from '../../db/settings';
import type { WeightEntry } from '@fitwell/core/schema';
import { measurementReminderDue, distanceFromGoal } from '@fitwell/core/domain/body';
import { displayWeight, weightUnit } from '@fitwell/core/domain/units';
import { goals, settings } from '../../state';
import { Button, Card, LinkButton, Notice } from '../../ui';
import { t } from '../../i18n';
import { MeasurementsSheet } from './MeasurementsSheet';
import { WeightSheet } from './WeightSheet';
import { lastMeasurementDay } from './store';

/** Weight for the shown day, one-tap logging, and a small way in to measurements. Hidden entirely when body tracking is off. */
export function BodyCard({ day }: { day: string }) {
  const [entry, setEntry] = useState<WeightEntry | undefined>();
  const [sheet, setSheet] = useState<'weight' | 'measure' | null>(null);
  useEffect(() => {
    const load = () => void weightFor(day).then(setEntry);
    load();
    return onChange((c) => c.store === 'weightEntries' && load());
  }, [day]);

  const s = settings.value;
  if (s.hideBodyTracking) return null;
  const units = s.units;
  const unit = weightUnit(units);
  const goalKg = goals.value.goalWeightKg;
  const due = measurementReminderDue({ now: Date.now(), lastDay: lastMeasurementDay.value, everyWeeks: s.measurementReminderWeeks, dismissedAt: s.measurementReminderDismissedAt });

  return (
    <>
      <Card label={t('weight.card')} compact>
        <div class="stack gap-2">
          <div class="slot-head">
            <div class="grow">
              <p class="t-overline">{t('weight.label')}</p>
              <p class="t-stat" data-testid="weight-value">{entry ? `${displayWeight(entry.kg, units)} ` : '—'}{entry && <span class="t-unit">{unit}</span>}</p>
            </div>
            <Button size="sm" variant={entry ? 'secondary' : 'primary'} onClick={() => setSheet('weight')}>{entry ? t('weight.update') : t('weight.log')}</Button>
          </div>
          {goalKg !== undefined && (
            <p class="t-caption">
              {t('weight.goal')} {displayWeight(goalKg, units)} {unit}
              {entry ? ` · ${displayWeight(distanceFromGoal(entry.kg, goalKg), units)} ${unit} ${t('weight.away')}` : ''}
            </p>
          )}
          <LinkButton onClick={() => setSheet('measure')}>{t('measure.log')}</LinkButton>
          {due && (
            <Notice quiet>
              <div class="stack gap-2">
                <span>{t('measure.due')}</span>
                <div class="cluster gap-2">
                  <Button size="sm" variant="primary" onClick={() => setSheet('measure')}>{t('measure.log')}</Button>
                  <Button size="sm" onClick={async () => void saveSettings(await getDb(), { measurementReminderDismissedAt: Date.now() })}>{t('backup.reminder.later')}</Button>
                </div>
              </div>
            </Notice>
          )}
        </div>
      </Card>
      {sheet === 'weight' && <WeightSheet day={day} onClose={() => setSheet(null)} />}
      {sheet === 'measure' && <MeasurementsSheet day={day} onClose={() => setSheet(null)} />}
    </>
  );
}
