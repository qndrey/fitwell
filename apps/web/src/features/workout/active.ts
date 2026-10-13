import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { workoutsForDay } from '../../db/workoutStore';
import { onChange } from '../../db/broadcast';
import type { Workout } from '@fitwell/core/schema';
import { addDays, today } from '@fitwell/core/domain/dates';
import { STALE_AFTER_MS, workoutStatus } from '@fitwell/core/domain/workouts';

/** The strength workout whose timer is running (the newest one), or undefined. A timer left running for half a day is treated as forgotten. */
export const activeWorkout = signal<Workout | undefined>(undefined);

/** Today's and yesterday's workouts are enough: a session that crosses midnight is still found, and older timers are stale anyway. */
async function find(): Promise<Workout | undefined> {
  const day = today();
  const list = [...(await workoutsForDay(day)), ...(await workoutsForDay(addDays(day, -1)))];
  const now = Date.now();
  return list
    .filter((w) => w.type === 'strength' && workoutStatus(w) === 'active' && now - (w.startedAt ?? 0) < STALE_AFTER_MS)
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
}

/** Keeps `activeWorkout` current. Call once at start-up; returns a function that stops it. */
export function watchActiveWorkout(): () => void {
  let live = true;
  const load = () =>
    void find().then((w) => {
      if (live) activeWorkout.value = w;
    });
  load();
  const off = onChange((c) => c.store === 'workouts' && load());
  // A day change or a stale timer is noticed within a minute even when nothing is written.
  const tick = setInterval(load, 60_000);
  return () => {
    live = false;
    off();
    clearInterval(tick);
  };
}

/** The current time in ms, refreshed every `ms` while `on` is true (a running clock). */
export function useNow(on: boolean, ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const i = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(i);
  }, [on, ms]);
  return now;
}
