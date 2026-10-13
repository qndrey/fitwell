import { loadExercises } from '@fitwell/core/data/exercises';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import workoutHtml from '../ui/generated/workout';
import { WORKOUT_VIEW_URI, type WorkoutPlan } from '../workout/plan';
import { json, toolError } from './result';

/**
 * Phase 0b spike: the interactive workout player. Sets are acknowledged but not stored yet (no database
 * until phase 1); the point is to prove the view renders and calls back in every Claude client.
 */
export async function registerWorkoutTools(server: McpServer) {
  const lib = await loadExercises();
  const byId = new Map(lib.exercises.map((e) => [e.ref, e]));

  registerAppResource(server, 'Workout player', WORKOUT_VIEW_URI, { description: 'Runs a workout: sets, reps, weights and rest timer.' }, async () => ({
    contents: [{ uri: WORKOUT_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: workoutHtml }],
  }));

  registerAppTool(
    server,
    'start_workout',
    {
      title: 'Start a workout',
      description:
        'Opens the interactive workout player for a workout you planned. Use exercise ids from search_exercises. ' +
        'Give each exercise its sets, target reps, weight in kg (omit for bodyweight) and rest. The person logs each set in the player; ' +
        'when they finish, the player sends you a summary.',
      inputSchema: z.object({
        name: z.string().min(1).max(60).default('Workout'),
        exercises: z
          .array(
            z.object({
              id: z.string().regex(/^ex:/, 'Library ids start with "ex:"'),
              sets: z.number().int().min(1).max(10),
              reps: z.number().int().min(1).max(50),
              weight_kg: z.number().min(0).max(500).optional(),
              rest_sec: z.number().int().min(0).max(600).default(90),
            }),
          )
          .min(1)
          .max(15),
      }),
      _meta: { ui: { resourceUri: WORKOUT_VIEW_URI } },
    },
    async ({ name, exercises }) => {
      const unknown = exercises.filter((e) => !byId.has(e.id)).map((e) => e.id);
      if (unknown.length) return toolError(`Unknown exercise ids: ${unknown.join(', ')}. Use search_exercises to find valid ids.`);
      const plan: WorkoutPlan = {
        workoutId: crypto.randomUUID(),
        name,
        exercises: exercises.map((e) => {
          const ex = byId.get(e.id)!;
          return { id: e.id, name: ex.name, equipment: ex.equipment, restSec: e.rest_sec, sets: Array.from({ length: e.sets }, () => ({ reps: e.reps, weightKg: e.weight_kg })) };
        }),
      };
      const summary = plan.exercises.map((e) => `${e.name} ${e.sets.length}×${e.sets[0]!.reps}${e.sets[0]!.weightKg ? ` @ ${e.sets[0]!.weightKg} kg` : ''}`).join('; ');
      const result = json({ workout: plan });
      result.content = [{ type: 'text', text: `Workout "${name}" is open in the player: ${summary}.` }];
      return result;
    },
  );

  registerAppTool(
    server,
    'log_set',
    {
      title: 'Log a set',
      description: 'Called by the workout player when a set is done.',
      inputSchema: z.object({
        workoutId: z.uuid(),
        exerciseId: z.string().regex(/^ex:/),
        setNumber: z.number().int().min(1).max(10),
        reps: z.number().int().min(0).max(100),
        weightKg: z.number().min(0).max(500).optional(),
      }),
      _meta: { ui: { resourceUri: WORKOUT_VIEW_URI, visibility: ['app'] } },
    },
    async (set) => json({ saved: true, stored: false, loggedAt: new Date().toISOString(), set }),
  );
}
