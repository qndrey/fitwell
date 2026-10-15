import { loadExercises } from '@fitwell/core/data/exercises';
import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { demoUrl, type ExerciseGuide } from '../src/exercises/guide';
import { MACHINE_GUIDE_IDS, machineGuideFor } from '../src/exercises/machines';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';

let client: Client;
beforeEach(async () => {
  const env = createTestEnv().env;
  client = await connectAs(env, await signedInUser(env, 'ana@example.com'));
});

describe('machine guides', () => {
  it('matches machines and stations by name, most specific first', async () => {
    const want: Record<string, string> = {
      'Leg Press': 'leg-press',
      'Narrow Stance Leg Press': 'leg-press',
      'Smith Machine Leg Press': 'smith', // the Smith machine guide wins over the leg press one
      'Hack Squat': 'hack-squat',
      'Leg Extensions': 'leg-extension',
      'Lying Leg Curls': 'leg-curl',
      'Seated Leg Curl': 'leg-curl',
      'Seated Calf Raise': 'calf',
      'Wide-Grip Lat Pulldown': 'lat-pulldown',
      'Straight-Arm Pulldown': 'cable-station', // not a lat pulldown
      'Seated Cable Rows': 'seated-row',
      'Leverage Iso Row': 'chest-supported-row',
      'Machine Bench Press': 'chest-press',
      'Leverage Chest Press': 'chest-press',
      Butterfly: 'pec-deck',
      'Reverse Machine Flyes': 'pec-deck',
      'Machine Shoulder (Military) Press': 'shoulder-press-machine',
      'Ab Crunch Machine': 'ab-machine',
      'Thigh Abductor': 'hip-machine',
      'Dip Machine': 'dip-machine',
      'Machine Bicep Curl': 'arm-machine',
      'Running, Treadmill': 'treadmill',
      'Bicycling, Stationary': 'bike',
      'Rowing, Stationary': 'rower',
      Stairmaster: 'stairs',
      'Triceps Pushdown - Rope Attachment': 'cable-station',
      'Leverage Shrug': 'machine',
    };
    const lib = await loadExercises();
    for (const [name, id] of Object.entries(want)) {
      const ex = lib.exercises.find((e) => e.name === name);
      expect(ex, `${name} is in the library`).toBeDefined();
      expect(machineGuideFor(ex!.name, ex!.equipment)?.id, name).toBe(id);
    }
  });

  it('gives every machine and cable exercise a guide, and none to free weights', async () => {
    const lib = await loadExercises();
    for (const e of lib.exercises) {
      const g = machineGuideFor(e.name, e.equipment);
      if (e.equipment === 'machine' || e.equipment === 'cable') expect(g, e.name).not.toBeNull();
      if (e.equipment !== 'machine' && e.equipment !== 'cable') expect(g, e.name).toBeNull();
    }
  });

  it('has complete, unique guides', () => {
    expect(new Set(MACHINE_GUIDE_IDS).size).toBe(MACHINE_GUIDE_IDS.length);
    for (const id of MACHINE_GUIDE_IDS) {
      const g = [machineGuideFor(id === 'cable-station' ? 'x' : id, id === 'cable-station' ? 'cable' : 'machine')].find(Boolean);
      expect(g).toBeTruthy();
    }
    const samples = ['Leg Press', 'Hack Squat', 'Butterfly', 'Running, Treadmill', 'Wide-Grip Lat Pulldown', 'Smith Machine Squat'].map((n) => machineGuideFor(n, 'machine')!);
    for (const g of samples) for (const part of [g.setup, g.cues, g.mistakes]) expect(part.length, g.id).toBeGreaterThan(0);
  });
});

describe('exercise guide tools', () => {
  type Hit = { ref: string; name: string };
  const find = async (query: string) => ((await call(client, 'search_exercises', { query, limit: 1 })).data.exercises as Hit[])[0]!;

  it('opens a guide by id or by name, with muscles, steps, machine setup and a demo search', async () => {
    const press = await find('leg press');
    const byId = await client.callTool({ name: 'show_exercise', arguments: { id: press.ref } });
    const g = (byId.structuredContent as { guide: ExerciseGuide }).guide;
    expect(g).toMatchObject({ ref: press.ref, name: 'Leg Press', equipment: 'machine' });
    expect(g.primary).toContain('quadriceps');
    expect(g.instructions.length).toBeGreaterThan(2);
    expect(g.machine?.id).toBe('leg-press');
    expect(g.demoUrl).toBe(demoUrl('Leg Press'));
    expect(g.demoUrl).toMatch(/^https:\/\/www\.youtube\.com\/results\?search_query=Leg%20Press%20exercise%20how%20to$/);
    expect((byId.content as { text: string }[])[0]!.text).toContain('quadriceps');

    const byName = await client.callTool({ name: 'show_exercise', arguments: { query: 'wide-grip lat pulldown' } });
    expect((byName.structuredContent as { guide: ExerciseGuide }).guide.machine?.id).toBe('lat-pulldown');
    const squat = (await client.callTool({ name: 'show_exercise', arguments: { query: 'barbell squat' } })).structuredContent as { guide: ExerciseGuide };
    expect(squat.guide.machine).toBeNull(); // a free-weight exercise has no machine section
  });

  it('explains failures, and keeps the helper tool out of the model\'s sight', async () => {
    expect((await call(client, 'show_exercise', {})).text).toContain('Give an exercise id');
    expect((await call(client, 'show_exercise', { id: 'ex:Nope' })).isError).toBe(true);
    expect((await call(client, 'show_exercise', { query: 'zzzzqqqq' })).isError).toBe(true);
    const tools = (await client.listTools()).tools;
    const helper = tools.find((t) => t.name === 'get_exercise_guide')!;
    expect((helper._meta as { ui?: { visibility?: string[] } }).ui?.visibility).toEqual(['app']);
    const press = await find('leg press');
    const res = await client.callTool({ name: 'get_exercise_guide', arguments: { id: press.ref } });
    expect((res.structuredContent as { guide: ExerciseGuide }).guide.name).toBe('Leg Press');
    expect((await call(client, 'get_exercise_guide', { id: 'ex:Nope' })).isError).toBe(true);
  });

  it('puts the machine guide and demo link in the written answer too', async () => {
    const press = await find('leg press');
    const d = (await call(client, 'search_exercises', { id: press.ref })).data.exercise as { machineGuide?: { title: string }; demoUrl: string; instructions: string[] };
    expect(d.machineGuide?.title).toBe('Leg press');
    expect(d.demoUrl).toContain('youtube.com/results');
    expect(d.instructions.length).toBeGreaterThan(0);
  });

  it('says which exercises have a 3D animation, and describes it in the tool result for the views', async () => {
    const motion = async (query: string) => ((await client.callTool({ name: 'show_exercise', arguments: { query } })).structuredContent as { guide: ExerciseGuide }).guide.motion;
    expect(await motion('barbell squat')).toMatchObject({ pattern: 'squat', variant: { load: 'barbell-back' } });
    expect(await motion('romanian deadlift')).toMatchObject({ pattern: 'hinge', variant: { hinge: 'romanian' } });
    expect(await motion('dumbbell bench press')).toMatchObject({ pattern: 'bench', variant: { load: 'dumbbells' } });
    expect(await motion('leg press')).toBeNull();
    const press = await find('leg press');
    const viaPlayer = (await client.callTool({ name: 'get_exercise_guide', arguments: { id: press.ref } })).structuredContent as { guide: ExerciseGuide };
    expect(viaPlayer.guide.motion).toBeNull();
  });

  it('keeps the views with the 3D library small enough, and self-contained', async () => {
    for (const uri of ['ui://fitwell/exercise.html', 'ui://fitwell/workout.html']) {
      const item = (await client.readResource({ uri })).contents[0] as { text?: string };
      expect(item.text!.length, uri).toBeLessThan(1_800_000);
      expect(item.text, uri).not.toMatch(/<script[^>]+src=|<link[^>]+stylesheet/);
    }
  });

  it('serves the guide view as one self-contained page', async () => {
    const item = (await client.readResource({ uri: 'ui://fitwell/exercise.html' })).contents[0] as { mimeType?: string; text?: string };
    expect(item.mimeType).toBe('text/html;profile=mcp-app');
    expect(item.text).not.toMatch(/<script[^>]+src=|<link[^>]+stylesheet| style="/);
  });
});
