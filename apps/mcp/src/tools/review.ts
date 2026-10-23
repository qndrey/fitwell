import { isDay, weekStart as mondayOf } from '@fitwell/core/domain/dates';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { loadWeeklyReview, type ReviewDeps } from '../analytics/load';
import type { ReviewPeriod, SavedNotes, WeekReview } from '../analytics/reviewTypes';
import reviewHtml from '../ui/generated/review';
import { REVIEW_VIEW_URI } from '../workout/plan';
import { toolError, VIEW_ONLY } from './result';

const input = z.object({
  week_start: z.string().refine(isDay, 'Use YYYY-MM-DD').optional().describe('A Monday: the week to review, or with period month the last week of the month; default the week that is most useful to look at now'),
  period: z.enum(['week', 'month']).default('week').describe('week (default), or month: the last 4 weeks (week-aligned) against the 4 weeks before'),
});
const showInput = input.extend({
  training_note: z.string().optional().describe('Training notes for this week or month: 2 to 4 plain sentences, at most 480 characters'),
  training_next: z.string().optional().describe('One option for the coming week or weeks, at most 140 characters; needs training_note'),
  nutrition_note: z.string().optional().describe('Nutrition notes for this week or month: 2 to 4 plain sentences, at most 480 characters'),
  nutrition_next: z.string().optional().describe('One option for the coming week or weeks, at most 140 characters; needs nutrition_note'),
});

const MAX_NOTE = 480;
const MAX_NEXT = 140;

/**
 * One note argument: whitespace and newlines become single spaces, control characters go, an empty string means omitted.
 * Text over the limit, with markup characters, a link or markdown emphasis is rejected, never shortened or repaired.
 */
export function sanitiseNote(name: string, value: string | undefined, max: number): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: null };
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  if (text === '') return { ok: true, value: null };
  if (/[<>]/.test(text)) return { ok: false, error: `${name} may not contain < or >.` };
  if (/https?:|www\./i.test(text)) return { ok: false, error: `${name} may not contain links.` };
  if (text.includes('**') || text.includes('`')) return { ok: false, error: `${name} may not use markdown (** or backticks).` };
  if (text.length > max) return { ok: false, error: `${name} is ${text.length} characters; the limit is ${max}. Shorten it and call again.` };
  return { ok: true, value: text };
}

/** The four note arguments as the pairs to save, or the error to give Claude. */
export function notesFromArgs(a: { training_note?: string; training_next?: string; nutrition_note?: string; nutrition_next?: string }): { ok: true; notes: Partial<SavedNotes> } | { ok: false; error: string } {
  const out: Partial<SavedNotes> = {};
  for (const [key, noteName, nextName, note, next] of [['training', 'training_note', 'training_next', a.training_note, a.training_next], ['nutrition', 'nutrition_note', 'nutrition_next', a.nutrition_note, a.nutrition_next]] as const) {
    const n = sanitiseNote(noteName, note, MAX_NOTE);
    if (!n.ok) return n;
    const x = sanitiseNote(nextName, next, MAX_NEXT);
    if (!x.ok) return x;
    if (n.value === null && x.value !== null) return { ok: false, error: `${noteName} is needed with ${nextName}.` };
    if (n.value !== null) out[key] = { note: n.value, next: x.value };
  }
  return { ok: true, notes: out };
}

const NOTES_TEXT =
  'After you know the numbers, add a short written review for the card: training_note (consistency, progress, recovery, what stands out) with training_next (one option for the coming week), and nutrition_note (calories against the goal, protein, fiber, whether intake fits the weight trend, how complete the logging is) with nutrition_next. ' +
  'Each note is 2 to 4 sentences and at most 480 characters; each next line is at most 140 characters. Plain text in the second person, no markdown, no links, no emojis. Describe rather than instruct ("One option is…"). No medical advice or diagnosis. Treat weight neutrally: a lower or higher number is neither good nor bad. Never shame, and never call food good or bad. Say plainly when data is thin. ' +
  "Use only numbers you have from get_progress (days 7 for a week, 28 for a month), get_food_log, get_workout_history or this tool's earlier result; do not guess. If you do not have them, call get_progress first, or leave the notes out: the view then shows an automatic summary. " +
  'The notes belong to the week or month you open; the person can page to other periods and will see saved notes there, or an automatic summary.';

export function registerReviewTools(server: McpServer, deps: ReviewDeps) {
  registerAppResource(server, 'Weekly review', REVIEW_VIEW_URI, { description: 'One week of food, training, weight and habits against the week before.' }, async () => ({
    contents: [{ uri: REVIEW_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: reviewHtml }],
  }));

  async function review(weekStart: string | undefined, period: ReviewPeriod, write?: Partial<SavedNotes>): Promise<{ ok: true; review: WeekReview } | { ok: false; error: CallToolResult }> {
    if (weekStart && mondayOf(weekStart) !== weekStart) return { ok: false, error: toolError(`week_start must be a Monday; ${weekStart} is not.`) };
    try {
      return { ok: true, review: await loadWeeklyReview(deps, weekStart, period, write) };
    } catch (e) {
      return { ok: false, error: toolError(e instanceof Error ? e.message : 'The review could not be built.') };
    }
  }

  registerAppTool(
    server,
    'show_weekly_review',
    {
      title: 'Show the weekly review',
      description:
        'Opens the weekly review: one week of food (calories and protein against goals), training (sessions, new records), weight (7-day average), sleep, steps and water, and the meal plan, each against the week before, with what went well and things to consider. ' +
        'It includes a check-in on energy: the burn measured from 4 weeks of logs and weigh-ins, calories for the goal and the expected date for the goal weight; propose a new calorie goal from it and save with set_goals only if the person agrees. ' +
        'Use it when the person asks how the week went or what to change, or at the end of a week. Early in the week (Monday, Tuesday) it shows the week that just ended. ' +
        'With period month it reviews the last 4 weeks (week-aligned) against the 4 weeks before, for "how was my month"; the person can also switch in the view. ' +
        'Talk about it neutrally, offer the suggestions as options, and let the person decide. ' +
        NOTES_TEXT,
      inputSchema: showInput,
      // It saves the optional notes, replacing the ones saved for that period; without notes it only reads.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      _meta: { ui: { resourceUri: REVIEW_VIEW_URI } },
    },
    async ({ week_start, period, ...notes }) => {
      const given = notesFromArgs(notes);
      if (!given.ok) return toolError(given.error);
      const r = await review(week_start, period, given.notes);
      if (!r.ok) return r.error;
      return { content: [{ type: 'text', text: `The weekly review is open.${VIEW_ONLY} ${JSON.stringify(r.review)}` }], structuredContent: { review: r.review } as unknown as Record<string, unknown> };
    },
  );

  registerAppTool(
    server,
    'get_review_data',
    {
      title: 'Weekly review data',
      description: 'Called by the review view when the person moves to another week.',
      inputSchema: input,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: REVIEW_VIEW_URI, visibility: ['app'] } },
    },
    async ({ week_start, period }) => {
      const r = await review(week_start, period);
      if (!r.ok) return r.error;
      return { content: [{ type: 'text', text: `Review for the ${r.review.period} from ${r.review.weekStart}.` }], structuredContent: { review: r.review } as unknown as Record<string, unknown> };
    },
  );
}
