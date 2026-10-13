import { isDay, weekStart as mondayOf } from '@fitwell/core/domain/dates';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { loadWeeklyReview, type ReviewDeps } from '../analytics/load';
import type { WeekReview } from '../analytics/reviewTypes';
import reviewHtml from '../ui/generated/review';
import { REVIEW_VIEW_URI } from '../workout/plan';
import { toolError } from './result';

const input = z.object({ week_start: z.string().refine(isDay, 'Use YYYY-MM-DD').optional().describe('A Monday; default the week that is most useful to look at now') });

export function registerReviewTools(server: McpServer, deps: ReviewDeps) {
  registerAppResource(server, 'Weekly review', REVIEW_VIEW_URI, { description: 'One week of food, training, weight and habits against the week before.' }, async () => ({
    contents: [{ uri: REVIEW_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: reviewHtml }],
  }));

  async function review(weekStart: string | undefined): Promise<{ ok: true; review: WeekReview } | { ok: false; error: CallToolResult }> {
    if (weekStart && mondayOf(weekStart) !== weekStart) return { ok: false, error: toolError(`week_start must be a Monday; ${weekStart} is not.`) };
    try {
      return { ok: true, review: await loadWeeklyReview(deps, weekStart) };
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
        'Use it when the person asks how the week went or what to change, or at the end of a week. Early in the week (Monday, Tuesday) it shows the week that just ended. ' +
        'Talk about it neutrally, offer the suggestions as options, and let the person decide.',
      inputSchema: input,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: REVIEW_VIEW_URI } },
    },
    async ({ week_start }) => {
      const r = await review(week_start);
      if (!r.ok) return r.error;
      return { content: [{ type: 'text', text: `The weekly review is open. ${JSON.stringify(r.review)}` }], structuredContent: { review: r.review } as unknown as Record<string, unknown> };
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
    async ({ week_start }) => {
      const r = await review(week_start);
      if (!r.ok) return r.error;
      return { content: [{ type: 'text', text: `Review for the week of ${r.review.weekStart}.` }], structuredContent: { review: r.review } as unknown as Record<string, unknown> };
    },
  );
}
