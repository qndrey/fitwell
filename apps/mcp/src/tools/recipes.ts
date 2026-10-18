import { roundForDisplay } from '@fitwell/core/domain/nutrition';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { perServing, recipeExtras, type PlanData, type Recipe, type RecipeItem } from '../data/planData';
import { checkRecipeUrl, fetchPage, parseRecipePage } from '../recipes/parse';
import { FoodMemo, ingredientSchema, resolveIngredient } from '../planning/resolve';
import type { FoodDeps } from './foods';
import { json, toolError } from './result';

/** Per serving: macros, plus fibre, sugars... (a minimum when some ingredient has no value) where known. */
const servingView = (r: Recipe) => {
  const x = recipeExtras(r.items, 1 / r.servings);
  return { ...roundForDisplay(perServing(r)), ...(x ? { extras: Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Math.round(v * 10) / 10])) } : {}) };
};

const view = (r: Recipe) => ({
  id: r.id,
  name: r.name,
  servings: r.servings,
  perServing: servingView(r),
  totalGrams: Math.round(r.items.reduce((n, i) => n + i.grams, 0)),
  ingredients: r.items.map((i) => ({ name: i.name, grams: Math.round(i.grams), ...(i.foodId ? { foodId: i.foodId } : { estimated: true }) })),
  ...(r.notes ? { notes: r.notes } : {}),
  ...(r.steps.length ? { steps: r.steps } : {}),
  ...(r.sourceUrl ? { sourceUrl: r.sourceUrl } : {}),
});

export interface RecipeDeps extends FoodDeps {
  plans: PlanData;
  fetch: typeof fetch;
  /** Sent as the User-Agent when opening a recipe page. */
  userAgent: string;
}

export function registerRecipeTools(server: McpServer, deps: RecipeDeps) {
  const { plans } = deps;

  server.registerTool(
    'save_recipe',
    {
      title: 'Save a recipe',
      description:
        'Save a recipe: its ingredients (food ids from search_foods with grams) and how many servings it makes. Nutrition per serving is calculated from the foods\' own values. ' +
        'Use ingredients in the form they are bought and weighed (rice, pasta and meat raw, not boiled) so the grocery list is right. Saving under an existing name replaces that recipe. Recipes can be used in meal plans (save_meal_plan) and the grocery list. Existing plans keep the version they were made with.',
      inputSchema: z.object({
        name: z.string().min(1).max(80),
        servings: z.number().min(0.5).max(50).default(1).describe('How many servings the whole recipe makes'),
        ingredients: z.array(ingredientSchema).min(1).max(40),
        notes: z.string().max(500).optional().describe('Short tips'),
        steps: z.array(z.string().min(1).max(500)).max(40).optional().describe('The method, one step per entry'),
        source_url: z.url().max(500).optional().describe('The web page the recipe came from'),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ name, servings, ingredients, notes, steps, source_url }) => {
      const foods = new FoodMemo(deps);
      const items: RecipeItem[] = [];
      for (const spec of ingredients) {
        const item = await resolveIngredient(spec, foods);
        if (typeof item === 'string') return toolError(`Nothing was saved. ${item}`);
        items.push(item);
      }
      return json({ recipe: view(await plans.saveRecipe(name.trim(), servings, items, { notes: notes ?? null, sourceUrl: source_url ?? null, steps: steps ?? [] })) });
    },
  );

  server.registerTool(
    'import_recipe',
    {
      title: 'Read a recipe from a web page',
      description:
        'Opens a recipe web page and returns the recipe as the site publishes it: name, servings, ingredient lines as written ("200 g chicken breast"), method steps and time. It saves nothing. ' +
        'Then match each ingredient line to a food (search_foods), convert the amount to grams in the form it is bought (raw rice, not boiled), and save_recipe with the steps and source_url. ' +
        'Tell the person which lines you had to guess. If the page has no recipe data, ask them to paste the recipe text instead and do the same from that.',
      inputSchema: z.object({ url: z.url().max(500) }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ url }) => {
      const ok = checkRecipeUrl(url);
      if (typeof ok === 'string') return toolError(ok);
      const page = await fetchPage(ok, deps.fetch, deps.userAgent);
      if (typeof page === 'string') return toolError(`${page} Ask the person to paste the recipe text instead.`);
      const recipe = parseRecipePage(page.html);
      if (!recipe) return toolError('This page does not publish its recipe in a form Fitwell can read. Ask the person to paste the recipe text instead.');
      return json({ recipe, sourceUrl: page.finalUrl, next: 'Match each ingredient line to a food with search_foods, then call save_recipe with ingredients, steps and source_url.' });
    },
  );

  server.registerTool(
    'get_recipes',
    {
      title: 'Saved recipes',
      description: "Without arguments: the person's saved recipes with servings and nutrition per serving. With id or name: that one recipe with all its ingredients, method and source.",
      inputSchema: z.object({ id: z.uuid().optional(), name: z.string().optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ id, name }) => {
      if (!id && !name) return json({ recipes: (await plans.recipes()).map((r) => ({ id: r.id, name: r.name, servings: r.servings, perServing: servingView(r), ingredients: r.items.length })) });
      const r = id ? await plans.recipe(id) : await plans.recipeByName(name!);
      return r ? json({ recipe: view(r) }) : toolError('No such recipe. Call get_recipes without arguments to list them.');
    },
  );
}
