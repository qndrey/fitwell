import { loadExercises } from '@fitwell/core/data/exercises';
import { addDays, isDay } from '@fitwell/core/domain/dates';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { ProgressDeps } from '../analytics/load';
import { buildMuscleMap, describeMuscleMap, type MuscleMap } from '../analytics/muscles';
import { todayIn } from '../data/time';
import { EXERCISE_VIEW_URI } from '../workout/plan';

const input = z.object({
  weeks: z.number().int().min(1).max(12).default(4).describe('How many weeks to average over'),
  to: z.string().refine(isDay, 'Use YYYY-MM-DD').optional().describe('Last day; default today'),
});

/** The muscle map for a period: a handful of indexed reads. */
export async function loadMuscleMap(deps: Pick<ProgressDeps, 'data' | 'workouts'>, weeks: number, to?: string): Promise<MuscleMap> {
  const end = to ?? todayIn((await deps.data.profile()).timeZone);
  const lib = await loadExercises();
  const muscles = new Map(lib.exercises.map((e) => [e.ref, { primary: e.primary, secondary: e.secondary }]));
  const from = addDays(end, -(weeks * 14 - 1)); // twice the period: the one before it gives the comparison
  const workouts = await deps.workouts.between(from, end);
  return buildMuscleMap({ workouts, to: end, weeks, musclesOf: (ref) => muscles.get(ref) ?? { primary: [], secondary: [] } });
}

export function registerMuscleTools(server: McpServer, deps: Pick<ProgressDeps, 'data' | 'workouts'>) {
  // The map is drawn on the exercise guide's 3D body, so it shares that view (registered with the exercise tools).
  registerAppTool(
    server,
    'show_muscle_map',
    {
      title: 'Show which muscles were trained',
      description:
        'Opens a 3D body coloured by how much each muscle group was trained: weekly hard sets (a main muscle counts a set as 1, a helping one as 0.5) against the usual range of about 10–20 a week, ' +
        'from finished strength workouts over the last few weeks (default 4). Use it when the person asks which muscles they train, neglect or overdo, or what to train next. ' +
        'The range is a rough guide for the big muscle groups; small ones (forearms, neck) usually get enough from other lifts. Say it neutrally and let the person decide.',
      inputSchema: input,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: EXERCISE_VIEW_URI } },
    },
    async ({ weeks, to }) => {
      const map = await loadMuscleMap(deps, weeks, to);
      return { content: [{ type: 'text', text: `The muscle map is open.\n${describeMuscleMap(map)}` }], structuredContent: { muscleMap: map } as unknown as Record<string, unknown> };
    },
  );

  registerAppTool(
    server,
    'get_muscle_map',
    {
      title: 'Muscle map data',
      description: 'Called by the muscle map when the person changes the period.',
      inputSchema: input,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: EXERCISE_VIEW_URI, visibility: ['app'] } },
    },
    async ({ weeks, to }) => {
      const map = await loadMuscleMap(deps, weeks, to);
      return { content: [{ type: 'text', text: `Muscle map for ${map.from} to ${map.to}.` }], structuredContent: { muscleMap: map } as unknown as Record<string, unknown> };
    },
  );
}
