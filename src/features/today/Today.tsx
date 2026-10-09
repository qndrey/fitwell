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
      <section class="card summary" aria-label={t('today.summary')}>
        {habitOnly ? (
          <p class="big">{entries.length === 0 ? t('today.noneYet') : `${totals.resolvedCount + totals.pendingCount} ${t('today.foodsLogged')}`}</p>
        ) : (
          <>
            <p class="big">{rounded.kcal} <span class="unit">{t('unit.kcal')}</span></p>
            <dl class="macros">
              {([['protein', rounded.protein], ['carbs', rounded.carbs], ['fat', rounded.fat]] as const).map(([k, v]) => (
                <div key={k}>
                  <dd>{fmt(v)} g</dd>
                  <dt>{t(`macro.${k}` as Key)}</dt>
                </div>
              ))}
            </dl>
          </>
        )}
        {totals.pendingCount > 0 && <p class="muted">{`+${totals.pendingCount} ${t('today.pending')}`}</p>}
      </section>

      {SLOTS.map((slot) => {
        const list = entries.filter((e) => e.slot === slot);
        const st = roundForDisplay(slotTotals(entries, slot));
        return (
          <section key={slot} class="slot" aria-labelledby={`slot-${slot}`}>
            <div class="slot-head">
              <h2 id={`slot-${slot}`}>{t(`slot.${slot}` as Key)}</h2>
              {!habitOnly && list.length > 0 && <span class="muted slot-kcal">{st.kcal} {t('unit.kcal')}</span>}
              <button class="btn small" onClick={() => setSheet({ kind: 'add', slot })} aria-label={`${t('food.addTo')} ${t(`slot.${slot}` as Key)}`}>
                + {t('common.add')}
              </button>
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
            {list.length > 1 && <button class="link-btn" onClick={() => setSheet({ kind: 'saveMeal', entries: list })}>{t('meal.saveAs')}</button>}
          </section>
        );
      })}

      <div class="primary-bar">
        <button class="btn primary wide" onClick={() => setSheet({ kind: 'add', slot: defaultSlot() })}>{t('food.add')}</button>
      </div>

      {sheet?.kind === 'add' && <AddFoodSheet day={day} initialSlot={sheet.slot} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'edit' && <EntrySheet entry={sheet.entry} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'saveMeal' && <SaveMealSheet entries={sheet.entries} onClose={() => setSheet(null)} />}
    </Screen>
  );
}
