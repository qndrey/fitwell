import { addDays, weekStart, type Day } from '../../domain/dates';
import { aggregateDays } from '../../domain/stats';
import { goals } from '../../state';
import { t } from '../../i18n';
import { useRangeData } from '../stats/data';

/** "This week 3 · target 4": a plain count next to your target, nothing more. Only shown when you set a target. */
export function WeekGoal({ day }: { day: Day }) {
  const target = goals.value.workoutsPerWeek;
  const start = weekStart(day);
  const data = useRangeData(start, addDays(start, 6));
  if (!target || !data) return null;
  const done = [...aggregateDays(data).values()].reduce((s, a) => s + a.strength + a.cardio, 0);
  return <p class="t-caption">{`${t('goals.thisWeek')} ${done} · ${t('goals.target').toLowerCase()} ${target}`}</p>;
}
