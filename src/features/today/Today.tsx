import { useEffect, useState } from 'preact/hooks';
import { Screen } from '../../components/Screen';
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
    <Screen title={title} subtitle={formatDay(day)}>
      <div class="daynav">
        <button class="btn" onClick={() => go(addDays(day, -1))} aria-label={t('today.prev')}>‹</button>
        {day !== todayStr && <button class="btn" onClick={() => go(todayStr)}>{t('today.jump')}</button>}
        <button class="btn" onClick={() => go(addDays(day, 1))} aria-label={t('today.next')}>›</button>
      </div>

      <section class="card" aria-label={t('today.summary')}>
        {habitOnly ? (
          <p class="big">{entries.length === 0 ? t('today.noneYet') : `${totals.resolvedCount + totals.pendingCount} ${t('today.foodsLogged')}`}</p>
        ) : (
          <>
            <p class="big">{rounded.kcal} <span class="unit">{t('unit.kcal')}</span></p>
            <p class="macros">
              {t('macro.protein')} {fmt(rounded.protein)} g · {t('macro.carbs')} {fmt(rounded.carbs)} g · {t('macro.fat')} {fmt(rounded.fat)} g
            </p>
          </>
        )}
        {totals.pendingCount > 0 && <p class="muted">{`+${totals.pendingCount} ${t('today.pending')}`}</p>}
      </section>

      <button class="btn primary wide" onClick={() => setSheet({ kind: 'add', slot: defaultSlot() })}>{t('food.add')}</button>

      {SLOTS.map((slot) => {
        const list = entries.filter((e) => e.slot === slot);
        const st = roundForDisplay(slotTotals(entries, slot));
        return (
          <section key={slot} class="slot" aria-labelledby={`slot-${slot}`}>
            <div class="slot-head">
              <h2 id={`slot-${slot}`}>{t(`slot.${slot}` as Key)}</h2>
              {!habitOnly && list.length > 0 && <span class="muted">{st.kcal} {t('unit.kcal')}</span>}
            </div>
            {list.length > 0 && (
              <ul class="list">
                {list.map((e) => (
                  <li key={e.id}>
                    <button class="row" onClick={() => setSheet({ kind: 'edit', entry: e })}>
                      <span class="row-main">{e.food?.name ?? e.queryText}</span>
                      <span class="row-sub">
                        {quantityText(e.quantity)}
                        {!habitOnly && e.nutrition ? ` · ${Math.round(e.nutrition.kcal)} ${t('unit.kcal')}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div class="slot-actions">
              <button class="link-btn" onClick={() => setSheet({ kind: 'add', slot })}>{`+ ${t('food.addTo')} ${t(`slot.${slot}` as Key)}`}</button>
              {list.length > 1 && <button class="link-btn" onClick={() => setSheet({ kind: 'saveMeal', entries: list })}>{t('meal.saveAs')}</button>}
            </div>
          </section>
        );
      })}

      {sheet?.kind === 'add' && <AddFoodSheet day={day} initialSlot={sheet.slot} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'edit' && <EntrySheet entry={sheet.entry} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'saveMeal' && <SaveMealSheet entries={sheet.entries} onClose={() => setSheet(null)} />}
    </Screen>
  );
}
