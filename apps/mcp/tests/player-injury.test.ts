// The workout player flags an exercise that loads an area the person asked to have remembered (A11): on the server and on the exercise card.
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/client';
import type { WorkoutPlan } from '../src/workout/plan';
import viewHtml from '../src/ui/generated/workout';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';
import { closeAll, launch, openView } from './support/viewHost';

const OHP = 'ex:Standing_Military_Press';
const CURL = 'ex:Barbell_Curl';

describe('on the server', () => {
  let client: Client;
  beforeEach(async () => {
    const { env } = createTestEnv();
    client = await connectAs(env, await signedInUser(env, 'ana@example.com'));
  });
  const start = async () => (await call(client, 'start_workout', { name: 'Push', exercises: [{ id: OHP, sets: 3, reps: 8 }, { id: CURL, sets: 3, reps: 10 }] })).data as unknown as { workout: WorkoutPlan };

  it('has no flags without an injury', async () => {
    expect((await start()).workout.exercises.some((e) => e.injury)).toBe(false);
  });

  it('flags the exercises that load the area, when the workout starts and when it is opened again', async () => {
    await call(client, 'add_injury', { area: 'shoulder', note: 'pinches', avoid: '' });
    const { workout } = await start();
    expect(workout.exercises[0]!.injury).toMatch(/loads the shoulder/);
    expect(workout.exercises[1]!.injury).toBeUndefined();
    const again = (await call(client, 'get_workout', { workoutId: workout.workoutId })).data as unknown as { workout: WorkoutPlan };
    expect(again.workout.exercises[0]!.injury).toMatch(/loads the shoulder/);
  });

  it('stops flagging once the injury is over', async () => {
    await call(client, 'add_injury', { area: 'shoulder', note: '', avoid: '' });
    const id = ((await call(client, 'get_profile')).data as unknown as { injuries: { id: string }[] }).injuries[0]!.id;
    await call(client, 'end_injury', { id });
    expect((await start()).workout.exercises.some((e) => e.injury)).toBe(false);
  });
});

describe('on the exercise card', () => {
  beforeAll(launch, 60_000);
  afterAll(closeAll);

  it('says why, without calling the exercise unsafe, and shows nothing for an exercise without a flag', async () => {
    const set = (id: string) => ({ id, targetReps: 8, weightKg: 40, done: false });
    const workout: WorkoutPlan = {
      workoutId: 'w1', name: 'Push', startedAt: Date.now(), finished: false, cardio: [],
      exercises: [
        { uid: 'u1', id: OHP, name: 'Military Press', equipment: 'barbell', restSec: 90, bodyweight: false, sets: [set('a')], injury: 'loads the shoulder' },
        { uid: 'u2', id: CURL, name: 'Barbell Curl', equipment: 'barbell', restSec: 90, bodyweight: false, sets: [set('b')] },
      ],
    };
    const v = await openView(viewHtml, { content: [{ type: 'text', text: 'open' }], structuredContent: { workout } }, { width: 398 });
    await v.frame.getByText('Military Press').first().click();
    await pwExpect(v.frame.getByText(/Flagged for what you told Fitwell about an injury: loads the shoulder/)).toBeVisible();
    await pwExpect(v.frame.getByText(/cannot say whether it is right for you/)).toBeVisible();
    expect(await v.frame.getByText(/Flagged for what you told/).count()).toBe(1);
  }, 30_000);
});
