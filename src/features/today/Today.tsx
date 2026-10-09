import { useEffect, useState } from 'preact/hooks';
import { BigNumber, Badge, Button, Card, Icon, LinkButton, List, ListRow, Notice, Screen, StatGrid } from '../../ui';
import { addDays, formatDay, today } from '../../domain/dates';
import { roundForDisplay } from '../../domain/nutrition';
import { dayTotals, slotTotals } from '../../domain/totals';
import { SLOTS, type FoodEntry, type Slot } from '../../db/schema';
import { routeDay } from '../../router';
import { settings } from '../../state';
import { t, type Key } from '../../i18n';
import { dayEntries, watchDay } from '../food/dayState';
import { displayDistance, distanceUnit } from '../../domain/units';
import { AddFoodSheet } from '../food/AddFoodSheet';
import { EntrySheet } from '../food/EntrySheet';
import { BackupReminder } from './BackupReminder';
import { AddWorkoutSheet } from '../workout/AddWorkoutSheet';
import { CardioSheet } from '../workout/CardioSheet';
import { dayWorkouts, watchWorkouts } from '../workout/dayState';
import { cardioKcal, describeWorkout } from '../../domain/workouts';
import type { Workout } from '../../db/schema';
import { PendingEntrySheet, pendingStatus } from '../food/PendingEntrySheet';
import { toConfirmCount } from '../review/store';
import { SaveMealSheet } from '../food/SaveMealSheet';
import { defaultSlot, entryLabel, fmt, quantityText } from '../food/format';

type Sheet = { kind: 'add'; slot: Slot } | { kind: 'edit'; entry: FoodEntry } | { kind: 'pending'; entry: FoodEntry } | { kind: 'addWorkout' } | { kind: 'cardio'; workout: Workout } | { kind: 'saveMeal'; entries: FoodEntry[] } | null;

const go = (day: string) => (location.hash = day === today() ? '#/today' : `#/today/${day}`);

export function Today() {
  const todayStr = today();
  const day = routeDay.value ?? todayStr;
  const [sheet, setSheet] = useState<Sheet>(null);
  useEffect(() => watchDay(day), [day]);
  useEffect(() => watchWorkouts(day), [day]);
  const workouts = dayWorkouts.value;

  const entries = dayEntries.value;
  const habitOnly = settings.value.habitOnly;
  const totals = dayTotals(entries);
  const rounded = roundForDisplay(totals);
  const toConfirm = toConfirmCount();

  const title = day === todayStr ? t('nav.today') : day === addDays(todayStr, -1) ? t('today.yesterday') : day === addDays(todayStr, 1) ? t('today.tomorrow') : formatDay(day, { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <Screen
      title={title}
      subtitle={formatDay(day)}
      nav={{
        prevLabel: t('today.prev'),
        nextLabel: t('today.next'),
        onPrev: () => go(addDays(day, -1)),
        onNext: () => go(addDays(day, 1)),
        extra: day !== todayStr && <button class="link-btn" onClick={() => go(todayStr)}>{t('today.jump')}</button>,
      }}
    >
      <Card label={t('today.summary')} compact>
        {habitOnly ? (
          <p class="t-stat">{entries.length === 0 ? t('today.noneYet') : `${totals.resolvedCount + totals.pendingCount} ${t('today.foodsLogged')}`}</p>
        ) : (
          <div class="stack gap-2">
            <BigNumber value={rounded.kcal} unit={t('unit.kcal')} />
            <StatGrid
              items={[
                { label: t('macro.protein'), value: `${fmt(rounded.protein)} g` },
                { label: t('macro.carbs'), value: `${fmt(rounded.carbs)} g` },
                { label: t('macro.fat'), value: `${fmt(rounded.fat)} g` },
              ]}
            />
          </div>
        )}
        {totals.pendingCount > 0 && <p class="muted mt-2">{`+${totals.pendingCount} ${t('today.pending')}`}</p>}
      </Card>

      {toConfirm > 0 && (
        <Notice>
          <div class="cluster between">
            <span>{toConfirm === 1 ? t('today.toConfirm.one') : t('today.toConfirm.many').replace('{n}', String(toConfirm))}</span>
            <Button size="sm" variant="primary" onClick={() => (location.hash = '#/review')}>{t('today.review')}</Button>
          </div>
        </Notice>
      )}

      <BackupReminder />

      {SLOTS.map((slot) => {
        const list = entries.filter((e) => e.slot === slot);
        const st = roundForDisplay(slotTotals(entries, slot));
        return (
          <section key={slot} class="slot stack gap-2" aria-labelledby={`slot-${slot}`}>
            <div class="slot-head">
              <h2 id={`slot-${slot}`}>{t(`slot.${slot}` as Key)}</h2>
              {!habitOnly && list.length > 0 && <span class="t-caption">{st.kcal} {t('unit.kcal')}</span>}
              <Button size="sm" onClick={() => setSheet({ kind: 'add', slot })} aria-label={`${t('food.addTo')} ${t(`slot.${slot}` as Key)}`}>
                <Icon name="plus" size="sm" />{t('common.add')}
              </Button>
            </div>
            {list.length > 0 && (
              <List>
                {list.map((e) => (
                  <ListRow
                    key={e.id}
                    main={entryLabel(e)}
                    sub={
                      e.state === 'resolved' ? (
                        `${quantityText(e.quantity)}${!habitOnly && e.nutrition ? ` · ${Math.round(e.nutrition.kcal)} ${t('unit.kcal')}` : ''}${e.manual ? ` · ${t('manual.badge')}` : ''}`
                      ) : (
                        <>
                          {quantityText(e.quantity)} ·{' '}
                          <Badge>{e.state === 'pending' ? t('pending.badge') : e.state === 'awaiting_confirmation' ? t('confirm.badge') : t('unmatched.badge')}</Badge>
                          {e.state === 'pending' && ` ${pendingStatus(e)}`}
                        </>
                      )
                    }
                    onClick={() => (e.state === 'resolved' ? setSheet({ kind: 'edit', entry: e }) : e.state === 'pending' ? setSheet({ kind: 'pending', entry: e }) : void (location.hash = '#/review'))}
                  />
                ))}
              </List>
            )}
            {list.length > 1 && <LinkButton onClick={() => setSheet({ kind: 'saveMeal', entries: list })}>{t('meal.saveAs')}</LinkButton>}
          </section>
        );
      })}

      <section class="slot stack gap-2" aria-labelledby="workouts-h">
        <div class="slot-head">
          <h2 id="workouts-h">{t('workout.title')}</h2>
          <Button size="sm" onClick={() => setSheet({ kind: 'addWorkout' })} aria-label={t('workout.add')}>
            <Icon name="plus" size="sm" />{t('common.add')}
          </Button>
        </div>
        {workouts.length > 0 && (
          <List>
            {workouts.map((w) => {
              const d = describeWorkout(w);
              const kcal = w.cardio ? cardioKcal(w.cardio) : undefined;
              const dist = w.cardio?.distanceKm;
              const extras = [
                dist ? `${Math.round(displayDistance(dist, settings.value.units) * 10) / 10} ${distanceUnit(settings.value.units)}` : '',
                !habitOnly && kcal !== undefined ? `${w.cardio?.kcalOverride !== undefined ? '' : '≈ '}${kcal} ${t('unit.kcal')}` : '',
              ].filter(Boolean);
              return (
                <ListRow
                  key={w.id}
                  main={d.title}
                  sub={[t(w.type === 'cardio' ? 'workout.cardio' : 'workout.strength'), d.detail, ...extras].join(' · ')}
                  onClick={() => (w.type === 'strength' ? void (location.hash = `#/workout/${w.id}`) : setSheet({ kind: 'cardio', workout: w }))}
                />
              );
            })}
          </List>
        )}
      </section>

      <div class="primary-bar">
        <Button variant="primary" size="lg" block onClick={() => setSheet({ kind: 'add', slot: defaultSlot() })}>{t('food.add')}</Button>
      </div>

      {sheet?.kind === 'add' && <AddFoodSheet day={day} initialSlot={sheet.slot} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'addWorkout' && <AddWorkoutSheet day={day} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'cardio' && <CardioSheet day={day} existing={sheet.workout} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'pending' && <PendingEntrySheet entry={sheet.entry} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'edit' && <EntrySheet entry={sheet.entry} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'saveMeal' && <SaveMealSheet entries={sheet.entries} onClose={() => setSheet(null)} />}
    </Screen>
  );
}
