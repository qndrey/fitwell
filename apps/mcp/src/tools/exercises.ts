import { loadExercises, loadInstructions, plainFirst, prepareExercises, searchExercises, type Exercise } from '@fitwell/core/data/exercises';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { demoUrl, type ExerciseGuide } from '../exercises/guide';
import { machineGuideFor } from '../exercises/machines';
import exerciseHtml from '../ui/generated/exercise';
import { EXERCISE_VIEW_URI, WORKOUT_VIEW_URI } from '../workout/plan';
import { json, toolError } from './result';

const exerciseIdSchema = z.string().regex(/^ex:/, 'Library ids start with "ex:"');
const ATTRIBUTION = 'free-exercise-db (public domain, The Unlicense)';

/** Library entries as Claude sees them (`custom` only marks a person's own exercises, which come later). */
const view = (e: Exercise) => ({ ref: e.ref, name: e.name, category: e.category, level: e.level, equipment: e.equipment, primary: e.primary, secondary: e.secondary });

/** Async because the muscle and equipment lists come from the dataset and become enums Claude can see. */
export async function registerExerciseTools(server: McpServer) {
  const lib = await loadExercises();
  const index = prepareExercises(lib.exercises);
  const muscle = z.enum(lib.muscles as [string, ...string[]]);
  const equipment = z.enum(lib.equipment as [string, ...string[]]);

  /** Everything the guide shows for one library exercise. */
  async function guideFor(ex: Exercise): Promise<ExerciseGuide> {
    return { ref: ex.ref, name: ex.name, ...(ex.category ? { category: ex.category } : {}), ...(ex.level ? { level: ex.level } : {}), equipment: ex.equipment, primary: ex.primary, secondary: ex.secondary, instructions: await loadInstructions(ex.ref), machine: machineGuideFor(ex.name, ex.equipment), demoUrl: demoUrl(ex.name) };
  }

  server.registerTool(
    'search_exercises',
    {
      title: 'Search exercises',
      description:
        'Search the exercise library (876 exercises) by name, target muscle and/or equipment. ' +
        'Use it to pick real exercises with stable ids when building a workout. With no query, lists exercises matching the filters. ' +
        'With id (e.g. "ex:Barbell_Squat") it returns that one exercise with its step-by-step instructions instead.',
      inputSchema: z.object({
        query: z.string().max(100).default('').describe('Name words, typos tolerated, e.g. "bench press", "romanian deadlift"'),
        muscle: muscle.optional().describe('Primary or secondary muscle'),
        equipment: equipment.optional(),
        limit: z.number().int().min(1).max(50).default(15),
        id: z.string().regex(/^ex:/, 'Library ids start with "ex:"').optional().describe('Details and instructions for this one exercise'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ query, muscle, equipment, limit, id }) => {
      if (id) {
        const ex = lib.exercises.find((e) => e.ref === id);
        if (!ex) return toolError(`No exercise with id ${id}. Search by name instead.`);
        const g = await guideFor(ex);
        return json({ exercise: { ...view(ex), instructions: g.instructions, ...(g.machine ? { machineGuide: g.machine } : {}), demoUrl: g.demoUrl }, source: ATTRIBUTION });
      }
      // Search wider, then put plain lifts ahead of variations so the obvious choice comes first.
      const hits = plainFirst(query, searchExercises(index, lib.exercises, { query, muscle, equipment }, limit * 4)).slice(0, limit);
      return json({ exercises: hits.map(view), source: ATTRIBUTION });
    },
  );

  registerAppResource(server, 'Exercise guide', EXERCISE_VIEW_URI, { description: 'How to do an exercise: muscles worked, steps, machine setup and a link to a demo video.' }, async () => ({
    contents: [{ uri: EXERCISE_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: exerciseHtml }],
  }));

  registerAppTool(
    server,
    'show_exercise',
    {
      title: 'Show how to do an exercise',
      description:
        'Opens a guide for one exercise in the chat: a body drawing with the muscles it works, the step-by-step instructions, setup and form cues for the machine or cable station it uses, and a link to find a demo video. ' +
        'Give the library id (from search_exercises) or just a name to open the best match. Use it when the person asks how to do an exercise or how to use a machine; for a quick answer in words, search_exercises with id returns the same text.',
      inputSchema: z.object({ id: exerciseIdSchema.optional(), query: z.string().min(1).max(100).optional() }),
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: EXERCISE_VIEW_URI } },
    },
    async ({ id, query }) => {
      const ex = id ? lib.exercises.find((e) => e.ref === id) : query ? plainFirst(query, searchExercises(index, lib.exercises, { query }, 20))[0] : undefined;
      if (!ex) return toolError(id ? `No exercise with id ${id}. Search by name instead.` : 'Give an exercise id or a name to look up.');
      const g = await guideFor(ex);
      return { content: [{ type: 'text', text: `The guide for ${g.name} is open. Muscles: ${g.primary.join(', ')}${g.secondary.length ? ` (also ${g.secondary.join(', ')})` : ''}. ${g.instructions.join(' ')}${g.machine ? ` ${g.machine.title}: ${g.machine.setup.join(' ')}` : ''}` }], structuredContent: { guide: g } as unknown as Record<string, unknown> };
    },
  );

  registerAppTool(
    server,
    'get_exercise_guide',
    {
      title: 'Exercise guide for the player',
      description: 'Called by the workout player when the person opens "How to do it" on an exercise.',
      inputSchema: z.object({ id: exerciseIdSchema }),
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: WORKOUT_VIEW_URI, visibility: ['app'] } },
    },
    async ({ id }) => {
      const ex = lib.exercises.find((e) => e.ref === id);
      if (!ex) return toolError('No such exercise.');
      return json({ guide: await guideFor(ex) } as unknown as Record<string, unknown>);
    },
  );
}
