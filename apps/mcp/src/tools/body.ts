import { PRESETS } from '@fitwell/core/data/measurements';
import { isDay } from '@fitwell/core/domain/dates';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { loadProgress, type ProgressDeps } from '../analytics/load';
import { summarize } from '../analytics/progress';
import { todayIn } from '../data/time';
import { json, toolError } from './result';

const day = z.string().refine(isDay, 'Use YYYY-MM-DD');
const KEYS = PRESETS.map((p) => p.key) as [string, ...string[]];

export function registerBodyTools(server: McpServer, deps: ProgressDeps) {
  const { data, body } = deps;

  server.registerTool(
    'log_weight',
    {
      title: 'Log body weight',
      description:
        'Record a weigh-in in kg (convert pounds first). One per day: logging again the same day replaces it. day defaults to today in the person\'s time zone. ' +
        "Returns the 7-day average and its change, which is the number to talk about (single weigh-ins swing by water and food). Also updates the profile weight when it is the latest weigh-in, which calorie estimates use.",
      inputSchema: z.object({ kg: z.number().min(30).max(300), day: day.optional() }),
      annotations: { idempotentHint: true },
    },
    async ({ kg, day: d }) => {
      const profile = await data.profile();
      const when = d ?? todayIn(profile.timeZone);
      await body.setWeight(when, kg);
      const latest = await body.latestWeight();
      if (latest?.day === when) await data.updateProfile({ weightKg: kg });
      const p = await loadProgress(deps, 90);
      const avg = p.weight.average[p.weight.average.length - 1];
      return json({
        logged: { day: when, kg },
        sevenDayAverageKg: avg?.kg ?? null,
        trendChangeKg90d: p.weight.trendChangeKg,
        fromGoalKg: p.weight.fromGoalKg,
        ...(avg ? {} : { note: 'The 7-day average appears after 3 weigh-ins within a week.' }),
      });
    },
  );

  server.registerTool(
    'delete_weight_entry',
    { title: 'Delete a weigh-in', description: 'Remove the weigh-in of a day.', inputSchema: z.object({ day }), annotations: { destructiveHint: true, idempotentHint: true } },
    async ({ day: d }) => ((await body.deleteWeight(d)) ? json({ deleted: d }) : toolError('No weigh-in on that day.')),
  );

  server.registerTool(
    'log_measurements',
    {
      title: 'Log body measurements',
      description:
        'Record tape measurements in cm and body fat in %, for one day (default today). Only the types given are saved; other types logged the same day are kept. ' +
        `Types and how to measure them: ${PRESETS.map((p) => `${p.key} (${p.label}, ${p.kind === 'percent' ? '%' : 'cm'})`).join(', ')}. Fitwell never estimates body fat; it only stores the number from the person's scale or scan.`,
      inputSchema: z.object({
        values: z.partialRecord(z.enum(KEYS), z.number().min(1).max(250)).refine((v) => Object.keys(v).length > 0, 'Give at least one value'),
        day: day.optional(),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ values: given, day: d }) => {
      const values: Record<string, number> = Object.fromEntries(Object.entries(given).filter((e): e is [string, number] => e[1] !== undefined));
      const bad = Object.entries(values).filter(([k, v]) => PRESETS.find((p) => p.key === k)!.kind === 'percent' && v > 70);
      if (bad.length) return toolError('Body fat is a percentage (1 to 70).');
      const when = d ?? todayIn((await data.profile()).timeZone);
      const saved = await body.setMeasurements(when, values);
      return json({ logged: saved });
    },
  );

  server.registerTool(
    'delete_measurements',
    { title: 'Delete a day\'s measurements', description: 'Remove all measurements logged on a day.', inputSchema: z.object({ day }), annotations: { destructiveHint: true, idempotentHint: true } },
    async ({ day: d }) => ((await body.deleteMeasurements(d)) ? json({ deleted: d }) : toolError('No measurements on that day.')),
  );

  server.registerTool(
    'get_progress',
    {
      title: 'Progress report',
      description:
        'How the person is doing over a period (default 90 days): weight trend and distance from goal, calories and macros against goals (days within 10 % of the calorie goal, protein reached), ' +
        'training per week and working sets per muscle, strength records (best estimated 1RM, Epley) and measurement changes. Numbers only; show_dashboard draws charts. ' +
        'Describe changes neutrally, and note that a trend needs several weigh-ins.',
      inputSchema: z.object({ days: z.number().int().min(7).max(365).default(90), to: day.optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ days, to }) => json(summarize(await loadProgress(deps, days, to))),
  );
}
