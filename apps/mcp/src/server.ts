import type { OffClient } from '@fitwell/core/off/client';
import { McpServer } from '@modelcontextprotocol/server';
import { BodyData } from './data/bodyData';
import { PlanData } from './data/planData';
import { UserData } from './data/userData';
import type { User } from './data/users';
import { WorkoutData } from './data/workoutData';
import { registerAccountTools } from './tools/account';
import { registerCookTools } from './tools/cook';
import { registerDeleteTool } from './tools/deleteItem';
import { registerInviteTools } from './tools/invites';
import { registerReviewTools } from './tools/review';
import { registerShoppingTools } from './tools/shopping';
import { registerBodyTools } from './tools/body';
import { registerDashboardTools } from './tools/dashboard';
import { registerExerciseTools } from './tools/exercises';
import { registerFoodLogTools } from './tools/foodLog';
import { registerFoodTools } from './tools/foods';
import { registerImportTools } from './tools/import';
import { registerPlanningTools } from './tools/planning';
import { registerRecipeTools } from './tools/recipes';
import { registerProfileTools } from './tools/profile';
import { registerWorkoutTools } from './tools/workout';

export interface ServerDeps {
  off: OffClient;
  db: D1Database;
  /** The public origin, for links the server gives out (backup import). */
  publicUrl: string;
  /** The signed-in person, from the verified OAuth token. */
  user: Pick<User, 'id' | 'email'>;
  deleteAccount: () => Promise<void>;
  /** Opens recipe web pages; the global fetch in the Worker. */
  fetch?: typeof fetch;
  /** The owner of this server also gets manage_invites. */
  isAdmin?: boolean;
}

const INSTRUCTIONS = `Fitwell tracks food, workouts, body data and meal plans for the signed-in person.
Start with get_profile when planning anything: it has their time zone, goals, equipment, diet preferences and allergies.
Food: search_foods (their own foods, Frida generic foods, optionally Open Food Facts) or lookup_barcode. Values are per 100 g; convert portions to grams, then log_food with the food ids. get_food_log shows a day (or several) and what remains of their goals.
Never invent macros silently: if a food is not found, say so; log an estimate only as one (log_food with estimate_per100g) or save a custom food from a label. From a photo of a meal, name each item, find it with search_foods, estimate the grams and log with amount_estimated, telling the person what you assumed.
Allergies: log_food and save_meal_plan report allergy matches (from names and, for packaged foods, Open Food Facts allergen data). Say them plainly, never present a plan with an ALLERGY warning, and remember foods without allergen data are matched by name only.
Goals: suggest_targets estimates calories and macros from the profile; save with set_goals only after the person agrees.
Exercises: search_exercises (with id for instructions). Use library ids when building workouts.
Workouts: when the person wants to train now, plan it with them (or offer a saved template from list_workout_templates), then call start_workout to open the interactive player; leave weights out to let Fitwell apply its progression rule from their history. They log sets in the player, which sends you a summary with any personal records at the end. get_workout_history and suggest_progression show past sessions and next weights. Add a warm-up or finisher to a strength workout with the cardio argument (when: before or after); exercises can carry a note, and the person can write their own in the player (the last note is shown as a reminder next time). Log runs, rides and other activities on their own with log_cardio.
Meal plans: get_planning_context first (goals, allergies, what they actually eat, saved recipes), then build the week from foods and recipes with ids and save_meal_plan; its reply lists problems against the calorie and protein goals and any allergy or dislike match: fix and save again before presenting. get_meal_plan shows the week and what to batch-cook; show_grocery_list opens the shopping checklist the person ticks off in the shop; log_planned_meal logs a planned meal as eaten.
Recipes: save_recipe stores them (with steps and source_url); import_recipe reads a recipe web page (then match its lines to foods and save it); get_recipes lists or shows them. suggest_meals answers "what can I cook with what I have" using today's remaining macros.
History: import_fitwell_backup gives the person a one-time link to upload a backup from the private Fitwell app (check_result reports the outcome). log_past_workout records a workout they already did.
Body: log_body takes weight (kg), measurements (cm, body fat %), sleep, steps and water. Talk about the 7-day average and the trend, never a single weigh-in, and keep the tone neutral. get_progress gives the numbers over a period; show_dashboard opens charts; show_weekly_review opens the week against the one before, with things to consider.
delete_item removes any one stored thing, only when the person asks.`;

/** A fresh server per request (stateless serving); module-level caches keep the datasets warm between requests. */
export async function createServer(deps: ServerDeps): Promise<McpServer> {
  const server = new McpServer({ name: 'fitwell', title: 'Fitwell', version: '0.2.0' }, { instructions: INSTRUCTIONS });
  const data = new UserData(deps.db, deps.user.id);
  const workouts = new WorkoutData(deps.db, deps.user.id);
  const body = new BodyData(deps.db, deps.user.id);
  const plans = new PlanData(deps.db, deps.user.id);
  registerProfileTools(server, { data, email: deps.user.email });
  registerFoodTools(server, { off: deps.off, data });
  registerFoodLogTools(server, { off: deps.off, data });
  registerAccountTools(server, { data, extraExport: async () => ({ ...(await workouts.exportAll()), ...(await body.exportAll()), ...(await plans.exportAll()) }), email: deps.user.email, deleteAccount: deps.deleteAccount });
  await registerExerciseTools(server);
  await registerWorkoutTools(server, { data, workouts });
  registerBodyTools(server, { data, workouts, body });
  registerRecipeTools(server, { off: deps.off, data, plans, fetch: deps.fetch ?? fetch, userAgent: 'Fitwell/0.3 (+https://mcp.fitwell.fyi)' });
  registerPlanningTools(server, { off: deps.off, data, plans });
  registerShoppingTools(server, { off: deps.off, data, plans });
  registerCookTools(server, { off: deps.off, data, plans });
  registerImportTools(server, { db: deps.db, userId: deps.user.id, publicUrl: deps.publicUrl });
  registerDashboardTools(server, { data, workouts, body });
  registerReviewTools(server, { data, workouts, body, plans });
  registerDeleteTool(server, { data, workouts, body, plans });
  if (deps.isAdmin) registerInviteTools(server, { db: deps.db, ownEmail: deps.user.email });
  return server;
}
