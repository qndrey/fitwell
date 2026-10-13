import { addDays } from '@fitwell/core/domain/dates';
import { roundForDisplay, sum } from '@fitwell/core/domain/nutrition';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { PlanData } from '../data/planData';
import { todayIn } from '../data/time';
import { rankCookable } from '../planning/cookable';
import { checkAllergens } from '../safety/allergens';
import type { FoodDeps } from './foods';
import { json } from './result';

export function registerCookTools(server: McpServer, deps: FoodDeps & { plans: PlanData }) {
  const { data, plans } = deps;
  server.registerTool(
    'suggest_meals',
    {
      title: 'What can I cook?',
      description:
        'Given what the person has at home, returns what remains of today\'s calories and macros, their saved recipes ranked by how much of each they already have (with what is missing), and the foods they eat most that match. ' +
        'Use it for "what can I make with chicken, rice and broccoli?". Present one to three options. If no recipe fits well, put together a meal from the foods they have: find them with search_foods, size the portions to the remaining macros, and offer to log it or save it as a recipe. ' +
        'Recipes that contain a food matching the person\'s allergies are left out.',
      inputSchema: z.object({ have: z.array(z.string().min(1).max(60)).min(1).max(40).describe('Foods the person has, e.g. ["chicken breast","rice","broccoli","eggs"]') }),
      annotations: { readOnlyHint: true },
    },
    async ({ have }) => {
      const profile = await data.profile();
      const t = todayIn(profile.timeZone);
      const goals = await data.goals();
      const eaten = sum(await data.foodEntries(t));
      const remaining = goals ? { ...(goals.kcal != null ? { kcal: Math.round(goals.kcal - eaten.kcal) } : {}), ...(goals.proteinG != null ? { protein: Math.round(goals.proteinG - eaten.protein) } : {}) } : null;
      const allergies = profile.diet.allergies.map((a) => a.trim().toLowerCase()).filter(Boolean);
      const recipes = await plans.recipes();
      const safe = recipes.filter((r) => !r.items.some((i) => allergies.some((a) => i.name.toLowerCase().includes(a)) || checkAllergens(allergies, i).contains.length > 0));
      const excluded = recipes.length - safe.length;
      const terms = have.map((h) => h.trim().toLowerCase());
      const frequent = (await data.frequentFoods(addDays(t, -60), t, 40)).filter((f) => terms.some((h) => f.name.toLowerCase().includes(h)));
      return json({
        today: t,
        eatenToday: roundForDisplay(eaten),
        remaining: remaining && Object.keys(remaining).length ? remaining : null,
        recipes: rankCookable(safe, have, remaining?.kcal ?? null),
        ...(excluded ? { leftOutBecauseOfAllergies: excluded } : {}),
        frequentFoods: frequent.slice(0, 8),
        ...(recipes.length === 0 ? { note: 'No saved recipes yet. Build a meal from the foods they have, or save a recipe with save_recipe or import_recipe.' } : {}),
      });
    },
  );
}
