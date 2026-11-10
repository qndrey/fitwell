import { isDay, weekStart } from '@fitwell/core/domain/dates';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { MealPlanView } from '../analytics/mealPlanTypes';
import { todayIn } from '../data/time';
import { buildMealPlan, eatMeal, repeatDay, replaceMeal, type EditResult, type MealPlanDeps } from '../planning/mealPlan';
import mealplanHtml from '../ui/generated/mealplan';
import { isMonday, nextMonday } from './planning';
import { toolError, VIEW_ONLY } from './result';

export const MEALPLAN_VIEW_URI = 'ui://fitwell/mealplan.html';

const week = z.string().refine((d) => isDay(d) && isMonday(d), 'Use the Monday of the week, YYYY-MM-DD');
const day = z.string().refine(isDay, 'Use YYYY-MM-DD');
const version = z.number().int().describe('The version of the plan the view was showing');
const index = z.number().int().min(0).max(500);

/** The meal plan view (D6): a week of meals against the goals, with swaps, repeats and "eaten" taps that go through the same allergy checks as saving a plan. */
export function registerMealPlanTools(server: McpServer, deps: MealPlanDeps) {
  const appOnly = { ui: { resourceUri: MEALPLAN_VIEW_URI, visibility: ['app'] } };
  const fresh = async (w: string) => {
    const plan = await buildMealPlan(deps, w);
    return plan ? { content: [{ type: 'text' as const, text: 'Done.' }], structuredContent: { mealPlan: plan } as unknown as Record<string, unknown> } : toolError(`No meal plan for the week of ${w}.`);
  };
  const edit = async (w: string, run: () => Promise<EditResult>) => {
    const done = await run();
    return done.ok ? fresh(w) : toolError(done.error);
  };

  registerAppResource(server, 'Meal plan', MEALPLAN_VIEW_URI, { description: 'A week of planned meals against the calorie and protein goals, with swaps, repeats and an eaten tap.' }, async () => ({
    contents: [{ uri: MEALPLAN_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: mealplanHtml }],
  }));

  registerAppTool(
    server,
    'show_meal_plan',
    {
      title: 'Show the meal plan',
      description:
        'Opens a week of the meal plan: every day with its meals, calories and protein against the goals, and allergy or dislike matches. The person can swap a meal for a saved recipe, copy a meal or a day, and tick a meal as eaten right in the view. ' +
        'Use it when they ask to see or adjust the plan; plan a new week with save_meal_plan first. Defaults to the current week, or the coming one when there is no plan for this one.' +
        VIEW_ONLY,
      inputSchema: z.object({ week_start: week.optional().describe('Monday of the week') }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: MEALPLAN_VIEW_URI } },
    },
    async ({ week_start }) => {
      try {
        let w = week_start;
        if (!w) {
          const today = todayIn((await deps.data.profile()).timeZone);
          const thisWeek = weekStart(today);
          w = (await deps.plans.plan(thisWeek)) ? thisWeek : nextMonday(today);
        }
        const plan: MealPlanView | null = await buildMealPlan(deps, w);
        if (!plan) return toolError(`No meal plan for the week of ${w}. Plan one with save_meal_plan.`);
        const meals = plan.days.reduce((n, d) => n + d.meals.length, 0);
        const text = `The meal plan for the week of ${w} is open: ${meals} meals.${plan.warnings.length ? ` ${plan.warnings.join(' ')}` : ''}${VIEW_ONLY}`;
        return { content: [{ type: 'text', text }], structuredContent: { mealPlan: plan } as unknown as Record<string, unknown> };
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'The meal plan could not be opened.');
      }
    },
  );

  registerAppTool(
    server,
    'get_meal_plan_data',
    { title: 'Meal plan', description: 'Called by the meal plan view to refresh.', inputSchema: z.object({ week_start: week }), annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, _meta: appOnly },
    ({ week_start }) => fresh(week_start),
  );

  registerAppTool(
    server,
    'plan_swap_recipe',
    {
      title: 'Swap a planned meal for a recipe',
      description: 'Called by the meal plan view: replaces one planned meal with a saved recipe. Refused for a meal already eaten, a stale view, or a recipe that matches an allergy.',
      inputSchema: z.object({ week_start: week, version, index, recipe_id: z.uuid(), servings: z.number().positive().max(20).default(1) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      _meta: appOnly,
    },
    ({ week_start, version: v, index: i, recipe_id, servings }) => edit(week_start, () => replaceMeal(deps, week_start, v, i, { recipeId: recipe_id, servings })),
  );

  registerAppTool(
    server,
    'plan_copy_meal',
    {
      title: 'Copy a planned meal',
      description: 'Called by the meal plan view: replaces one planned meal with a copy of another meal of the same plan.',
      inputSchema: z.object({ week_start: week, version, index, copy_from: index }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      _meta: appOnly,
    },
    ({ week_start, version: v, index: i, copy_from }) => edit(week_start, () => replaceMeal(deps, week_start, v, i, { copyFrom: copy_from })),
  );

  registerAppTool(
    server,
    'plan_repeat_day',
    {
      title: 'Repeat a planned day',
      description: "Called by the meal plan view: makes one day's meals a copy of another day's of the same week.",
      inputSchema: z.object({ week_start: week, version, from_day: day, to_day: day }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      _meta: appOnly,
    },
    ({ week_start, version: v, from_day, to_day }) => edit(week_start, () => repeatDay(deps, week_start, v, from_day, to_day)),
  );

  registerAppTool(
    server,
    'plan_eat_meal',
    {
      title: 'Log a planned meal as eaten',
      description: 'Called by the meal plan view: adds one planned meal of today or an earlier day to the food log, with the planned amounts.',
      inputSchema: z.object({ week_start: week, version, index }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: appOnly,
    },
    ({ week_start, version: v, index: i }) => edit(week_start, () => eatMeal(deps, week_start, v, i)),
  );
}
