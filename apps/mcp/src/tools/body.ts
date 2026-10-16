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
    'log_body',
    {
      title: 'Log body data',
      description:
        'Record any of these for one day (default today in the person\'s time zone); only what is given is saved, other values of that day are kept. ' +
        'weight_kg: a weigh-in in kg (convert pounds first), one per day, logging again replaces it. ' +
        `measurements: tape measurements in cm and body fat in %, keyed by type: ${PRESETS.map((p) => `${p.key} (${p.label}, ${p.kind === 'percent' ? '%' : 'cm'})`).join(', ')}; Fitwell never estimates body fat, it stores the number from the person's scale or scan. ` +
        'sleep_hours, steps, water_ml (replaces the day\'s total) or add_water_ml (adds a glass to what is logged). ' +
        'With a weigh-in the reply has the 7-day average and its change, which is the number to talk about (single weigh-ins swing by water and food); the latest weigh-in also updates the profile weight that calorie estimates use.',
      inputSchema: z.object({
        day: day.optional(),
        weight_kg: z.number().min(30).max(300).optional(),
        measurements: z.partialRecord(z.enum(KEYS), z.number().min(1).max(250)).optional(),
        sleep_hours: z.number().min(0).max(24).optional(),
        steps: z.number().int().min(0).max(200000).optional(),
        water_ml: z.number().int().min(0).max(20000).optional(),
        add_water_ml: z.number().int().min(1).max(5000).optional(),
      }),
      annotations: { idempotentHint: false },
    },
    async ({ day: d, weight_kg, measurements: given, sleep_hours, steps, water_ml, add_water_ml }) => {
      const values: Record<string, number> = Object.fromEntries(Object.entries(given ?? {}).filter((e): e is [string, number] => e[1] !== undefined));
      const hasMetrics = sleep_hours !== undefined || steps !== undefined || water_ml !== undefined || add_water_ml !== undefined;
      if (weight_kg === undefined && !Object.keys(values).length && !hasMetrics) return toolError('Give at least one of weight_kg, measurements, sleep_hours, steps, water_ml or add_water_ml.');
      if (water_ml !== undefined && add_water_ml !== undefined) return toolError('Give water_ml or add_water_ml, not both.');
      const bad = Object.entries(values).filter(([k, v]) => PRESETS.find((p) => p.key === k)!.kind === 'percent' && v > 70);
      if (bad.length) return toolError('Body fat is a percentage (1 to 70).');
      const profile = await data.profile();
      const when = d ?? todayIn(profile.timeZone);
      const out: Record<string, unknown> = { day: when };
      if (weight_kg !== undefined) {
        await body.setWeight(when, weight_kg);
        const latest = await body.latestWeight();
        if (latest?.day === when) await data.updateProfile({ weightKg: weight_kg });
        const p = await loadProgress(deps, 90);
        const avg = p.weight.average[p.weight.average.length - 1];
        Object.assign(out, { weightKg: weight_kg, sevenDayAverageKg: avg?.kg ?? null, trendChangeKg90d: p.weight.trendChangeKg, fromGoalKg: p.weight.fromGoalKg, ...(avg ? {} : { note: 'The 7-day average appears after 3 weigh-ins within a week.' }) });
      }
      if (Object.keys(values).length) out.measurements = (await body.setMeasurements(when, values)).values;
      if (hasMetrics) {
        const m = await body.setMetrics(when, { sleepH: sleep_hours, steps, waterMl: water_ml, addWaterMl: add_water_ml });
        Object.assign(out, { sleepHours: m.sleepH ?? null, steps: m.steps ?? null, waterMl: m.waterMl ?? null });
      }
      return json({ logged: out });
    },
  );

  server.registerTool(
    'get_progress',
    {
      title: 'Progress report',
      description:
        'How the person is doing over a period (default 90 days): weight trend and distance from goal, calories and macros against goals (days within 10 % of the calorie goal, protein reached), ' +
        'training per week and working sets per muscle, strength records (best estimated 1RM, Epley) and measurement changes. Numbers only; show_dashboard draws charts. ' +
        'energy: the calories the person actually burns, measured from their own logs and weigh-ins over the last 28 days (with confidence, or a reason when there is not enough data), the calories for their goal weight at the default rate, and when the goal weight is reached at the current trend. ' +
        'Prefer it to the formula once it exists; to change the calorie goal, show the numbers and call set_goals only after the person agrees (suggest_targets with expenditure_kcal gives full macros). ' +
        'Describe changes neutrally, and note that a trend needs several weigh-ins.',
      inputSchema: z.object({ days: z.number().int().min(7).max(365).default(90), to: day.optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ days, to }) => json(summarize(await loadProgress(deps, days, to))),
  );
}
