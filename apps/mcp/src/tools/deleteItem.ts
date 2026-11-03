import { isDay } from '@fitwell/core/domain/dates';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { BodyData } from '../data/bodyData';
import type { InjuryData } from '../data/injuries';
import type { PlanData } from '../data/planData';
import type { UserData } from '../data/userData';
import type { WorkoutData } from '../data/workoutData';
import { json, toolError } from './result';

const day = z.string().refine(isDay, 'Use YYYY-MM-DD');

export interface DeleteDeps {
  data: UserData;
  workouts: WorkoutData;
  body: BodyData;
  plans: PlanData;
  injuries: InjuryData;
}

/** One tool for every "remove this", so the model reads one definition instead of seven. */
export function registerDeleteTool(server: McpServer, deps: DeleteDeps) {
  const { data, workouts, body, plans, injuries } = deps;
  server.registerTool(
    'delete_item',
    {
      title: 'Delete one thing',
      description:
        'Remove one stored item. kind says what, and which field identifies it: ' +
        'food_entry (id from get_food_log), injury (id from get_profile; removes it for good, end_injury keeps it as over), workout (id from get_workout_history; strength, session or cardio), workout_template (id), recipe (id from get_recipes; meal plans that use it keep their copy), ' +
        'meal_plan (week_start, a Monday; food already logged from it stays), weigh_in (day), measurements (day, all of that day), daily_metrics (day: sleep, steps and water). ' +
        'Only after the person asked for it.',
      inputSchema: z.object({
        kind: z.enum(['food_entry', 'injury', 'workout', 'workout_template', 'recipe', 'meal_plan', 'weigh_in', 'measurements', 'daily_metrics']),
        id: z.uuid().optional().describe('For food_entry, injury, workout, workout_template, recipe'),
        day: day.optional().describe('For weigh_in, measurements, daily_metrics'),
        week_start: day.optional().describe('For meal_plan'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ kind, id, day: d, week_start }) => {
      const need = (v: string | undefined, field: string) => (v ? null : toolError(`${kind} needs ${field}.`));
      switch (kind) {
        case 'food_entry':
          return need(id, 'id') ?? ((await data.deleteFoodEntry(id!)) ? json({ deleted: { kind, id } }) : toolError('No such entry. Use get_food_log to see the entry ids.'));
        case 'injury':
          return need(id, 'id') ?? ((await injuries.remove(id!)) ? json({ deleted: { kind, id } }) : toolError('No such injury.'));
        case 'workout':
          return need(id, 'id') ?? ((await workouts.delete(id!)) ? json({ deleted: { kind, id } }) : toolError('No such workout. Use get_workout_history to see ids.'));
        case 'workout_template':
          return need(id, 'id') ?? ((await workouts.deleteTemplate(id!)) ? json({ deleted: { kind, id } }) : toolError('No such template.'));
        case 'recipe':
          return need(id, 'id') ?? ((await plans.deleteRecipe(id!)) ? json({ deleted: { kind, id } }) : toolError('No such recipe.'));
        case 'meal_plan':
          return need(week_start, 'week_start') ?? ((await plans.deletePlan(week_start!)) ? json({ deleted: { kind, week_start } }) : toolError('No plan for that week.'));
        case 'weigh_in':
          return need(d, 'day') ?? ((await body.deleteWeight(d!)) ? json({ deleted: { kind, day: d } }) : toolError('No weigh-in on that day.'));
        case 'measurements':
          return need(d, 'day') ?? ((await body.deleteMeasurements(d!)) ? json({ deleted: { kind, day: d } }) : toolError('No measurements on that day.'));
        case 'daily_metrics':
          return need(d, 'day') ?? ((await body.deleteMetrics(d!)) ? json({ deleted: { kind, day: d } }) : toolError('Nothing logged on that day.'));
      }
    },
  );
}
