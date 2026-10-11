import { signal } from '@preact/signals';
import { useMemo } from 'preact/hooks';
import { addDays, addMonths, formatDay, monthKey, parseDay, toDay, today as todayDay, weekStart, type Day } from '../../domain/dates';
import { aggregateDays, type DayAgg } from '../../domain/stats';
import { displayWeight, weightUnit } from '../../domain/units';
import { settings } from '../../state';
import { Badge, Button, Card, EmptyState, Icon, LinkButton, List, ListRow, Screen, SectionTitle, Segmented } from '../../ui';
import { t } from '../../i18n';
import { useEarliest, useRangeData } from '../stats/data';

type View = 'calendar' | 'list';
const view = signal<View>('calendar');
/** First day of the month being looked at; remembered while the app is open. */
const shownMonth = signal<Day | null>(null);
const listMonths = signal(3);
/** The day whose preview is shown under the calendar. */
const selected = signal<Day | null>(null);

const open = (day: Day) => (location.hash = day === todayDay() ? '#/today' : `#/today/${day}`);
const fmtKcal = (n: number) => new Intl.NumberFormat().format(Math.round(n));

/** One short sentence per day, for screen readers and the list view. Respects habit-only and hidden body tracking. */
function describe(a: DayAgg | undefined): string[] {
  if (!a) return [];
  const s = settings.value;
  const parts: string[] = [];
  if (a.foodCount > 0) parts.push(s.habitOnly ? `${a.foodCount} ${t(a.foodCount === 1 ? 'history.food.one' : 'history.food.many')}` : `${fmtKcal(a.kcal)} ${t('unit.kcal')}`);
  const w = a.strength + a.cardio;
  if (w > 0) parts.push(`${w} ${t(w === 1 ? 'history.workout.one' : 'history.workout.many')}`);
  if (!s.hideBodyTracking) {
    if (a.weightKg !== undefined) parts.push(`${displayWeight(a.weightKg, s.units)} ${weightUnit(s.units)}`);
    if (a.measured) parts.push(t('history.measured'));
  }
  if (a.pendingCount > 0) parts.push(`${a.pendingCount} ${t('history.pending')}`);
  return parts;
}

function Calendar() {
  const end = todayDay();
  const month = shownMonth.value ?? `${monthKey(end)}-01`;
  const first = parseDay(month);
  const lastDay = toDay(new Date(first.getFullYear(), first.getMonth() + 1, 0));
  const gridStart = weekStart(month);
  const data = useRangeData(gridStart, addDays(lastDay, 6));
  const days = useMemo(() => (data ? aggregateDays(data) : new Map<Day, DayAgg>()), [data]);
  const cells: (Day | null)[] = [];
  for (let i = 0; i < 42; i++) {
    const day = addDays(gridStart, i);
    if (i >= 35 && day > lastDay) break;
    cells.push(day >= month && day <= lastDay ? day : null);
  }
  const monthName = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(first);
  const logged = [...days.values()].filter((a) => a.day >= month && a.day <= lastDay).length;
  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(parseDay(addDays(gridStart, i))));

  return (
    <Card labelledBy="cal-h">
      <div class="stack gap-3">
        <div class="daybar">
          <Button icon aria-label={t('history.prevMonth')} onClick={() => (shownMonth.value = addMonths(month, -1))}><Icon name="prev" size="lg" /></Button>
          <div class="screen-title"><h2 id="cal-h">{monthName}</h2><p class="muted">{logged} {t(logged === 1 ? 'history.dayLogged.one' : 'history.dayLogged.many')}</p></div>
          <Button icon aria-label={t('history.nextMonth')} onClick={() => (shownMonth.value = addMonths(month, 1))}><Icon name="next" size="lg" /></Button>
        </div>
        <div class="cal" role="grid" aria-labelledby="cal-h">
          <div class="cal-row" role="row">
            {weekdays.map((w) => <span key={w} class="cal-head" role="columnheader">{w}</span>)}
          </div>
          {Array.from({ length: cells.length / 7 }, (_, r) => (
            <div class="cal-row" role="row" key={r}>
              {cells.slice(r * 7, r * 7 + 7).map((day, c) =>
                day === null ? (
                  <span key={c} class="cal-empty" role="gridcell" />
                ) : (
                  <span key={day} role="gridcell">
                    <DayCell day={day} agg={days.get(day)} isToday={day === end} />
                  </span>
                ),
              )}
            </div>
          ))}
        </div>
        <ul class="cal-legend" aria-label={t('history.legend')}>
          <li><span class="mark mark-food" aria-hidden="true" />{t('history.legend.food')}</li>
          <li><span class="mark mark-workout" aria-hidden="true" />{t('history.legend.workout')}</li>
          {!settings.value.hideBodyTracking && <li><span class="mark mark-body" aria-hidden="true" />{t('history.legend.body')}</li>}
          <li><span class="cal-pending-key" aria-hidden="true" />{t('history.legend.pending')}</li>
        </ul>
        {shownMonth.value !== null && monthKey(month) !== monthKey(end) && <LinkButton onClick={() => (shownMonth.value = null)}>{t('history.thisMonth')}</LinkButton>}
      </div>
    </Card>
  );
}

/** What a day held, and its week at a glance, before opening it. */
function DayPreview({ day }: { day: Day }) {
  const start = weekStart(day);
  const data = useRangeData(start, addDays(start, 6));
  const week = useMemo(() => (data ? [...aggregateDays(data).values()] : []), [data]);
  const agg = week.find((a) => a.day === day);
  const s = settings.value;
  const parts = describe(agg);
  const foodDays = week.filter((a) => a.foodCount > 0);
  const workouts = week.reduce((n, a) => n + a.strength + a.cardio, 0);
  const avgKcal = foodDays.length ? foodDays.reduce((n, a) => n + a.kcal, 0) / foodDays.length : 0;
  const weekParts = [
    `${week.filter((a) => a.foodCount + a.strength + a.cardio > 0 || a.weightKg !== undefined).length} ${t('history.week.days')}`,
    `${workouts} ${t(workouts === 1 ? 'history.workout.one' : 'history.workout.many')}`,
    !s.habitOnly && foodDays.length ? `${t('history.week.avg')} ${fmtKcal(avgKcal)} ${t('unit.kcal')}` : '',
  ].filter(Boolean);
  return (
    <Card labelledBy="preview-h" compact>
      <div class="stack gap-2">
        <h2 id="preview-h" class="card-title">{formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
        <p>{parts.length ? parts.join(' · ') : t('history.nothing')}</p>
        <p class="t-caption">{t('history.week.of').replace('{d}', formatDay(start, { month: 'short', day: 'numeric' }))}: {weekParts.join(' · ')}</p>
        <Button variant="primary" class="align-start" onClick={() => open(day)}>{t('history.openDay')}</Button>
      </div>
    </Card>
  );
}

function DayCell({ day, agg, isToday }: { day: Day; agg: DayAgg | undefined; isToday: boolean }) {
  const s = settings.value;
  const parts = describe(agg);
  const food = !!agg && (agg.foodCount > 0 || agg.pendingCount > 0);
  const work = !!agg && agg.strength + agg.cardio > 0;
  const body = !s.hideBodyTracking && !!agg && (agg.weightKg !== undefined || agg.measured);
  const pending = !!agg && agg.pendingCount > 0;
  const has = food || work || body || pending;
  const isSelected = selected.value === day;
  return (
    <button
      type="button"
      class={has ? 'cal-day has' : 'cal-day'}
      data-pending={pending ? '' : undefined}
      aria-current={isToday ? 'date' : undefined}
      aria-pressed={isSelected}
      aria-label={`${formatDay(day)}${parts.length ? `: ${parts.join(', ')}` : `: ${t('history.nothing')}`}`}
      // First tap shows the day below the calendar; a second tap (or "Open this day") goes there.
      onClick={() => (isSelected ? open(day) : (selected.value = day))}
    >
      <span class="cal-num">{Number(day.slice(8))}</span>
      <span class="cal-marks" aria-hidden="true">
        {food && <span class="mark mark-food" />}
        {work && <span class="mark mark-workout" />}
        {body && <span class="mark mark-body" />}
      </span>
    </button>
  );
}

function DayList() {
  const end = todayDay();
  const earliest = useEarliest();
  const from = addMonths(end, -listMonths.value);
  const data = useRangeData(from, end);
  const days = useMemo(() => (data ? aggregateDays(data) : new Map<Day, DayAgg>()), [data]);
  const rows = [...days.values()].filter((a) => a.day <= end).sort((a, b) => (a.day < b.day ? 1 : -1));
  const groups = new Map<string, DayAgg[]>();
  for (const a of rows) groups.set(monthKey(a.day), [...(groups.get(monthKey(a.day)) ?? []), a]);
  if (!data) return <p class="muted" role="status">{t('common.loading')}</p>;
  return (
    <div class="stack gap-4">
      {rows.length === 0 && <EmptyState>{t('history.empty')}</EmptyState>}
      {[...groups.entries()].map(([key, list]) => (
        <section key={key} aria-label={new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(parseDay(`${key}-01`))}>
          <SectionTitle>{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(parseDay(`${key}-01`))}</SectionTitle>
          <List>
            {list.map((a) => (
              <ListRow
                key={a.day}
                main={formatDay(a.day, { weekday: 'long', month: 'short', day: 'numeric' })}
                sub={
                  <>
                    {describe(a).filter((p) => !p.includes(t('history.pending'))).join(' · ')}
                    {a.pendingCount > 0 && <> {' '}<Badge tone="attention">{a.pendingCount} {t('history.pending')}</Badge></>}
                  </>
                }
                onClick={() => open(a.day)}
              />
            ))}
          </List>
        </section>
      ))}
      {earliest && from > earliest && <Button block onClick={() => (listMonths.value += 3)}>{t('history.earlier')}</Button>}
    </div>
  );
}

export function History() {
  return (
    <Screen title={t('nav.history')}>
      <Segmented<View>
        legend={t('history.view')}
        name="history-view"
        value={view.value}
        onChange={(v) => (view.value = v)}
        options={[{ value: 'calendar', label: t('history.calendar') }, { value: 'list', label: t('history.list') }]}
      />
      {view.value === 'calendar' ? (
        <>
          <Calendar />
          {selected.value && <DayPreview day={selected.value} />}
        </>
      ) : (
        <DayList />
      )}
    </Screen>
  );
}
