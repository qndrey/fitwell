import { loadExercises, loadInstructions, plainFirst, prepareExercises, searchExercises, type Exercise } from '@fitwell/core/data/exercises';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { json, toolError } from './result';

const ATTRIBUTION = 'free-exercise-db (public domain, The Unlicense)';

/** Library entries as Claude sees them (`custom` only marks a person's own exercises, which come later). */
const view = (e: Exercise) => ({ ref: e.ref, name: e.name, category: e.category, level: e.level, equipment: e.equipment, primary: e.primary, secondary: e.secondary });

/** Async because the muscle and equipment lists come from the dataset and become enums Claude can see. */
export async function registerExerciseTools(server: McpServer) {
  const lib = await loadExercises();
  const index = prepareExercises(lib.exercises);
  const muscle = z.enum(lib.muscles as [string, ...string[]]);
  const equipment = z.enum(lib.equipment as [string, ...string[]]);

  server.registerTool(
    'search_exercises',
    {
      title: 'Search exercises',
      description:
        'Search the exercise library (876 exercises) by name, target muscle and/or equipment. ' +
        'Use it to pick real exercises with stable ids when building a workout. With no query, lists exercises matching the filters.',
      inputSchema: z.object({
        query: z.string().max(100).default('').describe('Name words, typos tolerated, e.g. "bench press", "romanian deadlift"'),
        muscle: muscle.optional().describe('Primary or secondary muscle'),
        equipment: equipment.optional(),
        limit: z.number().int().min(1).max(50).default(15),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ query, muscle, equipment, limit }) => {
      // Search wider, then put plain lifts ahead of variations so the obvious choice comes first.
      const hits = plainFirst(query, searchExercises(index, lib.exercises, { query, muscle, equipment }, limit * 4)).slice(0, limit);
      return json({ exercises: hits.map(view), source: ATTRIBUTION });
    },
  );

  server.registerTool(
    'get_exercise',
    {
      title: 'Exercise details',
      description: 'Full details and step-by-step instructions for one exercise, by the id from search_exercises (e.g. "ex:Barbell_Squat").',
      inputSchema: z.object({ id: z.string().regex(/^ex:/, 'Library ids start with "ex:"') }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const ex = lib.exercises.find((e) => e.ref === id);
      if (!ex) return toolError(`No exercise with id ${id}. Use search_exercises to find one.`);
      return json({ exercise: { ...view(ex), instructions: await loadInstructions(id) }, source: ATTRIBUTION });
    },
  );
}
