import { useEffect, useState } from 'preact/hooks';
import { BigNumber, Button, Card, Icon, LinkButton, List, ListRow, Screen, StatGrid } from '../../ui';
import { addDays, formatDay, today } from '../../domain/dates';
import { roundForDisplay } from '../../domain/nutrition';
import { dayTotals, slotTotals } from '../../domain/totals';
import { SLOTS, type FoodEntry, type Slot } from '../../db/schema';
import { routeDay } from '../../router';
import { settings } from '../../state';
import { t, type Key } from '../../i18n';
import { dayEntries, watchDay } from '../food/dayState';
import { AddFoodSheet } from '../food/AddFoodSheet';
import { EntrySheet } from '../food/EntrySheet';
import { BackupReminder } from './BackupReminder';
import { SaveMealSheet } from '../food/SaveMealSheet';
import { defaultSlot, fmt, quantityText } from '../food/format';

type Sheet = { kind: 'add'; slot: Slot } | { kind: 'edit'; entry: FoodEntry } | { kind: 'saveMeal'; entries: FoodEntry[] } | null;

const go = (day: string) => (location.hash = day === today() ? '#/today' : `#/today/${day}`);

export function Today() {
  const todayStr = today();
  const day = routeDay.value ?? todayStr;
  const [sheet, setSheet] = useState<Sheet>(null);
  useEffect(() => watchDay(day), [day]);

  const entries = dayEntries.value;
  const habitOnly = settings.value.habitOnly;
  const totals = dayTotals(entries);
  const rounded = roundForDisplay(totals);

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
                    main={e.food?.name ?? e.queryText}
                    sub={`${quantityText(e.quantity)}${!habitOnly && e.nutrition ? ` · ${Math.round(e.nutrition.kcal)} ${t('unit.kcal')}` : ''}`}
                    onClick={() => setSheet({ kind: 'edit', entry: e })}
                  />
                ))}
              </List>
            )}
            {list.length > 1 && <LinkButton onClick={() => setSheet({ kind: 'saveMeal', entries: list })}>{t('meal.saveAs')}</LinkButton>}
          </section>
        );
      })}

      <div class="primary-bar">
        <Button variant="primary" size="lg" block onClick={() => setSheet({ kind: 'add', slot: defaultSlot() })}>{t('food.add')}</Button>
      </div>

      {sheet?.kind === 'add' && <AddFoodSheet day={day} initialSlot={sheet.slot} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'edit' && <EntrySheet entry={sheet.entry} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'saveMeal' && <SaveMealSheet entries={sheet.entries} onClose={() => setSheet(null)} />}
    </Screen>
  );
}
