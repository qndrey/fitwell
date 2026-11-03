import { isDay } from '@fitwell/core/domain/dates';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { HouseholdData } from '../data/households';
import type { PlanData } from '../data/planData';
import { todayIn } from '../data/time';
import { buildGroceryList, type GroceryList } from '../planning/grocery';
import shoppingHtml from '../ui/generated/shopping';
import { SHOPPING_VIEW_URI } from '../workout/plan';
import type { ShoppingData } from '../planning/shoppingTypes';
import type { FoodDeps } from './foods';
import { isMonday, label, nextMonday } from './planning';
import { json, toolError, VIEW_ONLY } from './result';

const day = z.string().refine(isDay, 'Use YYYY-MM-DD');

const listInput = z.object({
  week_start: day.optional(),
  people: z.number().min(0.5).max(10).default(1),
  already_have: z.array(z.string().max(60)).max(60).default([]),
  include_eaten: z.boolean().default(false),
  household: z.boolean().default(false),
});

export function registerShoppingTools(server: McpServer, deps: FoodDeps & { plans: PlanData; households: HouseholdData }) {
  const { data, plans, households } = deps;

  async function build(args: z.infer<typeof listInput>): Promise<{ shopping: ShoppingData; list: GroceryList; skippedAsEaten: number } | { error: string }> {
    const week = args.week_start ?? nextMonday(todayIn((await data.profile()).timeZone));
    if (!isMonday(week)) return { error: `week_start must be a Monday (for example ${nextMonday(week)}); ${week} is not.` };
    // The household's list is of the shared plan for everyone's portions together, with ticks the whole household sees; nothing eaten is left out of it, as eating is each person's own.
    const shared = args.household ? await households.plan(week) : null;
    if (args.household && !(await households.mine())) return { error: 'They are not in a household. Invite a friend with invite_to_household first.' };
    if (args.household && !shared) return { error: `The household has no plan for the week of ${week}. Save one with save_meal_plan and household: true.` };
    const plan = shared ?? (await plans.plan(week));
    if (!plan) return { error: `No meal plan for the week of ${week}. Plan one with save_meal_plan.` };
    const items = plan.items.filter((i) => args.household || args.include_eaten || !i.loggedAt);
    const people = args.household ? await households.totalPortions() : args.people;
    const list = buildGroceryList(items.map((i) => ({ label: label(i), ingredients: i.ingredients })), people, args.already_have);
    const ticked = args.household ? await households.ticks(week) : await plans.ticks(week);
    const sections = list.sections.map((s) => ({ aisle: s.aisle as string, items: s.items.map((e) => ({ key: e.key, name: e.name, grams: e.grams, buy: e.buy, ...(e.cooked ? { cooked: true as const } : {}), usedIn: e.usedIn, checked: ticked.has(e.key) })) }));
    const leftToBuy = sections.reduce((n, s) => n + s.items.filter((i) => !i.checked).length, 0);
    return { shopping: { weekStart: week, people, ...(args.household ? { household: true as const } : {}), meals: items.length, sections, itemCount: list.itemCount, leftToBuy, leftOut: list.leftOut, notes: list.notes }, list, skippedAsEaten: plan.items.length - items.length };
  }

  registerAppResource(server, 'Shopping list', SHOPPING_VIEW_URI, { description: 'The grocery list of a meal plan, grouped by shop section, with tick boxes.' }, async () => ({
    contents: [{ uri: SHOPPING_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: shoppingHtml }],
  }));

  registerAppTool(
    server,
    'show_grocery_list',
    {
      title: 'Grocery list for a meal plan',
      description:
        "The shopping list for a week's plan, opened as a tick-off checklist in the chat: every ingredient added up, rounded up to what a shop sells, grouped by section in shopping order, with where each is used. " +
        'The person ticks items off while shopping and the ticks are saved. household: true makes it the household\'s shared list instead (the shared plan for everyone\'s portions together, people is ignored, and the ticks are the whole household\'s). people multiplies the quantities (cooking for two = 2); already_have leaves out foods by name (e.g. ["olive oil","salt"]); meals already logged as eaten are skipped unless include_eaten. ' +
        'The reply lists every item with whether it is ticked, so you can say what is left to buy. Amounts are the weights of the foods as planned: plan with foods in the form they are bought (rice, pasta and meat raw, not boiled), otherwise the amounts are cooked weights and the notes say so.',
      inputSchema: listInput,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: SHOPPING_VIEW_URI } },
    },
    async (args) => {
      const built = await build(args);
      if ('error' in built) return toolError(built.error);
      const { shopping, skippedAsEaten } = built;
      const text = {
        ...shopping,
        ...(skippedAsEaten ? { skippedAsEaten } : {}),
        markdown: shopping.sections.map((s) => `## ${s.aisle}\n${s.items.map((e) => `- [${e.checked ? 'x' : ' '}] ${e.name}: ${e.buy}${e.cooked ? ' (cooked weight)' : ''}`).join('\n')}`).join('\n\n'),
      };
      return { content: [{ type: 'text', text: `The shopping list is open.${VIEW_ONLY} ${JSON.stringify(text)}` }], structuredContent: { shopping } as unknown as Record<string, unknown> };
    },
  );

  registerAppTool(
    server,
    'set_grocery_checked',
    {
      title: 'Tick a grocery item',
      description: 'Called by the shopping list when an item is ticked or unticked, or all ticks are cleared.',
      inputSchema: z.object({ week_start: day, key: z.string().min(1).max(200).optional(), checked: z.boolean().optional(), clear: z.boolean().optional(), household: z.boolean().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      _meta: { ui: { resourceUri: SHOPPING_VIEW_URI, visibility: ['app'] } },
    },
    async ({ week_start, key, checked, clear, household }) => {
      const store = household ? households : plans;
      if (household && !(await households.mine())) return toolError('They are not in a household.');
      if (clear) await store.clearTicks(week_start);
      else if (key !== undefined && checked !== undefined) await store.setTick(week_start, key, checked);
      else return toolError('Give key and checked, or clear.');
      return json({ ok: true, ticked: (await store.ticks(week_start)).size });
    },
  );
}
