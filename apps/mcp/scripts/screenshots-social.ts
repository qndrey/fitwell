// The milestone page, the share card, the crew feed, the Today view and the meal plan view for the Tools page (apps/landing/site/src/assets), from the built views with sample people and
// numbers, the way Claude embeds them (398 CSS px wide, images 2x). No running server or database is needed: the views get fixed sample data.
// Needs `npm run build:ui` first. Run: npx tsx scripts/screenshots-social.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CrewFeed } from '../src/analytics/crewTypes';
import type { Celebration } from '../src/analytics/celebrationTypes';
import celebrationHtml from '../src/ui/generated/celebration';
import crewHtml from '../src/ui/generated/crew';
import mealplanHtml from '../src/ui/generated/mealplan';
import todayHtml from '../src/ui/generated/today';
import type { MealPlanView } from '../src/analytics/mealPlanTypes';
import type { TodayView } from '../src/analytics/todayTypes';
import { closeAll, launch, openView } from '../tests/support/viewHost';

const OUT = process.env.SHOTS_OUT ?? '../landing/site/src/assets';
const result = (data: Record<string, unknown>) => ({ content: [{ type: 'text', text: 'open' }], structuredContent: data });

const milestone: Celebration = {
  kind: 'training_weeks', threshold: 7, achievedAt: '2026-11-02', title: '7 weeks of training', detail: '3 workouts or more each week', atLeast: false, goalKg: null,
  took: [{ label: 'Workouts', value: 23 }, { label: 'Sets', value: 341 }], next: { threshold: 14, remaining: 7, unit: 'week' },
};
const feed: CrewFeed = {
  from: '2026-10-21', to: '2026-11-03',
  friends: [
    { who: { nickname: 'bo.lifts', email: null }, consistency: { trainingWeeks: { current: 7, best: 7, atLeast: false }, loggingDays: { current: 12, best: 20, atLeast: false }, loggingWeeks: { current: 2, best: 3, atLeast: false } } },
    { who: { nickname: 'ana_fit', email: null }, consistency: { trainingWeeks: { current: 3, best: 9, atLeast: false }, loggingDays: { current: 0, best: 4, atLeast: false }, loggingWeeks: { current: 0, best: 1, atLeast: false } } },
    { who: { nickname: 'cy', email: null }, consistency: null },
  ],
  workouts: [
    { id: 'w1', who: { nickname: 'bo.lifts', email: null }, day: '2026-11-02', type: 'strength', title: 'Push day', exercises: ['Barbell Bench Press', 'Overhead Press', 'Dips', 'Triceps Pushdown'], exerciseCount: 6, sets: 18, minutes: 52, kudos: { count: 2, mine: false } },
    { id: 'w2', who: { nickname: 'cy', email: null }, day: '2026-11-01', type: 'cardio', title: 'Running', exercises: [], exerciseCount: 0, sets: 0, minutes: 30, kudos: { count: 0, mine: true } },
    { id: 'w3', who: { nickname: 'ana_fit', email: null }, day: '2026-10-30', type: 'session', title: 'Pilates', exercises: [], exerciseCount: 0, sets: 0, minutes: 45, kudos: { count: 1, mine: false } },
  ],
  yours: [{ id: 'm1', day: '2026-10-30', title: 'Leg day', from: [{ nickname: 'bo.lifts', email: null }, { nickname: 'cy', email: null }] }],
};

const todayView: TodayView = {
  day: '2026-11-03', slot: 'dinner',
  goals: { kcal: 2300, proteinG: 150 },
  eaten: { kcal: 1480, protein: 92.5, carbs: 160, fat: 48 },
  remaining: { kcal: 820, protein: 57.5 },
  planned: [
    { slot: 'breakfast', items: [{ name: 'Oats with milk', kcal: 420, logged: true }], kcal: 420, allLogged: true },
    { slot: 'dinner', items: [{ name: 'Chicken and rice', kcal: 640, logged: false }, { name: 'Broccoli', kcal: 60, logged: false }], kcal: 700, allLogged: false },
  ],
  quickAdd: [
    { entryId: 'e1', name: 'Skyr, plain', grams: 200, kcal: 130, protein: 22, estimated: false },
    { entryId: 'e2', name: 'Banana', grams: 118, kcal: 105, protein: 1.3, estimated: false },
    { entryId: 'e3', name: 'Rye bread, light', grams: 60, kcal: 125, protein: 3.5, estimated: false },
  ],
  waterMl: 750, steps: 8200,
  training: { doneToday: [{ name: 'Push day', type: 'strength', minutes: 52 }], suggested: { name: 'Leg day', daysSince: 9 } },
};

const meal = (index: number, slot: MealPlanView['days'][number]['meals'][number]['slot'], name: string, kcal: number, protein: number, logged = false, servings: number | null = null) => ({ index, slot, name, kind: servings ? ('recipe' as const) : ('food' as const), servings, kcal, protein, logged });
const mealPlan: MealPlanView = {
  weekStart: '2026-11-02', today: '2026-11-03', version: 1,
  goals: { kcal: 2300, proteinG: 150 },
  days: [
    { day: '2026-11-02', weekday: 'Mon', past: true, meals: [meal(0, 'breakfast', 'Oats with milk', 520, 24, true), meal(1, 'lunch', 'Chicken and rice', 740, 52, true, 1), meal(2, 'dinner', 'Salmon with potatoes', 860, 48, true)], totals: { kcal: 2120, protein: 124 }, status: { kcal: 'ok', protein: 'short' }, vsGoal: { kcal: -180, protein: -26 } },
    { day: '2026-11-03', weekday: 'Tue', past: false, meals: [meal(3, 'breakfast', 'Skyr with banana', 380, 34, true), meal(4, 'lunch', 'Chicken and rice', 740, 52, false, 1), meal(5, 'dinner', 'Lentil stew', 810, 41)], totals: { kcal: 1930, protein: 127 }, status: { kcal: 'low', protein: 'short' }, vsGoal: { kcal: -370, protein: -23 } },
    { day: '2026-11-04', weekday: 'Wed', past: false, meals: [], totals: null, status: { kcal: null, protein: null }, vsGoal: { kcal: null, protein: null } },
    { day: '2026-11-05', weekday: 'Thu', past: false, meals: [], totals: null, status: { kcal: null, protein: null }, vsGoal: { kcal: null, protein: null } },
    { day: '2026-11-06', weekday: 'Fri', past: false, meals: [], totals: null, status: { kcal: null, protein: null }, vsGoal: { kcal: null, protein: null } },
    { day: '2026-11-07', weekday: 'Sat', past: false, meals: [], totals: null, status: { kcal: null, protein: null }, vsGoal: { kcal: null, protein: null } },
    { day: '2026-11-08', weekday: 'Sun', past: false, meals: [], totals: null, status: { kcal: null, protein: null }, vsGoal: { kcal: null, protein: null } },
  ],
  warnings: [], problems: [],
  recipes: [{ id: 'r1', name: 'Chicken and rice', kcalPerServing: 740 }, { id: 'r2', name: 'Lentil stew', kcalPerServing: 520 }],
};

await launch();
for (const theme of ['light', 'dark'] as const) {
  // The milestone page, after its ring has drawn.
  const m = await openView(celebrationHtml, result({ celebrations: [milestone] }), { width: 398, theme, scale: 2 });
  await m.page.emulateMedia({ colorScheme: theme }); // the views follow the browser's scheme (as Claude's frame does), not just the host's theme field
  await m.page.waitForTimeout(1800);
  const height = await m.frame.locator('html').evaluate((e) => Math.ceil(e.getBoundingClientRect().height));
  const bottom = await m.frame.locator('section.celebrate').evaluate((e) => Math.ceil(e.getBoundingClientRect().bottom + 12));
  await m.page.screenshot({ path: join(OUT, `milestone-${theme}.png`), clip: { x: 0, y: 0, width: 398, height: Math.min(bottom, height) } });

  // The share card the person made, exactly as it is saved (feed 4:5), in the page's theme.
  await m.frame.getByRole('button', { name: 'Make a card' }).click();
  if (theme === 'dark') await m.frame.getByRole('button', { name: 'Dark' }).click();
  const url = await m.frame.locator('canvas.card-canvas').evaluate((c) => (c as unknown as { toDataURL(t: string): string }).toDataURL('image/png'));
  writeFileSync(join(OUT, `sharecard-${theme}.png`), Buffer.from(url.split(',')[1]!, 'base64'));

  // The crew feed.
  const c = await openView(crewHtml, result({ feed }), { width: 398, theme, scale: 2 });
  await c.page.emulateMedia({ colorScheme: theme });
  await c.page.waitForTimeout(500);
  // Today.
  const t = await openView(todayHtml, result({ today: todayView }), { width: 398, theme, scale: 2 });
  await t.page.emulateMedia({ colorScheme: theme });
  await t.page.waitForTimeout(500);
  const todayBottom = await t.frame.locator('section[aria-label="Training"]').evaluate((e) => Math.ceil(e.getBoundingClientRect().bottom + 12));
  await t.page.screenshot({ path: join(OUT, `today-${theme}.png`), clip: { x: 0, y: 0, width: 398, height: todayBottom } });

  // The meal plan, with the change panel open on one meal.
  const p = await openView(mealplanHtml, result({ mealPlan }), { width: 398, theme, scale: 2 });
  await p.page.emulateMedia({ colorScheme: theme });
  await p.frame.getByRole('button', { name: 'Change Lentil stew' }).click();
  await p.page.waitForTimeout(500);
  const planBottom = await p.frame.locator('section[aria-label="Tue 3 Nov"]').evaluate((e) => Math.ceil(e.getBoundingClientRect().bottom + 12));
  await p.page.screenshot({ path: join(OUT, `mealplan-${theme}.png`), clip: { x: 0, y: 0, width: 398, height: planBottom } });

  const crewBottom = await c.frame.locator('section[aria-label="Kudos on your workouts"]').evaluate((e) => Math.ceil(e.getBoundingClientRect().bottom + 12));
  await c.page.screenshot({ path: join(OUT, `crew-${theme}.png`), clip: { x: 0, y: 0, width: 398, height: crewBottom } });
}
await closeAll();
console.log('wrote milestone, sharecard, crew, today and mealplan in light and dark to', OUT);
