import { isDay } from '@fitwell/core/domain/dates';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { InjuryData } from '../data/injuries';
import { todayIn } from '../data/time';
import type { UserData } from '../data/userData';
import { INJURY_AREAS } from '../training/injuries';
import { json, toolError } from './result';

const day = z.string().refine(isDay, 'Use YYYY-MM-DD');

/** Injuries and limitations (A11). Saved only when the person tells Claude and agrees; used to flag exercises and rank swaps; never shared with friends or put on a card. */
export function registerInjuryTools(server: McpServer, deps: { data: UserData; injuries: InjuryData }) {
  const { data, injuries } = deps;
  const today = async () => todayIn((await data.profile()).timeZone);

  server.registerTool(
    'add_injury',
    {
      title: 'Remember an injury',
      description:
        'Saves an injury or limitation the person told you about, so it is not asked again in every chat: a body area, their own words about what hurts, what they were told or said to avoid, since when, and optionally the day it should be over. ' +
        'Ask first and save only what they said and agreed to save in this conversation; never guess an area, never diagnose, never name a condition they did not name. It is health data: it stays with them, is never shared with friends or put on a card, and they can have it ended or removed any time. ' +
        'Once saved, search_exercises, start_workout and workout templates flag the exercises that load the area, and substitutes rank around it. A flag means "this loads the area", not that anything is safe or unsafe.',
      inputSchema: z.object({
        area: z.enum(INJURY_AREAS).describe('The closest body area; other when none fits (then only what they say to avoid flags exercises)'),
        note: z.string().max(200).default('').describe('What hurts, in their own words'),
        avoid: z.string().max(200).default('').describe('What to avoid, in their words, e.g. "overhead pressing, deep squats"'),
        since: day.optional().describe('When it started, if they said'),
        until: day.optional().describe('The last day it applies, if they gave one'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ area, note, avoid, since, until }) => {
      if (since && until && until < since) return toolError('The end day is before the start day.');
      const saved = await injuries.add({ area, note, avoid, since: since ?? null, until: until ?? null });
      return json({ saved, next: 'Say what you saved in one line. Do not diagnose or say what is safe; offer swaps for flagged exercises.' });
    },
  );

  server.registerTool(
    'end_injury',
    {
      title: 'Mark an injury as over',
      description: 'Marks a saved injury as over, from today or a day the person gives: its flags stop from then on and it stays in their export. To change what an injury says, end it and add the new one. Use it when they say it has healed or they were cleared.',
      inputSchema: z.object({ id: z.uuid().describe('From get_profile'), day: day.optional().describe('The first day it no longer applies; default today') }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, day: d }) => {
      const first = d ?? (await today());
      // The last day it applies is the day before the first day it is over.
      const last = new Date(Date.parse(`${first}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      return (await injuries.end(id, last)) ? json({ ended: id, from: first }) : toolError('No such injury.');
    },
  );
}
