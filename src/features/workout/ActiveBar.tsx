import { Icon, Meter } from '../../ui';
import { routeId, route } from '../../router';
import { workoutTally } from '../../domain/workouts';
import { t } from '../../i18n';
import { activeWorkout } from './active';
import { Elapsed } from './Elapsed';

/** A slim bar at the top of every screen while a workout is in progress: name, running clock, sets done. Tap to get back to it. */
export function ActiveBar() {
  const w = activeWorkout.value;
  // Not on the workout itself or on the start screen, which already say it.
  if (!w || route.value === 'start' || (route.value === 'workout' && routeId.value === w.id)) return null;
  const tally = workoutTally(w.exercises ?? []);
  const name = w.name?.trim() || t('workout.strength');
  return (
    <button type="button" class="active-bar" aria-label={`${t('workout.resume')}: ${name}, ${t('workout.inProgress')}`} onClick={() => (location.hash = `#/workout/${w.id}`)}>
      <Icon name="timer" />
      <span class="active-text">
        <span class="active-name">{name}</span>
        <span class="active-sub">
          <Elapsed startedAt={w.startedAt!} />
          {tally.total > 0 && <> · {t('workout.setsDone').replace('{done}', String(tally.done)).replace('{total}', String(tally.total))}</>}
        </span>
      </span>
      {tally.total > 0 && <span class="active-meter"><Meter value={tally.done / tally.total} /></span>}
      <Icon name="next" />
    </button>
  );
}
