import { elapsedSeconds, formatClock } from '@fitwell/core/domain/workouts';
import { useNow } from './active';

/** The running clock of a workout in progress ("23:05"). Only this small piece re-renders each second. */
export function Elapsed({ startedAt }: { startedAt: number }) {
  const now = useNow(true);
  return <span class="clock">{formatClock(elapsedSeconds({ startedAt }, now) ?? 0)}</span>;
}
