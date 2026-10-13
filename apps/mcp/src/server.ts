import type { OffClient } from '@fitwell/core/off/client';
import { McpServer } from '@modelcontextprotocol/server';
import { BodyData } from './data/bodyData';
import { UserData } from './data/userData';
import type { User } from './data/users';
import { WorkoutData } from './data/workoutData';
import { registerAccountTools } from './tools/account';
import { registerBodyTools } from './tools/body';
import { registerDashboardTools } from './tools/dashboard';
import { registerExerciseTools } from './tools/exercises';
import { registerFoodLogTools } from './tools/foodLog';
import { registerFoodTools } from './tools/foods';
import { registerImportTools } from './tools/import';
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
}

const INSTRUCTIONS = `Fitwell tracks food, workouts and body weight for the signed-in person.
Start with get_profile when planning anything: it has their time zone, goals, equipment, diet preferences and allergies.
Foods: search_foods (their own foods, Frida generic foods, optionally Open Food Facts) or lookup_barcode. Values are per 100 g; convert portions to grams, then log_food with the food ids. Use get_day for the day so far and what remains of their goals.
Never invent macros silently: if a food is not found, say so; log an estimate only as one (log_food with estimate_per100g) or save a custom food from a label.
Goals: suggest_targets estimates calories and macros from the profile; save with set_goals only after the person agrees.
Exercises: search_exercises, then get_exercise for instructions. Use library ids when building workouts.
Workouts: when the person wants to train now, plan it with them (or offer a saved template from list_workout_templates), then call start_workout to open the interactive player; leave weights out to let Fitwell apply its progression rule from their history. They log sets in the player, which sends you a summary with any personal records at the end. get_workout_history and suggest_progression show past sessions and next weights. Log runs, rides and other activities with log_cardio.
History: import_fitwell_backup gives the person a one-time link to upload a backup from the private Fitwell app; get_last_import reports the result. log_past_workout records a workout they already did.
Body: log_weight (kg) and log_measurements (cm, body fat %). Talk about the 7-day average and the trend, never a single weigh-in, and keep the tone neutral. get_progress gives the numbers over a period; show_dashboard opens charts the person can read themselves.`;

/** A fresh server per request (stateless serving); module-level caches keep the datasets warm between requests. */
export async function createServer(deps: ServerDeps): Promise<McpServer> {
  const server = new McpServer({ name: 'fitwell', title: 'Fitwell', version: '0.2.0' }, { instructions: INSTRUCTIONS });
  const data = new UserData(deps.db, deps.user.id);
  const workouts = new WorkoutData(deps.db, deps.user.id);
  const body = new BodyData(deps.db, deps.user.id);
  registerProfileTools(server, { data, email: deps.user.email });
  registerFoodTools(server, { off: deps.off, data });
  registerFoodLogTools(server, { off: deps.off, data });
  registerAccountTools(server, { data, extraExport: async () => ({ ...(await workouts.exportAll()), ...(await body.exportAll()) }), email: deps.user.email, deleteAccount: deps.deleteAccount });
  await registerExerciseTools(server);
  await registerWorkoutTools(server, { data, workouts });
  registerBodyTools(server, { data, workouts, body });
  registerImportTools(server, { db: deps.db, userId: deps.user.id, publicUrl: deps.publicUrl });
  registerDashboardTools(server, { data, workouts, body });
  return server;
}
