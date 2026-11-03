// The milestone page, the share card and the crew feed for the Tools page (apps/landing/site/src/assets), from the built views with sample people and
// numbers, the way Claude embeds them (398 CSS px wide, images 2x). No running server or database is needed: the views get fixed sample data.
// Needs `npm run build:ui` first. Run: npx tsx scripts/screenshots-social.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CrewFeed } from '../src/analytics/crewTypes';
import type { Celebration } from '../src/analytics/celebrationTypes';
import celebrationHtml from '../src/ui/generated/celebration';
import crewHtml from '../src/ui/generated/crew';
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
  const crewBottom = await c.frame.locator('section[aria-label="Kudos on your workouts"]').evaluate((e) => Math.ceil(e.getBoundingClientRect().bottom + 12));
  await c.page.screenshot({ path: join(OUT, `crew-${theme}.png`), clip: { x: 0, y: 0, width: 398, height: crewBottom } });
}
await closeAll();
console.log('wrote milestone, sharecard and crew in light and dark to', OUT);
