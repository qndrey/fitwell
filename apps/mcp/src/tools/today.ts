import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { buildToday, type TodayDeps } from '../analytics/today';
import { SLOT_NAMES } from '../planning/check';
import { logPlannedMeals } from '../planning/logPlanned';
import todayHtml from '../ui/generated/today';
import { toolError, VIEW_ONLY } from './result';

export const TODAY_VIEW_URI = 'ui://fitwell/today.html';
/** One tap of water: 150 ml to a litre. */
const WATER = z.number().int().min(50).max(1000);

/** The Today view: the day so far, today's planned meals, foods to log again, water and steps, and today's training, with one-tap actions. */
export function registerTodayTools(server: McpServer, deps: TodayDeps) {
  const fresh = async () => ({ content: [{ type: 'text' as const, text: 'Done.' }], structuredContent: { today: await buildToday(deps) } as unknown as Record<string, unknown> });
  const appOnly = { ui: { resourceUri: TODAY_VIEW_URI, visibility: ['app'] } };

  registerAppResource(server, 'Today', TODAY_VIEW_URI, { description: 'What is left today, what is planned, foods to log again in one tap, water and steps, and today\'s training.' }, async () => ({
    contents: [{ uri: TODAY_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: todayHtml }],
  }));

  registerAppTool(
    server,
    'show_today',
    {
      title: 'Show today',
      description:
        "Opens today on one screen: calories and protein left against the goals, today's planned meals with a one-tap \"eaten\", foods the person eats often to log again in one tap, water and steps, and what they trained (with the workout that has waited longest as a suggestion). " +
        'Use it at the start of the day, or when they ask "what is left today?". For other days use get_food_log. It changes nothing until they tap.' +
        VIEW_ONLY,
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: TODAY_VIEW_URI } },
    },
    async () => {
      try {
        const today = await buildToday(deps);
        const left = today.remaining.kcal === null ? '' : ` ${today.remaining.kcal >= 0 ? `${today.remaining.kcal} kcal left` : `${-today.remaining.kcal} kcal over`}.`;
        return { content: [{ type: 'text', text: `Today is open.${left}${VIEW_ONLY}` }], structuredContent: { today } as unknown as Record<string, unknown> };
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'Today could not be worked out.');
      }
    },
  );

  registerAppTool(
    server,
    'get_today_data',
    {
      title: 'Today',
      description: 'Called by the Today view to refresh.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: appOnly,
    },
    fresh,
  );

  registerAppTool(
    server,
    'today_eat_planned',
    {
      title: 'Log today\'s planned meal',
      description: "Called by the Today view: logs today's planned meals of one meal as eaten, with the planned amounts.",
      inputSchema: z.object({ slot: z.enum(SLOT_NAMES) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: appOnly,
    },
    async ({ slot }) => {
      const day = (await buildToday(deps)).day;
      const logged = await logPlannedMeals(deps.data, deps.plans, day, slot, false);
      return logged.ok ? fresh() : toolError(logged.error);
    },
  );

  registerAppTool(
    server,
    'today_quick_add',
    {
      title: 'Log a food again',
      description: 'Called by the Today view: logs an earlier entry again for today, in the meal for the current time, with the amount and nutrition it had.',
      inputSchema: z.object({ entry_id: z.string().min(1).max(64) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: appOnly,
    },
    async ({ entry_id }) => {
      const today = await buildToday(deps);
      const e = await deps.data.foodEntry(entry_id);
      if (!e) return toolError('That entry is not there any more.');
      // The same check the suggestions go through: nothing that matches an allergy word is logged in one tap.
      const allergies = (await deps.data.profile()).diet.allergies.map((a) => a.trim().toLowerCase()).filter(Boolean);
      if (allergies.some((a) => e.foodName.toLowerCase().includes(a))) return toolError(`${e.foodName} matches an allergy on the profile, so it is not logged in one tap.`);
      await deps.data.addFoodEntries([{ day: today.day, slot: today.slot, foodRef: e.foodRef, foodName: e.foodName, brand: e.brand, grams: e.grams, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat, ...(e.extras ? { extras: e.extras } : {}), estimated: e.estimated }]);
      return fresh();
    },
  );

  registerAppTool(
    server,
    'today_add_water',
    {
      title: 'Add water',
      description: "Called by the Today view: adds a glass to today's water.",
      inputSchema: z.object({ ml: WATER }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: appOnly,
    },
    async ({ ml }) => {
      await deps.body.setMetrics((await buildToday(deps)).day, { addWaterMl: ml });
      return fresh();
    },
  );
}
