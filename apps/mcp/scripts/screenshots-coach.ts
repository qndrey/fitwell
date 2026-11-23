// The coach roster for the Tools page and the home page (apps/landing/site/src/assets), from the built view with sample people and numbers, the way Claude
// embeds it (398 CSS px wide, images 2x). No running server or database is needed. Kept apart from screenshots-social.ts so shooting this one leaves the others untouched.
// Needs `npm run build:ui` first. Run: npx tsx scripts/screenshots-coach.ts
import { join } from 'node:path';
import type { CoachRoster } from '../src/analytics/coachTypes';
import coachHtml from '../src/ui/generated/coach';
import { closeAll, launch, openView } from '../tests/support/viewHost';

const OUT = process.env.SHOTS_OUT ?? '../landing/site/src/assets';

const roster: CoachRoster = {
  today: '2026-11-19',
  limit: 10,
  trainees: [
    {
      coachingId: 'c1', who: { nickname: 'bo.lifts', email: null }, status: 'active', since: '2026-10-05', shareResults: true, shareFood: false,
      workouts: { assigned: 9, done: 6, skipped: 1, waiting: 2, overdue: 1, adherencePct: 75 }, lastDone: '2026-11-18',
      next: { name: 'Push day', dueOn: '2026-11-20', started: false },
      program: { name: 'Strength block 1', status: 'running', sessionsDone: 7, sessionsTotal: 16 }, food: null, targetsWaiting: false,
    },
    {
      coachingId: 'c2', who: { nickname: 'cy', email: null }, status: 'active', since: '2026-11-02', shareResults: false, shareFood: true,
      workouts: { assigned: 4, done: 3, skipped: 0, waiting: 1, overdue: 0, adherencePct: 100 }, lastDone: '2026-11-17',
      next: { name: 'Leg day', dueOn: '2026-11-21', started: false }, program: null,
      food: { loggedDays: 5, kcal: 2310, goalKcal: 2400, proteinG: 148, goalProteinG: 160 }, targetsWaiting: true,
    },
    {
      coachingId: 'c3', who: { nickname: 'di', email: null }, status: 'pending', since: '2026-11-18', shareResults: false, shareFood: false,
      workouts: { assigned: 0, done: 0, skipped: 0, waiting: 0, overdue: 0, adherencePct: null }, lastDone: null, next: null, program: null, food: null, targetsWaiting: false,
    },
  ],
};

await launch();
for (const theme of ['light', 'dark'] as const) {
  const v = await openView(coachHtml, { content: [{ type: 'text', text: 'open' }], structuredContent: { roster } }, { width: 398, theme, scale: 2 });
  await v.page.emulateMedia({ colorScheme: theme });
  await v.page.waitForTimeout(500);
  const bottom = await v.frame.locator('main').evaluate((e) => Math.ceil(Math.max(...[...e.children].map((c) => c.getBoundingClientRect().bottom)) + 12));
  await v.page.screenshot({ path: join(OUT, `coach-${theme}.png`), clip: { x: 0, y: 0, width: 398, height: bottom } });
}
await closeAll();
console.log('wrote coach in light and dark to', OUT);
