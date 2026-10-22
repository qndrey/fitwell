import type { OffClient } from '@fitwell/core/off/client';
import { McpServer } from '@modelcontextprotocol/server';
import { BodyData } from './data/bodyData';
import { PlanData } from './data/planData';
import { UserData } from './data/userData';
import type { User } from './data/users';
import { WorkoutData } from './data/workoutData';
import { SERVER_INSTRUCTIONS, withRoles } from './instructions';
import { registerAccountTools } from './tools/account';
import { registerCookTools } from './tools/cook';
import { registerDeleteTool } from './tools/deleteItem';
import { registerInviteTools } from './tools/invites';
import { registerReviewTools } from './tools/review';
import { registerShoppingTools } from './tools/shopping';
import { registerBodyTools } from './tools/body';
import { registerDashboardTools } from './tools/dashboard';
import { registerMuscleTools } from './tools/muscles';
import { registerLiftTools } from './tools/lift';
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

/** A fresh server per request (stateless serving); module-level caches keep the datasets warm between requests. */
export async function createServer(deps: ServerDeps): Promise<McpServer> {
  const mcp = new McpServer({ name: 'fitwell', title: 'Fitwell', version: '0.2.0' }, { instructions: SERVER_INSTRUCTIONS });
  const data = new UserData(deps.db, deps.user.id);
  const workouts = new WorkoutData(deps.db, deps.user.id);
  const body = new BodyData(deps.db, deps.user.id);
  const plans = new PlanData(deps.db, deps.user.id);
  // The tools Claude reads before planning or advising answer with the role to take (src/instructions/*.md).
  const server = withRoles(mcp, {
    trainer: ['search_exercises', 'list_workout_templates', 'suggest_progression', 'get_workout_history', 'show_muscle_map'],
    nutritionist: ['suggest_targets', 'get_planning_context', 'suggest_meals', 'get_food_log', 'get_meal_plan'],
    progressCoach: ['get_progress', 'show_weekly_review', 'show_dashboard'],
  });
  registerProfileTools(server, { data, email: deps.user.email });
  registerFoodTools(server, { off: deps.off, data });
  registerFoodLogTools(server, { off: deps.off, data, plans });
  registerAccountTools(server, { data, extraExport: async () => ({ ...(await workouts.exportAll()), ...(await body.exportAll()), ...(await plans.exportAll()) }), email: deps.user.email, deleteAccount: deps.deleteAccount });
  await registerExerciseTools(server, { data });
  await registerWorkoutTools(server, { data, workouts });
  registerBodyTools(server, { data, workouts, body });
  registerRecipeTools(server, { off: deps.off, data, plans, fetch: deps.fetch ?? fetch, userAgent: 'Fitwell/0.3 (+https://mcp.fitwell.fyi)' });
  registerPlanningTools(server, { off: deps.off, data, plans });
  registerShoppingTools(server, { off: deps.off, data, plans });
  registerCookTools(server, { off: deps.off, data, plans });
  registerImportTools(server, { db: deps.db, userId: deps.user.id, publicUrl: deps.publicUrl });
  registerDashboardTools(server, { data, workouts, body });
  registerMuscleTools(server, { data, workouts });
  await registerLiftTools(server, { data, workouts });
  registerReviewTools(server, { data, workouts, body, plans });
  registerDeleteTool(server, { data, workouts, body, plans });
  if (deps.isAdmin) registerInviteTools(server, { db: deps.db, ownEmail: deps.user.email });
  return mcp;
}
