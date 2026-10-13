import { signal } from '@preact/signals';
import { workoutsForDay } from '../../db/workoutStore';
import { onChange } from '../../db/broadcast';
import type { Workout } from '../../db/schema';

export const dayWorkouts = signal<Workout[]>([]);

export function watchWorkouts(day: string): () => void {
  let live = true;
  const load = () =>
    workoutsForDay(day).then((list) => {
      if (live) dayWorkouts.value = list;
    });
  dayWorkouts.value = [];
  void load();
  const off = onChange((c) => {
    if (c.store === 'workouts') void load();
  });
  return () => {
    live = false;
    off();
  };
}
