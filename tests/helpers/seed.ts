import type { Page } from '@playwright/test';

export interface SeedOptions {
  /** How many days back from today to fill. */
  days: number;
  seed?: number;
  /** Put N pending (unconfirmed) food entries on the day `pendingDaysAgo` days back. */
  pendingDaysAgo?: number;
}

/**
 * Writes believable history straight into IndexedDB (the app must already have opened the database).
 * Deterministic for a given seed: food on ~85% of days, cardio every other day, strength every third day
 * with slowly rising weights, a daily weight drifting from 80 to ~74 kg with noise, waist/hips weekly.
 */
export async function seedHistory(page: Page, opts: SeedOptions): Promise<void> {
  await page.evaluate(
    (o) =>
      new Promise<void>((resolve, reject) => {
        let s = o.seed ?? 7;
        const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
        const pad = (n: number) => String(n).padStart(2, '0');
        const dayOf = (back: number) => {
          const d = new Date();
          d.setDate(d.getDate() - back);
          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        };
        const base = (id: string, at: number) => ({ id, createdAt: at, updatedAt: at, rev: 1 });
        const open = indexedDB.open('fitwell');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['foodEntries', 'workouts', 'weightEntries', 'measurementEntries'], 'readwrite');
          const food = tx.objectStore('foodEntries');
          const workouts = tx.objectStore('workouts');
          const weights = tx.objectStore('weightEntries');
          const meas = tx.objectStore('measurementEntries');
          const now = Date.now();
          for (let back = o.days; back >= 0; back--) {
            const day = dayOf(back);
            const t0 = now - back * 86_400_000;
            const progress = 1 - back / Math.max(1, o.days);
            if (rnd() < 0.85) {
              const n = 2 + Math.floor(rnd() * 3);
              for (let i = 0; i < n; i++) {
                const kcal = 250 + Math.round(rnd() * 450);
                food.put({
                  ...base(`f-${day}-${i}`, t0 + i), day, slot: (['breakfast', 'lunch', 'dinner', 'snacks'] as const)[i % 4], state: 'resolved',
                  food: { ref: { kind: 'bundled', id: `frida:${i}` }, name: `Food ${i}`, per100g: { kcal: 200, protein: 10, carbs: 20, fat: 8 }, portions: [] },
                  quantity: { amount: kcal / 2, unit: 'g' }, grams: kcal / 2, nutrition: { kcal, protein: kcal / 20, carbs: kcal / 10, fat: kcal / 25 },
                });
              }
            }
            if (back % 2 === 0) {
              const run = back % 4 === 0;
              workouts.put({
                ...base(`c-${day}`, t0 + 10), day, type: 'cardio',
                cardio: { activityRef: run ? 'act:run-10' : 'act:bike-moderate', activityName: run ? 'Running, about 10 km/h (6 mph)' : 'Cycling, moderate (16–19 km/h)', met: run ? 9.8 : 6.8, durationMin: 25 + Math.round(rnd() * 30), distanceKm: run ? 4 + Math.round(rnd() * 40) / 10 : 12 + Math.round(rnd() * 80) / 10, kcalEstimated: 300 },
              });
            }
            if (back % 3 === 0) {
              const kg = 50 + progress * 25 + Math.round(rnd() * 2) * 2.5;
              workouts.put({
                ...base(`s-${day}`, t0 + 20), day, type: 'strength', name: 'Push day',
                exercises: [
                  { exerciseRef: 'ex:Barbell_Bench_Press_-_Medium_Grip', exerciseName: 'Barbell Bench Press - Medium Grip', sets: [{ id: 'a', type: 'warmup', reps: 10, weightKg: 20 }, { id: 'b', type: 'working', reps: 5 + Math.floor(rnd() * 4), weightKg: kg }, { id: 'c', type: 'working', reps: 5, weightKg: kg }] },
                  { exerciseRef: 'ex:Barbell_Full_Squat', exerciseName: 'Barbell Full Squat', sets: [{ id: 'd', type: 'working', reps: 5, weightKg: kg + 20 }] },
                ],
              });
            }
            weights.put({ ...base(`weight:${day}`, t0 + 30), day, kg: Math.round((80 - progress * 6 + (rnd() - 0.5) * 1.2) * 10) / 10 });
            if (back % 7 === 0) {
              meas.put({ ...base(`meas:${day}`, t0 + 40), day, values: { 'mt:waist': Math.round((92 - progress * 5 + (rnd() - 0.5)) * 10) / 10, 'mt:hips': Math.round((101 - progress * 2) * 10) / 10 } });
            }
          }
          if (o.pendingDaysAgo !== undefined) {
            const day = dayOf(o.pendingDaysAgo);
            food.put({ ...base(`p-${day}`, now), day, slot: 'lunch', state: 'awaiting_confirmation', queryText: 'grandma soup', quantity: { amount: 200, unit: 'g' }, lookup: { queryVersion: 0, attempts: 0, candidates: [] } });
          }
          tx.oncomplete = () => (db.close(), resolve());
          tx.onerror = () => reject(tx.error);
        };
      }),
    opts,
  );
}
