import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { ProgramData } from '../data/programs';
import { MAX_DAYS } from '../data/programs';
import type { WorkoutData } from '../data/workoutData';
import { DELOAD_LOAD, DELOAD_SETS, deloadWeeksFor } from '../workout/program';
import { json, toolError } from './result';


/** Programs (A4): a block of weeks over saved workouts, with scheduled deload weeks. start_workout with program: true runs the next session. */
export function registerProgramTools(server: McpServer, deps: { programs: ProgramData; workouts: WorkoutData }) {
  const { programs, workouts } = deps;

  server.registerTool(
    'create_program',
    {
      title: 'Start a training program',
      description:
        'Makes a block of 2 to 16 weeks out of the person\'s saved workouts (save_workout_template first): days is the order of the sessions in a week (Day A, Day B, ...), each a template by name. deload_every makes every Nth week a deload ' +
        `(about ${Math.round(DELOAD_SETS * 100)} % of the sets at about ${Math.round(DELOAD_LOAD * 100)} % of the weight; the weights after it carry on from the last normal session). ` +
        'It becomes the active program and ends the one that was running. Then start_workout with program: true starts "Week 1, Day A", and after each finished session the next. Ask what they want before creating one; propose the days and deload weeks, and let them agree.',
      inputSchema: z.object({
        name: z.string().min(1).max(60),
        weeks: z.number().int().min(2).max(16),
        days: z.array(z.object({ label: z.string().min(1).max(12).optional().describe('Default A, B, C...'), template_name: z.string().min(1).max(60) })).min(1).max(MAX_DAYS),
        deload_every: z.number().int().min(2).max(16).optional().describe('Every Nth week is a deload week'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ name, weeks, days, deload_every }) => {
      const resolved: { label: string; templateId: string }[] = [];
      for (const [i, d] of days.entries()) {
        const t = await workouts.templateByName(d.template_name);
        if (!t) return toolError(`There is no saved workout called "${d.template_name}". Check list_workout_templates.`);
        resolved.push({ label: d.label ?? String.fromCharCode(65 + i), templateId: t.id });
      }
      const p = await programs.create(name, weeks, resolved, deloadWeeksFor(weeks, deload_every));
      const pos = await programs.position(p);
      return json({ program: { name: p.name, weeks: p.weeks, deloadWeeks: p.deloadWeeks, days: days.map((d, i) => ({ label: resolved[i]!.label, workout: d.template_name })) }, next: pos.label, how: 'Start it with start_workout and program: true.' });
    },
  );

  server.registerTool(
    'get_program',
    {
      title: 'The training program',
      description: 'The active program: its weeks, days and deload weeks, how many sessions are done, and what comes next ("Week 3, Day B"). Use it when they ask what is next or how the block is going.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const p = await programs.active();
      if (!p) return json({ program: null, hint: 'No active program. create_program makes one out of saved workouts.' });
      const pos = await programs.position(p);
      const names = new Map((await workouts.templates()).map((t) => [t.id, t.name]));
      return json({
        program: { name: p.name, weeks: p.weeks, deloadWeeks: p.deloadWeeks, days: p.days.map((d) => ({ label: d.label, workout: names.get(d.templateId) ?? 'a workout that was deleted' })) },
        sessionsDone: await programs.completed(p.id),
        sessionsTotal: pos.total,
        next: pos.done ? 'The program is finished.' : { label: pos.label, week: pos.week, day: pos.day.label, workout: names.get(pos.day.templateId) ?? null, deload: pos.deload },
        how: pos.done ? 'create_program starts a new block.' : 'start_workout with program: true starts it.',
      });
    },
  );

  server.registerTool(
    'end_program',
    {
      title: 'End the training program',
      description: 'Ends the active program. Workouts already done stay. Only when they ask.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => ((await programs.end()) ? json({ ended: true }) : toolError('There is no active program.')),
  );
}
