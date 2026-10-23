import { loadExercises, plainFirst, prepareExercises, searchExercises } from '@fitwell/core/data/exercises';
import { addDays } from '@fitwell/core/domain/dates';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { LiftProgress } from '../analytics/types';
import { buildLiftProgress } from '../analytics/lift';
import { todayIn } from '../data/time';
import type { UserData } from '../data/userData';
import type { WorkoutData } from '../data/workoutData';
import liftHtml from '../ui/generated/lift';
import { toolError, VIEW_ONLY } from './result';

export const LIFT_VIEW_URI = 'ui://fitwell/lift.html';
/** How far back the page reads: "All" in the view means this much. */
const HISTORY_DAYS = 3650;

const input = z.object({
  id: z.string().regex(/^ex:/, 'Library ids start with "ex:"').optional().describe('Library id from search_exercises'),
  query: z.string().min(1).max(100).optional().describe('Or a name, e.g. "bench press"'),
});

const describeLift = (l: LiftProgress) => {
  const best = l.sessions.reduce<LiftProgress['sessions'][number] | null>((b, s) => (!b || s.e1rm > b.e1rm ? s : b), null);
  if (!best) return `No sessions of ${l.name} yet.`;
  const records = l.repRecords.map((r) => `${r.reps} reps: ${r.kg === null ? 'not yet' : `${r.kg} kg (${r.day})`}`).join('; ');
  return `${l.name}: ${l.sessions.length} sessions, best estimated 1RM ${best.e1rm} kg on ${best.day}, latest ${l.sessions.at(-1)!.e1rm} kg on ${l.sessions.at(-1)!.day}. Rep records: ${records}.`;
};

export async function registerLiftTools(server: McpServer, deps: { data: UserData; workouts: WorkoutData }) {
  const lib = await loadExercises();
  const index = prepareExercises(lib.exercises);

  registerAppResource(server, 'Lift progress', LIFT_VIEW_URI, { description: 'Estimated 1RM over time, rep records and recent sessions of one lift.' }, async () => ({
    contents: [{ uri: LIFT_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: liftHtml }],
  }));

  registerAppTool(
    server,
    'show_lift_progress',
    {
      title: 'Show progress on one lift',
      description:
        'Opens a page for one lift in the chat: its estimated one-rep max over time (◆ marks new bests), the heaviest weight for 1, 3, 5 and 8 reps, and the last 10 sessions; the person can switch between 90 days, 1 year and all. ' +
        'Give the library id (from search_exercises) or a name. Use it when the person asks how a lift is going (squat, bench press, ...). For next weights, suggest_progression.',
      inputSchema: input,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: LIFT_VIEW_URI } },
    },
    async ({ id, query }) => {
      const ex = id ? lib.exercises.find((e) => e.ref === id) : query ? plainFirst(query, searchExercises(index, lib.exercises, { query }, 20))[0] : undefined;
      if (!ex) return toolError(id ? `No exercise with id ${id}. Search by name instead.` : query ? `No exercise matches "${query}".` : 'Give an exercise id or a name to look up.');
      const to = todayIn((await deps.data.profile()).timeZone);
      const workouts = await deps.workouts.between(addDays(to, -(HISTORY_DAYS - 1)), to, 'strength');
      const lift = buildLiftProgress({ id: ex.ref, name: ex.name, to, workouts });
      return { content: [{ type: 'text', text: `The lift page is open. ${describeLift(lift).slice(0, 1400)}${VIEW_ONLY}` }], structuredContent: { lift } as unknown as Record<string, unknown> };
    },
  );
}
