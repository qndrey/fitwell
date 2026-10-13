import { useEffect, useRef, useState } from 'preact/hooks';
import { BigNumber, Badge, Button, Card, Icon, LinkButton, List, ListRow, Meter, Notice, Screen, StatGrid, useCountUp } from '../../ui';
import { addDays, formatDay, today } from '@fitwell/core/domain/dates';
import { dayTotals, slotTotals } from '@fitwell/core/domain/totals';
import { SLOTS, type FoodEntry, type Slot } from '@fitwell/core/schema';
import { entriesForDay, entriesRepo } from '../../db/foodStore';
import { onChange } from '../../db/broadcast';
import { routeDay } from '../../router';
import { goals, settings } from '../../state';
import { t, type Key } from '../../i18n';
import { dayEntries, dayLoaded, watchDay } from '../food/dayState';
import { displayDistance, distanceUnit } from '@fitwell/core/domain/units';
import { AddFoodSheet } from '../food/AddFoodSheet';
import { EntrySheet } from '../food/EntrySheet';
import { BackupReminder } from './BackupReminder';
import { BodyCard } from '../body/BodyCard';
import { InstallHint } from './InstallHint';
import { WeekGoal } from './WeekGoal';
import { Welcome } from './Welcome';
import { collapsedMeals, setMealCollapsed } from './collapse';
import { CardioSheet } from '../workout/CardioSheet';
import { Elapsed } from '../workout/Elapsed';
import { dayWorkouts, watchWorkouts } from '../workout/dayState';
import { cardioKcal, describeWorkout, workoutStatus, workoutTally } from '@fitwell/core/domain/workouts';
import type { Workout } from '@fitwell/core/schema';
import { PendingEntrySheet, pendingStatus } from '../food/PendingEntrySheet';
import { toConfirmCount } from '../review/store';
import { SaveMealSheet } from '../food/SaveMealSheet';
import { copyEntries } from '../food/actions';
import { showToast } from '../food/toast';
import { defaultSlot, entryLabel, fmt, quantityText } from '../food/format';

type Sheet = { kind: 'add'; slot: Slot } | { kind: 'edit'; entry: FoodEntry } | { kind: 'pending'; entry: FoodEntry } | { kind: 'cardio'; workout: Workout } | { kind: 'cardioNew' } | { kind: 'saveMeal'; entries: FoodEntry[] } | null;

const go = (day: string) => (location.hash = day === today() ? '#/today' : `#/today/${day}`);

/** Yesterday's resolved entries, kept fresh, so an empty meal can offer "Same as yesterday". */
function useYesterday(day: string): FoodEntry[] {
  const [list, setList] = useState<FoodEntry[]>([]);
  useEffect(() => {
    const prev = addDays(day, -1);
    const load = () => void entriesForDay(prev).then((l) => setList(l.filter((e) => e.state === 'resolved')));
    load();
    return onChange((c) => c.store === 'foodEntries' && load());
  }, [day]);
  return list;
}

export function Today() {
  const todayStr = today();
  const day = routeDay.value ?? todayStr;
  const isToday = day === todayStr;
  const [sheet, setSheet] = useState<Sheet>(null);
  useEffect(() => watchDay(day), [day]);
  useEffect(() => watchWorkouts(day), [day]);
  const workouts = dayWorkouts.value;
  const yesterday = useYesterday(day);

  const entries = dayEntries.value;
  const habitOnly = settings.value.habitOnly;
  const totals = dayTotals(entries);
  const kcal = Math.round(totals.kcal);
  const kcalShown = Math.round(useCountUp(kcal));
  const toConfirm = toConfirmCount();
  const g = goals.value;

  // A meal that gains an entry opens by itself, whichever way it was added, so the new food is never hidden.
  // The first load of a day is only the starting point: what was already there is not "added".
  const counts = useRef<{ day: string; n: Record<string, number> | null }>({ day, n: null });
  const loaded = dayLoaded.value === day;
  useEffect(() => {
    if (!loaded) {
      counts.current = { day, n: null };
      return;
    }
    const now: Record<string, number> = {};
    for (const slot of SLOTS) now[slot] = entries.filter((e) => e.slot === slot).length;
    const before = counts.current.day === day ? counts.current.n : null;
    if (before) for (const slot of SLOTS) if (now[slot]! > (before[slot] ?? 0) && collapsedMeals.value.has(slot)) setMealCollapsed(slot, false);
    counts.current = { day, n: now };
  }, [entries, day, loaded]);

  const goStart = () => (location.hash = isToday ? '#/start' : `#/start/${day}`);
  const title = isToday ? t('nav.today') : day === addDays(todayStr, -1) ? t('today.yesterday') : day === addDays(todayStr, 1) ? t('today.tomorrow') : formatDay(day, { weekday: 'short', month: 'short', day: 'numeric' });

  const macro = (label: string, value: number, goal: number | undefined, tone: 1 | 2 | 3 | 4) => ({
    label,
    value: `${Math.round(value)} g`,
    ...(goal ? { meter: value / goal, note: t('today.ofGoal').replace('{n}', `${fmt(goal)} g`), tone } : {}),
  });

  async function sameAsYesterday(slot: Slot) {
    const ids = await copyEntries(day, slot, yesterday.filter((e) => e.slot === slot));
    showToast(t('today.copied').replace('{n}', String(ids.length)), { label: t('food.undo'), run: () => void Promise.all(ids.map((id) => entriesRepo.remove(id))) });
  }

  return (
    <Screen
      title={title}
      subtitle={formatDay(day)}
      onSubtitle={!isToday ? () => go(todayStr) : undefined}
      subtitleAction={t('today.goToday')}
      nav={{
        prevLabel: t('today.prev'),
        nextLabel: t('today.next'),
        onPrev: () => go(addDays(day, -1)),
        onNext: () => go(addDays(day, 1)),
        pick: { label: t('today.pickDay'), value: day, onPick: go },
      }}
    >
      <Card label={t('today.summary')} compact>
        {habitOnly ? (
          <p class="t-stat">{entries.length === 0 ? t('today.noneYet') : `${totals.resolvedCount + totals.pendingCount} ${t('today.foodsLogged')}`}</p>
        ) : (
          <div class="stack gap-3">
            <div class="stack gap-2">
              <BigNumber value={fmt(kcalShown)} unit={t('unit.kcal')} />
              {g.kcal !== undefined && (
                <>
                  <Meter value={kcal / g.kcal} />
                  {/* A reference, never a limit or a score: no "left", no "over" (docs/DESIGN_SYSTEM.md, Writing). */}
                  <p class="t-caption">{t('today.kcalGoal').replace('{goal}', fmt(g.kcal))}</p>
                </>
              )}
            </div>
            <StatGrid
              items={[
                macro(t('macro.protein'), totals.protein, g.proteinG, 2),
                macro(t('macro.carbs'), totals.carbs, g.carbsG, 3),
                macro(t('macro.fat'), totals.fat, g.fatG, 4),
              ]}
            />
          </div>
        )}
        {totals.pendingCount > 0 && <p class="t-caption mt-2">{`+${totals.pendingCount} ${t('today.pending')}`}</p>}
      </Card>

      <BodyCard day={day} />

      {isToday && <Welcome onFood={() => setSheet({ kind: 'add', slot: defaultSlot() })} onWorkout={goStart} />}

      {SLOTS.map((slot) => {
        const list = entries.filter((e) => e.slot === slot);
        const slotKcal = Math.round(slotTotals(entries, slot).kcal);
        const fromYesterday = list.length === 0 ? yesterday.filter((e) => e.slot === slot) : [];
        const folded = list.length > 0 && collapsedMeals.value.has(slot);
        const toConfirmHere = list.filter((e) => e.state !== 'resolved').length;
        return (
          <section key={slot} class={list.length ? 'slot stack gap-2' : 'slot empty-slot'} aria-labelledby={`slot-${slot}`}>
            <div class="slot-head">
              {list.length > 0 ? (
                <button type="button" class="ex-toggle" aria-expanded={!folded} aria-controls={`meal-${slot}`} onClick={() => setMealCollapsed(slot, !folded)}>
                  <span class="ex-title">
                    <h2 id={`slot-${slot}`}>{t(`slot.${slot}` as Key)}</h2>
                    {folded && (
                      <span class="t-caption">
                        {list.length} {t(list.length === 1 ? 'history.food.one' : 'history.food.many')}
                        {toConfirmHere > 0 && <> · <Badge tone="attention">{toConfirmHere} {t('today.toConfirm')}</Badge></>}
                      </span>
                    )}
                  </span>
                  <span class={folded ? 'chev' : 'chev open'}><Icon name="expand" size="sm" /></span>
                </button>
              ) : (
                <h2 id={`slot-${slot}`}>{t(`slot.${slot}` as Key)}</h2>
              )}
              {list.length === 0 && fromYesterday.length > 0 && (
                <LinkButton class="small" onClick={() => void sameAsYesterday(slot)} aria-label={`${t('today.sameAsYesterday')}: ${t(`slot.${slot}` as Key)}`}>
                  <Icon name="copy" size="sm" />{t('today.sameAsYesterday')}
                </LinkButton>
              )}
              {list.length === 0 && fromYesterday.length === 0 && <span class="t-caption">{t('today.nothingYet')}</span>}
              {!habitOnly && list.length > 0 && <span class="t-caption">{fmt(slotKcal)} {t('unit.kcal')}</span>}
              <Button icon class="accent" onClick={() => setSheet({ kind: 'add', slot })} aria-label={`${t('food.addTo')} ${t(`slot.${slot}` as Key)}`}>
                <Icon name="plus" />
              </Button>
            </div>
            {list.length > 0 && (
              <div id={`meal-${slot}`} class="stack gap-2" hidden={folded}>
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
                            <Badge tone="attention">{e.state === 'pending' ? t('pending.badge') : e.state === 'awaiting_confirmation' ? t('confirm.badge') : t('unmatched.badge')}</Badge>
                            {e.state === 'pending' && ` ${pendingStatus(e)}`}
                          </>
                        )
                      }
                      onClick={() => (e.state === 'resolved' ? setSheet({ kind: 'edit', entry: e }) : e.state === 'pending' ? setSheet({ kind: 'pending', entry: e }) : void (location.hash = '#/review'))}
                    />
                  ))}
                </List>
                {list.length > 1 && <LinkButton class="small align-start" onClick={() => setSheet({ kind: 'saveMeal', entries: list })}>{t('meal.saveAs')}</LinkButton>}
              </div>
            )}
          </section>
        );
      })}

      <section class={workouts.length ? 'slot stack gap-2' : 'slot empty-slot'} aria-labelledby="workouts-h">
        <div class="slot-head">
          <h2 id="workouts-h">{t('workout.title')}</h2>
          {workouts.length === 0 && <span class="t-caption">{t('today.nothingYet')}</span>}
          <Button icon class="accent" onClick={goStart} aria-label={t('workout.add')}>
            <Icon name="plus" />
          </Button>
        </div>
        <WeekGoal day={day} />
        {workouts.length > 0 && (
          <List>
            {workouts.map((w) => {
              const d = describeWorkout(w);
              const kcal = w.cardio ? cardioKcal(w.cardio) : undefined;
              const dist = w.cardio?.distanceKm;
              const extras = [
                dist ? `${displayDistance(dist, settings.value.units)} ${distanceUnit(settings.value.units)}` : '',
                !habitOnly && kcal !== undefined ? `${w.cardio?.kcalOverride !== undefined ? '' : '≈ '}${kcal} ${t('unit.kcal')}` : '',
              ].filter(Boolean);
              const live = w.type === 'strength' && workoutStatus(w) === 'active' ? workoutTally(w.exercises ?? []) : undefined;
              return (
                <ListRow
                  key={w.id}
                  main={d.title}
                  sub={
                    live ? (
                      <span class="live-sub">
                        <span><Badge tone="attention">{t('workout.inProgress')}</Badge> <Elapsed startedAt={w.startedAt!} /> · {t('workout.setsDone').replace('{done}', String(live.done)).replace('{total}', String(live.total))}</span>
                        {live.total > 0 && <Meter value={live.done / live.total} />}
                      </span>
                    ) : (
                      [t(w.type === 'cardio' ? 'workout.cardio' : 'workout.strength'), d.detail, ...extras].join(' · ')
                    )
                  }
                  onClick={() => (w.type === 'strength' ? void (location.hash = `#/workout/${w.id}`) : setSheet({ kind: 'cardio', workout: w }))}
                />
              );
            })}
          </List>
        )}
      </section>

      {/* Housekeeping comes after the day itself, and only on today: it is about you, not about this date. */}
      {isToday && toConfirm > 0 && (
        <Notice attention>
          <div class="cluster between">
            <span>{toConfirm === 1 ? t('today.toConfirm.one') : t('today.toConfirm.many').replace('{n}', String(toConfirm))}</span>
            <Button size="sm" onClick={() => (location.hash = '#/review')}>{t('today.review')}</Button>
          </div>
        </Notice>
      )}
      {isToday && <BackupReminder />}
      {isToday && <InstallHint />}

      <div class="fab-space" aria-hidden="true" />
      <AddMenu
        onFood={() => setSheet({ kind: 'add', slot: defaultSlot() })}
        onStrength={goStart}
        onCardio={() => setSheet({ kind: 'cardioNew' })}
      />

      {sheet?.kind === 'add' && <AddFoodSheet day={day} initialSlot={sheet.slot} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'cardioNew' && <CardioSheet day={day} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'cardio' && <CardioSheet day={day} existing={sheet.workout} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'pending' && <PendingEntrySheet entry={sheet.entry} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'edit' && <EntrySheet entry={sheet.entry} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'saveMeal' && <SaveMealSheet entries={sheet.entries} onClose={() => setSheet(null)} />}
    </Screen>
  );
}

/** Hidden while you scroll down through the day, back as soon as you scroll up or reach the end. */
function useHideOnScroll(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const atEnd = window.innerHeight + y >= document.documentElement.scrollHeight - 8;
      if (Math.abs(y - last) < 12 && !atEnd) return;
      setHidden(y > last && y > 80 && !atEnd);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return hidden;
}

/** Floating + at the bottom right: pick what to log. Closes on Escape or a tap anywhere else. */
function AddMenu({ onFood, onStrength, onCardio }: { onFood: () => void; onStrength: () => void; onCardio: () => void }) {
  const [open, setOpen] = useState(false);
  const hidden = useHideOnScroll() && !open;
  const fab = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        fab.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  // Sheets return focus to whatever was focused when they opened: make that the + button, not a menu item that is gone.
  const pick = (fn: () => void) => () => {
    fab.current?.focus();
    setOpen(false);
    fn();
  };
  return (
    <div class={hidden ? 'fab-wrap away' : 'fab-wrap'}>
      {open && <div class="fab-backdrop" onClick={() => setOpen(false)} />}
      <button ref={fab} type="button" class={open ? 'fab open' : 'fab'} aria-label={t('common.add')} aria-expanded={open} aria-controls="add-menu" onClick={() => setOpen(!open)}>
        <Icon name="plus" />
      </button>
      {open && (
        <div class="fab-menu" id="add-menu">
          <button type="button" class="fab-item" onClick={pick(onFood)}><Icon name="food" />{t('food.add')}</button>
          <button type="button" class="fab-item" onClick={pick(onStrength)}><Icon name="strength" />{t('workout.startTitle')}</button>
          <button type="button" class="fab-item" onClick={pick(onCardio)}><Icon name="cardio" />{t('workout.newCardio')}</button>
        </div>
      )}
    </div>
  );
}
