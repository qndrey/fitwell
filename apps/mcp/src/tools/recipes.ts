import { roundForDisplay } from '@fitwell/core/domain/nutrition';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { perServing, type PlanData, type Recipe, type RecipeItem } from '../data/planData';
import { FoodMemo, ingredientSchema, resolveIngredient } from '../planning/resolve';
import type { FoodDeps } from './foods';
import { json, toolError } from './result';

const view = (r: Recipe) => ({
  id: r.id,
  name: r.name,
  servings: r.servings,
  perServing: roundForDisplay(perServing(r)),
  totalGrams: Math.round(r.items.reduce((n, i) => n + i.grams, 0)),
  ingredients: r.items.map((i) => ({ name: i.name, grams: Math.round(i.grams), ...(i.foodId ? { foodId: i.foodId } : { estimated: true }) })),
  ...(r.notes ? { notes: r.notes } : {}),
});

export function registerRecipeTools(server: McpServer, deps: FoodDeps & { plans: PlanData }) {
  const { plans } = deps;

  server.registerTool(
    'save_recipe',
    {
      title: 'Save a recipe',
      description:
        'Save a recipe: its ingredients (food ids from search_foods with grams) and how many servings it makes. Nutrition per serving is calculated from the foods\' own values. ' +
        'Saving under an existing name replaces that recipe. Recipes can be used in meal plans (save_meal_plan) and the grocery list. Existing plans keep the version they were made with.',
      inputSchema: z.object({
        name: z.string().min(1).max(80),
        servings: z.number().min(0.5).max(50).default(1).describe('How many servings the whole recipe makes'),
        ingredients: z.array(ingredientSchema).min(1).max(40),
        notes: z.string().max(500).optional().describe('Short method or tips'),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ name, servings, ingredients, notes }) => {
      const foods = new FoodMemo(deps);
      const items: RecipeItem[] = [];
      for (const spec of ingredients) {
        const item = await resolveIngredient(spec, foods);
        if (typeof item === 'string') return toolError(`Nothing was saved. ${item}`);
        items.push(item);
      }
      return json({ recipe: view(await plans.saveRecipe(name.trim(), servings, items, notes ?? null)) });
    },
  );

  server.registerTool(
    'list_recipes',
    { title: 'Saved recipes', description: 'The person\'s saved recipes with servings and nutrition per serving.', inputSchema: z.object({}), annotations: { readOnlyHint: true } },
    async () => json({ recipes: (await plans.recipes()).map((r) => ({ id: r.id, name: r.name, servings: r.servings, perServing: roundForDisplay(perServing(r)), ingredients: r.items.length })) }),
  );

  server.registerTool(
    'get_recipe',
    { title: 'One recipe', description: 'A recipe with all its ingredients and notes, by id or name.', inputSchema: z.object({ id: z.uuid().optional(), name: z.string().optional() }), annotations: { readOnlyHint: true } },
    async ({ id, name }) => {
      const r = id ? await plans.recipe(id) : name ? await plans.recipeByName(name) : null;
      return r ? json({ recipe: view(r) }) : toolError('No such recipe. Use list_recipes.');
    },
  );

  server.registerTool(
    'delete_recipe',
    { title: 'Delete a recipe', description: 'Remove a saved recipe (meal plans that already use it keep their copy).', inputSchema: z.object({ id: z.uuid() }), annotations: { destructiveHint: true, idempotentHint: true } },
    async ({ id }) => ((await plans.deleteRecipe(id)) ? json({ deleted: id }) : toolError('No such recipe.')),
  );
}
