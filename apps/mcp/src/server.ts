import type { OffClient } from '@fitwell/core/off/client';
import { McpServer } from '@modelcontextprotocol/server';
import { UserData } from './data/userData';
import type { User } from './data/users';
import { registerAccountTools } from './tools/account';
import { registerExerciseTools } from './tools/exercises';
import { registerFoodLogTools } from './tools/foodLog';
import { registerFoodTools } from './tools/foods';
import { registerProfileTools } from './tools/profile';
import { registerWorkoutTools } from './tools/workout';

export interface ServerDeps {
  off: OffClient;
  db: D1Database;
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
Workouts: when the person wants to train now, plan it with them, then call start_workout to open the interactive player; they log sets there and the player sends you a summary at the end.`;

/** A fresh server per request (stateless serving); module-level caches keep the datasets warm between requests. */
export async function createServer(deps: ServerDeps): Promise<McpServer> {
  const server = new McpServer({ name: 'fitwell', title: 'Fitwell', version: '0.2.0' }, { instructions: INSTRUCTIONS });
  const data = new UserData(deps.db, deps.user.id);
  registerProfileTools(server, { data, email: deps.user.email });
  registerFoodTools(server, { off: deps.off, data });
  registerFoodLogTools(server, { off: deps.off, data });
  registerAccountTools(server, { data, email: deps.user.email, deleteAccount: deps.deleteAccount });
  await registerExerciseTools(server);
  await registerWorkoutTools(server);
  return server;
}
