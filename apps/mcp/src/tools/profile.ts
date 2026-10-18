import { suggestTargets, type ActivityLevel } from '@fitwell/core/domain/energy';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { isTimeZone, todayIn } from '../data/time';
import type { Goals, UserData } from '../data/userData';
import { json, toolError } from './result';

const ACTIVITY = ['sedentary', 'light', 'moderate', 'active', 'very_active'] as const satisfies readonly ActivityLevel[];

export function registerProfileTools(server: McpServer, deps: { data: UserData; email: string }) {
  const { data } = deps;

  server.registerTool(
    'get_profile',
    {
      title: 'Profile and goals',
      description:
        "The person's profile (time zone, units, body data, activity level, equipment, diet preferences and allergies) and goals. " +
        'Read it before planning meals or workouts.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const profile = await data.profile();
      return json({ email: deps.email, today: todayIn(profile.timeZone), profile, goals: await data.goals() });
    },
  );

  server.registerTool(
    'update_profile',
    {
      title: 'Update profile',
      description: 'Change any profile fields; only the ones given change. Weights in kg, heights in cm. diet lists replace the previous lists.',
      inputSchema: z.object({
        time_zone: z.string().refine(isTimeZone, 'An IANA time zone, e.g. "Europe/Copenhagen"').optional(),
        units: z.enum(['metric', 'imperial']).optional().describe('How to present numbers to the person; storage is always metric'),
        sex: z.enum(['female', 'male']).optional().describe('For energy estimates only'),
        birth_year: z.number().int().min(1900).max(new Date().getFullYear() - 13).optional(),
        height_cm: z.number().min(100).max(250).optional(),
        weight_kg: z.number().min(30).max(300).optional(),
        activity_level: z.enum(ACTIVITY).optional(),
        equipment: z.array(z.string().max(40)).max(30).optional().describe('Equipment available for training, e.g. ["barbell","dumbbell","body only"]'),
        bar_kg: z.number().min(0).max(50).optional().describe('Weight of their barbell (default 20)'),
        plates_kg: z.array(z.number().positive().max(50)).min(1).max(12).optional().describe('Plate sizes they have (default 25, 20, 15, 10, 5, 2.5, 1.25)'),
        diet: z
          .object({
            preferences: z.array(z.string().max(60)).max(20).optional(),
            allergies: z.array(z.string().max(60)).max(20).optional(),
            dislikes: z.array(z.string().max(60)).max(30).optional(),
          })
          .optional(),
      }),
      annotations: { idempotentHint: true },
    },
    async (a) => {
      const profile = await data.updateProfile({
        ...(a.time_zone !== undefined && { timeZone: a.time_zone }),
        ...(a.units !== undefined && { units: a.units }),
        ...(a.sex !== undefined && { sex: a.sex }),
        ...(a.birth_year !== undefined && { birthYear: a.birth_year }),
        ...(a.height_cm !== undefined && { heightCm: a.height_cm }),
        ...(a.weight_kg !== undefined && { weightKg: a.weight_kg }),
        ...(a.activity_level !== undefined && { activityLevel: a.activity_level }),
        ...(a.equipment !== undefined && { equipment: a.equipment }),
        ...((a.bar_kg !== undefined || a.plates_kg !== undefined) && { gym: { ...(await data.profile()).gym, ...(a.bar_kg !== undefined && { barKg: a.bar_kg }), ...(a.plates_kg !== undefined && { platesKg: [...new Set(a.plates_kg)].sort((x, y) => y - x) }) } }),
        ...(a.diet !== undefined && { diet: Object.fromEntries(Object.entries(a.diet).filter(([, v]) => v !== undefined)) as never }),
      });
      return json({ profile });
    },
  );

  server.registerTool(
    'suggest_targets',
    {
      title: 'Suggest calorie and macro targets',
      description:
        'Estimates daily calories and macros from the profile (sex, birth year, height, weight, activity level) with Mifflin-St Jeor and standard activity factors, ' +
        'for losing, keeping or gaining weight. With expenditure_kcal (the measured burn from get_progress or the weekly review) that number replaces the formula and the activity level is not needed. ' +
        'Nothing is saved; show the numbers and call set_goals if the person agrees. An estimate, not medical advice.',
      inputSchema: z.object({ goal: z.enum(['lose', 'maintain', 'gain']), rate_kg_per_week: z.number().min(0.1).max(1).optional(), expenditure_kcal: z.number().min(1000).max(6000).optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ goal, rate_kg_per_week, expenditure_kcal }) => {
      const p = await data.profile();
      const missing = [!p.sex && 'sex', !p.birthYear && 'birth_year', !p.heightCm && 'height_cm', !p.weightKg && 'weight_kg', !p.activityLevel && expenditure_kcal === undefined && 'activity_level'].filter(Boolean);
      if (missing.length) return toolError(`Ask for and save these profile fields first (update_profile): ${missing.join(', ')}.`);
      const targets = suggestTargets({
        sex: p.sex!,
        ageYears: new Date().getFullYear() - p.birthYear!,
        heightCm: p.heightCm!,
        weightKg: p.weightKg!,
        activity: p.activityLevel ?? undefined,
        maintenanceKcal: expenditure_kcal,
        goal,
        rateKgPerWeek: rate_kg_per_week,
      });
      const maintenance = expenditure_kcal === undefined ? 'Mifflin-St Jeor BMR × activity factor' : 'measured expenditure as maintenance';
      return json({ goal, targets, method: `${maintenance}; 7700 kcal per kg; protein 1.6 g/kg (2.0 when losing); fat ≥ 25 % of energy` });
    },
  );

  server.registerTool(
    'set_goals',
    {
      title: 'Set goals',
      description: 'Save daily calorie and macro targets, a fibre target, limits for saturated fat and added sugar, workouts per week and goal weight; only the ones given change. Use null to clear one.',
      inputSchema: z.object({
        kcal: z.number().min(800).max(6000).nullable().optional(),
        protein_g: z.number().min(0).max(500).nullable().optional(),
        carbs_g: z.number().min(0).max(1000).nullable().optional(),
        fat_g: z.number().min(0).max(400).nullable().optional(),
        workouts_per_week: z.number().int().min(0).max(14).nullable().optional(),
        goal_weight_kg: z.number().min(30).max(300).nullable().optional(),
        fiber_g: z.number().min(0).max(150).nullable().optional().describe('Daily fibre target (a minimum)'),
        sat_fat_g: z.number().min(0).max(100).nullable().optional().describe('Daily limit for saturated fat'),
        added_sugar_g: z.number().min(0).max(200).nullable().optional().describe('Daily limit for added sugar'),
      }),
      annotations: { idempotentHint: true },
    },
    async (a) => {
      const patch: Partial<Goals> = {
        ...(a.kcal !== undefined && { kcal: a.kcal }),
        ...(a.protein_g !== undefined && { proteinG: a.protein_g }),
        ...(a.carbs_g !== undefined && { carbsG: a.carbs_g }),
        ...(a.fat_g !== undefined && { fatG: a.fat_g }),
        ...(a.workouts_per_week !== undefined && { workoutsPerWeek: a.workouts_per_week }),
        ...(a.goal_weight_kg !== undefined && { goalWeightKg: a.goal_weight_kg }),
        ...(a.fiber_g !== undefined && { fiberG: a.fiber_g }),
        ...(a.sat_fat_g !== undefined && { satFatG: a.sat_fat_g }),
        ...(a.added_sugar_g !== undefined && { addedSugarG: a.added_sugar_g }),
      };
      const goals = await data.setGoals(patch);
      // Deterministic sanity check: do the macros add up to the calorie target?
      const { kcal, proteinG, carbsG, fatG } = goals;
      const fromMacros = proteinG != null && carbsG != null && fatG != null ? proteinG * 4 + carbsG * 4 + fatG * 9 : null;
      const note = kcal != null && fromMacros != null && Math.abs(fromMacros - kcal) > kcal * 0.05 ? `The macros add up to ${Math.round(fromMacros)} kcal, not ${kcal}.` : undefined;
      return json({ goals, ...(note ? { note } : {}) });
    },
  );
}
