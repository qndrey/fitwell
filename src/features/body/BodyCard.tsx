import { useEffect, useState } from 'preact/hooks';
import { weightFor, weightsBetween } from '../../db/bodyStore';
import { addDays } from '../../domain/dates';
import { onChange } from '../../db/broadcast';
import { getDb } from '../../db/open';
import { saveSettings } from '../../db/settings';
import type { WeightEntry } from '../../db/schema';
import { measurementReminderDue, distanceFromGoal } from '../../domain/body';
import { displayWeight, weightUnit } from '../../domain/units';
import { goals, settings } from '../../state';
import { Button, Card, LinkButton, Notice, Sparkline } from '../../ui';
import { t } from '../../i18n';
import { MeasurementsSheet } from './MeasurementsSheet';
import { WeightSheet } from './WeightSheet';
import { lastMeasurementDay } from './store';

/** Weight for the shown day, one-tap logging, and a small way in to measurements. Hidden entirely when body tracking is off. */
export function BodyCard({ day }: { day: string }) {
  const [entry, setEntry] = useState<WeightEntry | undefined>();
  const [recent, setRecent] = useState<WeightEntry[]>([]);
  const [sheet, setSheet] = useState<'weight' | 'measure' | null>(null);
  useEffect(() => {
    const load = () => {
      void weightFor(day).then(setEntry);
      void weightsBetween(addDays(day, -27), day).then(setRecent);
    };
    load();
    return onChange((c) => c.store === 'weightEntries' && load());
  }, [day]);

  const s = settings.value;
  if (s.hideBodyTracking) return null;
  const units = s.units;
  const unit = weightUnit(units);
  const goalKg = goals.value.goalWeightKg;
  // Change against the weigh-in closest to a week earlier (4 to 10 days back), in neutral ink with a sign.
  const weekAgo = entry ? [...recent].reverse().find((w) => w.day <= addDays(day, -4) && w.day >= addDays(day, -10)) : undefined;
  const delta = entry && weekAgo ? displayWeight(entry.kg - weekAgo.kg, units) : undefined;
  const due = measurementReminderDue({ now: Date.now(), lastDay: lastMeasurementDay.value, everyWeeks: s.measurementReminderWeeks, dismissedAt: s.measurementReminderDismissedAt });

  return (
    <>
      <Card labelledBy="weight-h" compact>
        <div class="stack gap-2">
          <div class="body-head">
            <div class="grow stack gap-1">
              <h2 id="weight-h" class="card-title">{t('weight.label')}</h2>
              {entry ? (
                <p class="t-stat" data-testid="weight-value">{`${displayWeight(entry.kg, units)} `}<span class="t-unit">{unit}</span></p>
              ) : (
                <p class="muted" data-testid="weight-value">{t('weight.none')}</p>
              )}
              {delta !== undefined && <p class="t-caption">{t('weight.vsWeek').replace('{d}', `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta)} ${unit}`)}</p>}
            </div>
            {entry && recent.length >= 3 && <Sparkline values={recent.map((w) => w.kg)} />}
            <Button size="sm" variant={entry ? 'secondary' : 'primary'} onClick={() => setSheet('weight')}>{entry ? t('weight.update') : t('weight.log')}</Button>
          </div>
          {goalKg !== undefined && (
            <p class="t-caption">
              {t('weight.goal')} {displayWeight(goalKg, units)} {unit}
              {entry ? ` · ${displayWeight(distanceFromGoal(entry.kg, goalKg), units)} ${unit} ${t('weight.away')}` : ''}
            </p>
          )}
          <LinkButton class="small" onClick={() => setSheet('measure')}>{t('measure.log')}</LinkButton>
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
