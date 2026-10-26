import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { achievementsOf, loadStreaks, type StreakDeps } from '../analytics/streaks';
import type { AchievementsData } from '../data/achievements';
import { json, toolError } from './result';

export interface StreakToolDeps extends StreakDeps {
  achievements: AchievementsData;
}

export function registerStreakTools(server: McpServer, deps: StreakToolDeps) {
  server.registerTool(
    'get_streaks',
    {
      title: 'Get streaks',
      description:
        'The person\'s streaks, from their own logs: training (consecutive weeks with at least their weekly workout target), logging days (days with food logged), logging weeks (weeks with 5 days logged), protein days (days at 90 % of the protein goal) and the goal weight (reached after 7 trend days at the goal). ' +
        'Each streak has current (weeks or days), startedOn, running (this week or today so far), forgiven (one week below target is forgiven), best, next ({ threshold, remaining }) and the milestones reached with the day. ' +
        'atLeast true means the run reaches the first day Fitwell looked at, so say "at least". A streak with status none has a reason: no_target (suggest set_goals), too_few_weigh_ins, keeping_weight, not_reached. ' +
        'Use it for "what is my streak" and when celebrating a milestone. Describe the numbers plainly and warmly: a streak at 0 or a best that is behind is neither good nor bad, never shame, never call a missed day a failure, and never tie weight to worth. Tell them how far the next milestone is.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      try {
        const { today, result } = await loadStreaks(deps);
        // New milestones are written down once, for the celebration view; asking again changes nothing.
        const recorded = await deps.achievements.record(achievementsOf(result));
        return json({ asOf: today, ...result, newAchievements: recorded });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'The streaks could not be worked out.');
      }
    },
  );
}
