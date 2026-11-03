// The crew feed view in Chromium: what it shows, the kudos tap (which calls the server and updates the count), and its empty state.
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CrewFeed } from '../src/analytics/crewTypes';
import crewHtml from '../src/ui/generated/crew';
import { closeAll, launch, openView } from './support/viewHost';

const feed: CrewFeed = {
  from: '2026-10-21',
  to: '2026-11-03',
  friends: [
    { who: { nickname: 'bo.lifts', email: null }, consistency: { trainingWeeks: { current: 7, best: 7, atLeast: false }, loggingDays: { current: 12, best: 20, atLeast: false }, loggingWeeks: { current: 2, best: 3, atLeast: false } } },
    { who: { nickname: null, email: 'cy@example.com' }, consistency: null },
  ],
  workouts: [
    { id: 'w1', who: { nickname: 'bo.lifts', email: null }, day: '2026-11-02', type: 'strength', title: 'Push day', exercises: ['Barbell Bench Press', 'Dips'], exerciseCount: 5, sets: 18, minutes: 52, kudos: { count: 1, mine: false } },
    { id: 'w2', who: { nickname: null, email: 'cy@example.com' }, day: '2026-11-01', type: 'cardio', title: 'Running', exercises: [], exerciseCount: 0, sets: 0, minutes: 30, kudos: { count: 0, mine: true } },
  ],
  yours: [{ id: 'm1', day: '2026-10-30', title: 'Leg day', from: [{ nickname: 'bo.lifts', email: null }] }],
};
const result = (f: CrewFeed) => ({ content: [{ type: 'text', text: 'open' }], structuredContent: { feed: f } });

describe('the crew feed view', () => {
  beforeAll(launch, 60_000);
  afterAll(closeAll);

  it('shows friends with what they share, their recent workouts, and kudos on yours', async () => {
    const v = await openView(crewHtml, result(feed));
    await pwExpect(v.frame.getByRole('heading', { name: 'Crew' })).toBeVisible();
    await pwExpect(v.frame.getByText('7 weeks of training · 12 days of logging')).toBeVisible();
    await pwExpect(v.frame.getByText('shares workouts')).toBeVisible();
    await pwExpect(v.frame.getByRole('heading', { name: 'Push day' })).toBeVisible();
    await pwExpect(v.frame.getByText('5 exercises · 18 sets · 52 min')).toBeVisible();
    await pwExpect(v.frame.getByText('Barbell Bench Press, Dips, …')).toBeVisible();
    await pwExpect(v.frame.getByText('Running')).toBeVisible();
    await pwExpect(v.frame.getByText('1 kudos')).toBeVisible();
    await pwExpect(v.frame.getByRole('heading', { name: 'Kudos on yours' })).toBeVisible();
    await pwExpect(v.frame.getByText('30 Oct · bo.lifts').or(v.frame.getByText(/bo\.lifts/).last())).toBeVisible();
  }, 30_000);

  it('a kudos tap asks the server, then shows it given with the count up by one; one already given is not tappable', async () => {
    const v = await openView(crewHtml, result(feed), { tools: (name) => (name === 'give_kudos' ? { content: [{ type: 'text', text: 'Kudos given.' }], structuredContent: { given: true } } : undefined) });
    await v.frame.getByRole('button', { name: 'Give kudos to bo.lifts for Push day' }).click();
    await pwExpect(v.frame.getByText('2 kudos')).toBeVisible();
    expect(v.calls).toEqual([{ name: 'give_kudos', args: { workout_id: 'w1' } }]);
    await pwExpect(v.frame.getByRole('button', { name: 'Give kudos to bo.lifts for Push day' })).toBeDisabled();
    await pwExpect(v.frame.getByRole('button', { name: 'Give kudos to cy@example.com for Running' })).toBeDisabled(); // already given
  }, 30_000);

  it('says so when a friend is not yet sharing anything, and when no workouts were shared lately', async () => {
    const none = await openView(crewHtml, result({ ...feed, friends: [], workouts: [], yours: [] }));
    await pwExpect(none.frame.getByText('No friend shares anything with you yet.')).toBeVisible();
    const quiet = await openView(crewHtml, result({ ...feed, workouts: [], yours: [] }));
    await pwExpect(quiet.frame.getByText('No finished workouts shared in the last two weeks.')).toBeVisible();
  }, 30_000);

  it('shows an error if kudos is refused, and the button stays', async () => {
    const v = await openView(crewHtml, result(feed), { tools: () => ({ isError: true, content: [{ type: 'text', text: 'no' }] }) });
    await v.frame.getByRole('button', { name: 'Give kudos to bo.lifts for Push day' }).click();
    await pwExpect(v.frame.getByText('Kudos could not be given. Try again.')).toBeVisible();
    await pwExpect(v.frame.getByText('1 kudos')).toBeVisible();
  }, 30_000);
});
