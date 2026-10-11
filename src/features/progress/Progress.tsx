import { signal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';
import { BarChart, type BarGroup } from '../../charts/BarChart';
import { ChartFrame } from '../../charts/ChartFrame';
import { LineChart, shortDay, type LineSeries } from '../../charts/LineChart';
import { MARKERS } from '../../charts/markers';
import { addDays, dayFromNumber, dayNumber, today as todayDay, type Day } from '../../domain/dates';
import {
  aggregateDays, averageWorkoutTime, cardioActivities, cardioPerWeek, compareFirstLatest, downsample, exerciseOptions, exerciseProgress, measurementPoints,
  movingAverage, RANGES, rangeStart, trendChange, weeklyAverage, weeksIn, workoutsPerWeek, type RangeKey,
} from '../../domain/stats';
import { displayLength, displayWeight, weightUnit, type UnitSystem } from '../../domain/units';
import { formatMinutes } from '../../domain/workouts';
import type { MeasurementType } from '../../db/schema';
import { measurementTypes } from '../body/store';
import { goals, settings } from '../../state';
import { Button, Fieldset, Screen, Segmented, Select } from '../../ui';
import { t, type Key } from '../../i18n';
import { useEarliest, useRangeData } from '../stats/data';
import { unitFor } from '../body/MeasurementsSheet';

/** Remembered while the app is open, so coming back to Progress keeps your range. */
const range = signal<RangeKey>('3m');

const minus = (n: number) => (n < 0 ? '−' : n > 0 ? '+' : '±');
const r1 = (n: number) => Math.round(n * 10) / 10;
const signed = (n: number) => `${minus(r1(n))}${Math.abs(r1(n))}`;
const colorOf = (i: number) => `--chart-${(i % 6) + 1}`;
const dayLabel = (day: Day) => shortDay(dayNumber(day));
const longLabel = (day: Day) => shortDay(dayNumber(day), { weekday: 'short', month: 'short', day: 'numeric' });
const money = (n: number) => new Intl.NumberFormat().format(Math.round(n));
const periodText = (r: RangeKey) => t(`progress.over.${r}` as Key);

export function Progress() {
  useEffect(() => void performance.mark('progress:mount'), []);
  const r = range.value;
  const end = todayDay();
  const earliest = useEarliest();
  const from = rangeStart(r, end, earliest ?? undefined);
  // One extra week before the range lets the 7-day average be right on the first day shown.
  const data = useRangeData(addDays(from, -7), end);
  useEffect(() => {
    if (!data) return;
    performance.mark('progress:data');
    performance.measure('progress-load', 'progress:mount', 'progress:data');
    requestAnimationFrame(() => requestAnimationFrame(() => (performance.mark('progress:ready'), performance.measure('progress', 'progress:mount', 'progress:ready'))));
  }, [data]);

  const s = settings.value;
  return (
    <Screen title={t('nav.progress')}>
      <Segmented<RangeKey>
        legend={t('progress.range')}
        name="range"
        value={r}
        onChange={(v) => (range.value = v)}
        options={RANGES.map((k) => ({ value: k, label: t(`progress.range.${k}` as Key) }))}
      />
      {!data || earliest === null ? (
        <p class="muted" role="status">{t('common.loading')}</p>
      ) : (
        <>
          <Summary data={data} from={from} end={end} units={s.units} />
          {!s.hideBodyTracking && <WeightChart data={data} from={from} end={end} range={r} units={s.units} />}
          {!s.habitOnly && <CaloriesChart data={data} from={from} end={end} range={r} />}
          <WorkoutsChart data={data} from={from} end={end} />
          <StrengthChart data={data} from={from} units={s.units} />
          <CardioChart data={data} from={from} end={end} units={s.units} />
          {!s.hideBodyTracking && <MeasurementsChart data={data} from={from} units={s.units} />}
        </>
      )}
    </Screen>
  );
}

type Props = { data: NonNullable<ReturnType<typeof useRangeData>>; from: Day; end: Day };

// ------------------------------------------------------------------ summary tiles
/** The three numbers most people come here for, before the charts: weight trend, average calories, workouts a week. */
function Summary({ data, from, end, units }: Props & { units: UnitSystem }) {
  const s = settings.value;
  const tiles = useMemo(() => {
    const out: { label: string; value: string }[] = [];
    const days = aggregateDays(data);
    if (!s.hideBodyTracking) {
      const all = data.weights.filter((w) => w.deletedAt === undefined).map((w) => ({ day: w.day, value: displayWeight(w.kg, units) }));
      const trend = trendChange(movingAverage(all).filter((p) => p.day >= from));
      out.push({ label: t('progress.tile.weight'), value: trend ? `${signed(trend.change)} ${weightUnit(units)}` : '—' });
    }
    if (!s.habitOnly) {
      const logged = [...days.values()].filter((a) => a.day >= from && a.day <= end && a.foodCount > 0);
      out.push({ label: t('progress.tile.kcal'), value: logged.length ? money(logged.reduce((n, a) => n + a.kcal, 0) / logged.length) : '—' });
    }
    const weeks = workoutsPerWeek(days, from, end);
    const perWeek = weeks.length ? weeks.reduce((n, w) => n + w.strength + w.cardio, 0) / weeks.length : 0;
    out.push({ label: t('progress.tile.workouts'), value: String(r1(perWeek)) });
    const time = averageWorkoutTime(data.workouts, from, end);
    out.push({ label: t('progress.tile.time'), value: time ? formatMinutes(time.avgMin) : '—' });
    return out;
  }, [data, from, end, units, s.hideBodyTracking, s.habitOnly]);
  return (
    <section class="tiles" aria-label={t('progress.summary')}>
      {tiles.map((tile) => (
        <div class="tile" key={tile.label}>
          <span class="tile-value">{tile.value}</span>
          <span class="tile-label">{tile.label}</span>
        </div>
      ))}
    </section>
  );
}

// ------------------------------------------------------------------ weight
function WeightChart({ data, from, end, range: r, units }: Props & { range: RangeKey; units: UnitSystem }) {
  const unit = weightUnit(units);
  const m = useMemo(() => {
    const conv = (kg: number) => displayWeight(kg, units);
    const all = data.weights.filter((w) => w.deletedAt === undefined).map((w) => ({ day: w.day, value: conv(w.kg) }));
    const raw = all.filter((p) => p.day >= from);
    const ma = movingAverage(all).filter((p) => p.day >= from);
    return { raw, ma, trend: trendChange(ma) };
  }, [data, from, units]);

  const xFrom = dayNumber(m.raw[0]?.day ?? from);
  const xTo = dayNumber(end);
  const goalKg = goals.value.goalWeightKg;
  const dense = m.raw.length > 180;
  const series: LineSeries[] = [];
  if (!dense) series.push({ id: 'raw', label: t('chart.weight.daily'), color: '--chart-axis', marker: 'circle', faint: true, points: m.raw.map((p) => ({ x: dayNumber(p.day), y: p.value })) });
  const maPts = downsample(m.ma.map((p) => ({ x: dayNumber(p.day), y: p.value })), 150);
  series.push({ id: 'ma', label: t('chart.weight.trend'), color: '--chart-1', marker: 'circle', markers: false, points: maPts });

  const headline = m.trend ? `${t('chart.weight.trendWord')} ${signed(m.trend.change)} ${unit} ${periodText(r)}` : undefined;
  const rawByDay = new Map(m.raw.map((p) => [p.day, p.value]));
  const maByDay = new Map(m.ma.map((p) => [p.day, p.value]));
  const label = m.trend ? `${t('chart.weight.title')}, ${periodText(r)}. ${t('chart.weight.trend')}: ${r1(m.trend.from.value)} → ${r1(m.trend.to.value)} ${unit}, ${signed(m.trend.change)} ${unit}. ${m.raw.length} ${t('chart.weighIns')}.` : t('chart.weight.title');

  return (
    <ChartFrame
      id="weight"
      title={t('chart.weight.title')}
      headline={headline}
      empty={m.ma.length < 2 ? t('chart.weight.empty') : undefined}
      note={t('chart.weight.note')}
      table={{
        caption: t('chart.weight.title'),
        columns: [t('chart.date'), `${t('weight.label')} (${unit})`, `${t('chart.weight.trend')} (${unit})`],
        rows: () => m.raw.map((p) => [longLabel(p.day), p.value, maByDay.has(p.day) ? r1(maByDay.get(p.day)!) : '—']),
      }}
    >
      <LineChart
        label={label}
        series={series}
        xFrom={xFrom}
        xTo={xTo}
        yFormat={(v) => String(r1(v))}
        rule={goalKg !== undefined ? { y: displayWeight(goalKg, units), label: t('weight.goal') } : undefined}
        xLabel={(x) => shortDay(x)}
        readout={(x) => {
          const d = dayFromNumber(x);
          const raw = rawByDay.get(d);
          const avg = maByDay.get(d);
          return `${shortDay(x, { weekday: 'short', month: 'short', day: 'numeric' })}: ${raw !== undefined ? `${raw} ${unit}` : t('chart.noData')}${avg !== undefined ? ` · ${t('chart.weight.trend')} ${r1(avg)} ${unit}` : ''}`;
        }}
      />
    </ChartFrame>
  );
}

// ------------------------------------------------------------------ calories and macros
const METRICS = ['kcal', 'protein', 'carbs', 'fat'] as const;
type Metric = (typeof METRICS)[number];
const metricState = signal<Metric>('kcal');

function CaloriesChart({ data, from, end, range: r }: Props & { range: RangeKey }) {
  const metric = metricState.value;
  const unit = metric === 'kcal' ? t('unit.kcal') : 'g';
  const days = useMemo(() => aggregateDays(data), [data]);
  const inRange = [...days.values()].filter((a) => a.day >= from && a.day <= end && a.foodCount > 0);
  const weekly = useMemo(() => weeklyAverage(days, metric, from, end), [days, metric, from, end]);
  const byWeek = new Map(weekly.map((w) => [w.start, w.value]));
  const nDays = dayNumber(end) - dayNumber(from) + 1;
  const useDaily = nDays <= 93;

  let groups: BarGroup[];
  let lineValues: (number | undefined)[] | undefined;
  if (useDaily) {
    groups = Array.from({ length: nDays }, (_, i) => {
      const day = addDays(from, i);
      const a = days.get(day);
      return { key: day, label: dayLabel(day), values: { v: a && a.foodCount > 0 ? a[metric] : 0 } };
    });
    lineValues = groups.map((g) => {
      const a = days.get(g.key);
      return a && a.foodCount > 0 ? byWeek.get(weeksIn(g.key, g.key)[0]!) : undefined;
    });
  } else {
    groups = weekly.map((w) => ({ key: w.start, label: dayLabel(w.start), values: { v: w.value ?? 0 } }));
  }

  const avg = inRange.length ? inRange.reduce((s, a) => s + a[metric], 0) / inRange.length : 0;
  const metricName = t(metric === 'kcal' ? 'unit.kcal' : (`macro.${metric}` as Key));
  const target = metric === 'kcal' ? goals.value.kcal : metric === 'protein' ? goals.value.proteinG : metric === 'carbs' ? goals.value.carbsG : goals.value.fatG;

  return (
    <ChartFrame
      id="calories"
      title={t('chart.calories.title')}
      headline={`${t('chart.average')} ${money(avg)} ${unit}${metric === 'kcal' ? '' : ` ${metricName.toLowerCase()}`} ${t('chart.perDay')} · ${inRange.length} ${t('chart.daysLogged')}`}
      controls={
        <Segmented<Metric> legend={t('chart.metric')} name="metric" value={metric} onChange={(v) => (metricState.value = v)} options={METRICS.map((k) => ({ value: k, label: t(k === 'kcal' ? 'unit.kcal' : (`macro.${k}` as Key)) }))} />
      }
      empty={inRange.length < 3 ? t('chart.calories.empty') : undefined}
      note={useDaily ? t('chart.calories.noteDaily') : t('chart.calories.noteWeekly')}
      table={{
        caption: t('chart.calories.title'),
        columns: [t(useDaily ? 'chart.date' : 'chart.week'), `${metricName} (${unit})`],
        rows: () => (useDaily ? inRange.map((a) => [longLabel(a.day), Math.round(a[metric])]) : weekly.filter((w) => w.value !== undefined).map((w) => [dayLabel(w.start), Math.round(w.value!)])),
      }}
    >
      <BarChart
        label={`${t('chart.calories.title')}, ${periodText(r)}. ${t('chart.average')} ${money(avg)} ${unit} ${t('chart.perDay')}.`}
        groups={groups}
        parts={[{ id: 'v', label: useDaily ? t('chart.perDayLabel') : t('chart.weeklyAvg'), color: '--chart-1' }]}
        line={lineValues ? { label: t('chart.weeklyAvg'), color: '--chart-3', values: lineValues } : undefined}
        rule={target ? { y: target, label: t('chart.target') } : undefined}
        yFormat={(v) => money(v)}
        readout={(g) => `${useDaily ? shortDay(dayNumber(g.key), { weekday: 'short', month: 'short', day: 'numeric' }) : `${t('chart.weekOf')} ${g.label}`}: ${g.values.v ? `${money(g.values.v)} ${unit}` : t('chart.noData')}`}
      />
    </ChartFrame>
  );
}

// ------------------------------------------------------------------ workouts per week
/** Where the average comes from: strength sessions you timed with Start and Finish, and cardio durations. */
function timeNote(time: NonNullable<ReturnType<typeof averageWorkoutTime>>): string {
  const parts = [
    time.strengthAvgMin !== undefined ? `${t('workout.strength')} ${formatMinutes(time.strengthAvgMin)} (${time.strengthCount})` : '',
    time.cardioAvgMin !== undefined ? `${t('workout.cardio')} ${formatMinutes(time.cardioAvgMin)} (${time.cardioCount})` : '',
  ].filter(Boolean);
  return `${t('chart.time.how')} ${parts.join(' · ')}`;
}
function WorkoutsChart({ data, from, end }: Props) {
  const days = useMemo(() => aggregateDays(data), [data]);
  const weeks = workoutsPerWeek(days, from, end);
  const total = weeks.reduce((s, w) => s + w.strength + w.cardio, 0);
  const perWeek = weeks.length ? total / weeks.length : 0;
  const target = goals.value.workoutsPerWeek;
  const time = useMemo(() => averageWorkoutTime(data.workouts, from, end), [data, from, end]);
  return (
    <ChartFrame
      id="workouts"
      title={t('chart.workouts.title')}
      headline={`${total} ${t('chart.workouts.word')} · ${r1(perWeek)} ${t('chart.perWeek')}${time ? ` · ${t('chart.avgTime')} ${formatMinutes(time.avgMin)}` : ''}`}
      note={time ? timeNote(time) : t('chart.time.none')}
      empty={total === 0 ? t('chart.workouts.empty') : undefined}
      table={{ caption: t('chart.workouts.title'), columns: [t('chart.week'), t('workout.strength'), t('workout.cardio')], rows: () => weeks.map((w) => [dayLabel(w.start), w.strength, w.cardio]) }}
    >
      <BarChart
        label={`${t('chart.workouts.title')}: ${total} ${t('chart.workouts.word')}, ${r1(perWeek)} ${t('chart.perWeek')}.`}
        groups={weeks.map((w) => ({ key: w.start, label: dayLabel(w.start), values: { strength: w.strength, cardio: w.cardio } }))}
        parts={[{ id: 'strength', label: t('workout.strength'), color: '--chart-1' }, { id: 'cardio', label: t('workout.cardio'), color: '--chart-2', hatch: true }]}
        rule={target ? { y: target, label: t('chart.target') } : undefined}
        yFormat={(v) => String(Math.round(v))}
        readout={(g) => `${t('chart.weekOf')} ${g.label}: ${g.values.strength} ${t('workout.strength').toLowerCase()}, ${g.values.cardio} ${t('workout.cardio').toLowerCase()}`}
      />
    </ChartFrame>
  );
}

// ------------------------------------------------------------------ strength progress
const exerciseChoice = signal<string>('');
function StrengthChart({ data, from, units }: Pick<Props, 'data' | 'from'> & { units: UnitSystem }) {
  const unit = weightUnit(units);
  const options = useMemo(() => exerciseOptions(data.workouts.filter((w) => w.day >= from)), [data, from]);
  const ref = options.some((o) => o.ref === exerciseChoice.value) ? exerciseChoice.value : (options[0]?.ref ?? '');
  const pts = useMemo(() => (ref ? exerciseProgress(data.workouts.filter((w) => w.day >= from), ref) : []), [data, from, ref]);
  const conv = (kg: number) => r1(displayWeight(kg, units));
  const last = pts[pts.length - 1];
  const name = options.find((o) => o.ref === ref)?.name ?? '';

  const controls = options.length > 0 && (
    <div class="field">
      <label class="field-label" for="ex-select">{t('chart.exercise')}</label>
      <Select id="ex-select" value={ref} onChange={(e) => (exerciseChoice.value = (e.target as HTMLSelectElement).value)}>
        {options.map((o) => <option key={o.ref} value={o.ref}>{o.name}</option>)}
      </Select>
    </div>
  );
  const series: LineSeries[] = [
    { id: 'best', label: t('chart.bestSet'), color: '--chart-1', marker: 'circle', points: pts.map((p) => ({ x: dayNumber(p.day), y: conv(p.bestKg) })) },
    { id: 'e1rm', label: t('chart.e1rm'), color: '--chart-2', marker: 'square', points: pts.filter((p) => p.e1rmKg !== undefined).map((p) => ({ x: dayNumber(p.day), y: conv(p.e1rmKg!) })) },
  ];
  return (
    <ChartFrame
      id="strength"
      title={t('chart.strength.title')}
      controls={controls || undefined}
      headline={last ? `${name}: ${t('chart.bestSet')} ${conv(last.bestKg)} ${unit}${last.e1rmKg !== undefined ? ` · ${t('chart.e1rm')} ${conv(last.e1rmKg)} ${unit}` : ''}` : undefined}
      empty={options.length === 0 ? t('chart.strength.none') : pts.length < 2 ? t('chart.strength.empty') : undefined}
      note={t('chart.e1rm.formula')}
      table={{ caption: `${t('chart.strength.title')}: ${name}`, columns: [t('chart.date'), `${t('chart.bestSet')} (${unit})`, `${t('chart.e1rm')} (${unit})`], rows: () => pts.map((p) => [longLabel(p.day), conv(p.bestKg), p.e1rmKg !== undefined ? conv(p.e1rmKg) : '—']) }}
    >
      <LineChart
        label={`${t('chart.strength.title')}: ${name}. ${pts.length} ${t('chart.sessions')}.${last ? ` ${t('chart.bestSet')} ${conv(last.bestKg)} ${unit}.` : ''}`}
        series={series.filter((s) => s.points.length > 0)}
        xFrom={dayNumber(pts[0]?.day ?? from)}
        xTo={dayNumber(last?.day ?? from)}
        yFormat={(v) => String(r1(v))}
        xLabel={(x) => shortDay(x)}
        readout={(x, near) => `${shortDay(x, { weekday: 'short', month: 'short', day: 'numeric' })}: ${near.map((n) => `${n.series.label} ${n.point.y} ${unit}`).join(' · ')}`}
      />
    </ChartFrame>
  );
}

// ------------------------------------------------------------------ cardio totals
const cardioFilter = signal<string>('');
const cardioMetric = signal<'time' | 'distance'>('time');
function CardioChart({ data, from, end, units }: Props & { units: UnitSystem }) {
  const acts = useMemo(() => cardioActivities(data.workouts.filter((w) => w.day >= from)), [data, from]);
  const filter = acts.some((a) => a.ref === cardioFilter.value) ? cardioFilter.value : '';
  const weeks = useMemo(() => cardioPerWeek(data.workouts, from, end, filter || undefined), [data, from, end, filter]);
  const metric = cardioMetric.value;
  const conv = (km: number) => (units === 'metric' ? km : km * 0.621371);
  const dUnit = units === 'metric' ? 'km' : 'mi';
  const totalMin = weeks.reduce((s, w) => s + w.minutes, 0);
  const totalDist = weeks.reduce((s, w) => s + conv(w.km), 0);
  const sessions = weeks.reduce((s, w) => s + w.sessions, 0);
  const valueOf = (w: (typeof weeks)[number]) => (metric === 'time' ? w.minutes : conv(w.km));
  const hours = Math.floor(totalMin / 60);
  const minutesText = `${hours ? `${hours} h ` : ''}${Math.round(totalMin % 60)} min`;

  return (
    <ChartFrame
      id="cardio"
      title={t('chart.cardio.title')}
      headline={`${sessions} ${t('chart.sessions')} · ${minutesText}${totalDist > 0 ? ` · ${r1(totalDist)} ${dUnit}` : ''}`}
      controls={
        <div class="stack gap-3">
          {acts.length > 0 && (
            <div class="field">
              <label class="field-label" for="cardio-act">{t('chart.activity')}</label>
              <Select id="cardio-act" value={filter} onChange={(e) => (cardioFilter.value = (e.target as HTMLSelectElement).value)}>
                <option value="">{t('chart.allActivities')}</option>
                {acts.map((a) => <option key={a.ref} value={a.ref}>{a.name}</option>)}
              </Select>
            </div>
          )}
          <Segmented<'time' | 'distance'> legend={t('chart.metric')} name="cardio-metric" value={metric} onChange={(v) => (cardioMetric.value = v)} options={[{ value: 'time', label: t('chart.time') }, { value: 'distance', label: t('workout.distance') }]} />
        </div>
      }
      empty={sessions === 0 ? t('chart.cardio.empty') : undefined}
      table={{ caption: t('chart.cardio.title'), columns: [t('chart.week'), t('chart.sessions'), `${t('chart.time')} (min)`, `${t('workout.distance')} (${dUnit})`], rows: () => weeks.map((w) => [dayLabel(w.start), w.sessions, Math.round(w.minutes), r1(conv(w.km))]) }}
    >
      <BarChart
        label={`${t('chart.cardio.title')}: ${sessions} ${t('chart.sessions')}, ${minutesText}.`}
        groups={weeks.map((w) => ({ key: w.start, label: dayLabel(w.start), values: { v: valueOf(w) } }))}
        parts={[{ id: 'v', label: metric === 'time' ? `${t('chart.time')} (min)` : `${t('workout.distance')} (${dUnit})`, color: '--chart-3' }]}
        yFormat={(v) => String(r1(v))}
        readout={(g) => `${t('chart.weekOf')} ${g.label}: ${r1(g.values.v ?? 0)} ${metric === 'time' ? 'min' : dUnit}`}
      />
    </ChartFrame>
  );
}

// ------------------------------------------------------------------ measurements
const picked = signal<string[]>([]);
function MeasurementsChart({ data, from, units }: Pick<Props, 'data' | 'from'> & { units: UnitSystem }) {
  const enabled = measurementTypes.value.filter((m) => m.enabled);
  const entries = useMemo(() => data.measurements.filter((m) => m.day >= from), [data, from]);
  const withData = enabled.filter((m) => measurementPoints(entries, m.id).length >= 2);
  const sel = picked.value.filter((id) => withData.some((m) => m.id === id));
  const chosen = sel.length ? withData.filter((m) => sel.includes(m.id)) : withData.slice(0, 1);
  const conv = (m: MeasurementType, v: number) => r1(m.kind === 'length' ? displayLength(v, units) : v);
  const comparison = useMemo(() => compareFirstLatest(entries, enabled), [entries, enabled]);

  // One chart per unit: centimetres and percentages must not share an axis.
  const groups = new Map<string, MeasurementType[]>();
  for (const m of chosen) groups.set(unitFor(m, units), [...(groups.get(unitFor(m, units)) ?? []), m]);

  const toggle = (id: string) => (picked.value = chosen.some((m) => m.id === id) ? chosen.filter((m) => m.id !== id).map((m) => m.id) : [...chosen.map((m) => m.id), id]);
  const changes = chosen.map((m) => {
    const p = measurementPoints(entries, m.id);
    return `${m.label} ${signed(conv(m, p[p.length - 1]!.value) - conv(m, p[0]!.value))} ${unitFor(m, units)}`;
  });

  return (
    <ChartFrame
      id="measurements"
      title={t('chart.measure.title')}
      headline={changes.length ? changes.join(' · ') : undefined}
      controls={
        withData.length > 0 && (
          <Fieldset legend={t('chart.measure.pick')}>
            <div class="cluster gap-2">
              {withData.map((m) => (
                <Button key={m.id} size="sm" aria-pressed={chosen.some((c) => c.id === m.id)} onClick={() => toggle(m.id)}>{m.label}</Button>
              ))}
            </div>
          </Fieldset>
        )
      }
      empty={withData.length === 0 ? t('chart.measure.empty') : undefined}
      table={{
        caption: t('chart.measure.compare'),
        columns: [t('chart.measure.type'), t('chart.first'), t('chart.latest'), t('chart.change')],
        rows: () => comparison.map((c) => [c.type.label, `${conv(c.type, c.first.value)} ${unitFor(c.type, units)}`, `${conv(c.type, c.latest.value)} ${unitFor(c.type, units)}`, `${signed(conv(c.type, c.latest.value) - conv(c.type, c.first.value))} ${unitFor(c.type, units)}`]),
      }}
    >
      <div class="stack gap-4">
        {[...groups.entries()].map(([unit, types]) => {
          const series: LineSeries[] = types.map((m, i) => ({
            id: m.id, label: m.label, color: colorOf(measurementTypes.value.findIndex((x) => x.id === m.id)), marker: MARKERS[i % MARKERS.length]!, points: measurementPoints(entries, m.id).map((p) => ({ x: dayNumber(p.day), y: conv(m, p.value) })),
          }));
          const xs = series.flatMap((s) => s.points.map((p) => p.x));
          return (
            <LineChart
              key={unit}
              label={`${t('chart.measure.title')} (${unit}): ${types.map((m) => m.label).join(', ')}.`}
              series={series}
              xFrom={Math.min(...xs)}
              xTo={Math.max(...xs)}
              yFormat={(v) => String(r1(v))}
              xLabel={(x) => shortDay(x)}
              readout={(x, near) => `${shortDay(x, { weekday: 'short', month: 'short', day: 'numeric' })}: ${near.map((n) => `${n.series.label} ${n.point.y} ${unit}`).join(' · ')}`}
            />
          );
        })}
        {comparison.length > 0 && (
          <div class="table-wrap" tabIndex={0} role="region" aria-label={t('chart.measure.compare')}>
            <table>
              <caption class="t-overline section-title">{t('chart.measure.compare')}</caption>
              <thead><tr><th scope="col">{t('chart.measure.type')}</th><th scope="col">{t('chart.first')}</th><th scope="col">{t('chart.latest')}</th><th scope="col">{t('chart.change')}</th></tr></thead>
              <tbody>
                {comparison.map((c) => (
                  <tr key={c.type.id}>
                    <th scope="row">{c.type.label}</th>
                    <td>{conv(c.type, c.first.value)} {unitFor(c.type, units)}</td>
                    <td>{conv(c.type, c.latest.value)} {unitFor(c.type, units)}</td>
                    <td>{signed(conv(c.type, c.latest.value) - conv(c.type, c.first.value))} {unitFor(c.type, units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ChartFrame>
  );
}

