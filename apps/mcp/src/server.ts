import type { OffClient } from '@fitwell/core/off/client';
import { McpServer } from '@modelcontextprotocol/server';
import { registerExerciseTools } from './tools/exercises';
import { registerFoodTools } from './tools/foods';

export interface ServerDeps {
  off: OffClient;
}

const INSTRUCTIONS = `Fitwell tracks food, workouts and body weight for the signed-in person.
Foods: search_foods (Frida, generic foods) or lookup_barcode (packaged). Macros are per 100 g; work out grams before logging.
Exercises: search_exercises, then get_exercise for instructions. Use library ids when building workouts.
Never invent macros silently: if a food is not found, say so and offer an estimate clearly marked as one.`;

/** A fresh server per request (stateless serving); module-level caches keep the datasets warm between requests. */
export async function createServer(deps: ServerDeps): Promise<McpServer> {
  const server = new McpServer({ name: 'fitwell', title: 'Fitwell', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  registerFoodTools(server, deps);
  await registerExerciseTools(server);
  return server;
}
