import { addDays, dayDiff, isDay, weekStart } from '@fitwell/core/domain/dates';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { achievementsOf, loadStreaks, type StreakDeps } from '../analytics/streaks';
import type { AchievementsData } from '../data/achievements';
import { todayIn } from '../data/time';
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
        'frozenWeeks lists the Mondays of recent and coming weeks the person froze (set_streak_freeze). atLeast true means the run reaches the first day Fitwell looked at, so say "at least". A streak with status none has a reason: no_target (suggest set_goals), too_few_weigh_ins, keeping_weight, not_reached. ' +
        'Use it for "what is my streak" and when celebrating a milestone. Describe the numbers plainly and warmly: a streak at 0 or a best that is behind is neither good nor bad, never shame, never call a missed day a failure, and never tie weight to worth. Tell them how far the next milestone is.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      try {
        const { today, result, frozenWeeks } = await loadStreaks(deps);
        // New milestones are written down once, for the celebration view; asking again changes nothing.
        const recorded = await deps.achievements.record(achievementsOf(result));
        const recent = addDays(weekStart(today), -7 * (FORGIVE_WEEKS + 1));
        return json({ asOf: today, ...result, frozenWeeks: frozenWeeks.filter((w) => w >= recent), newAchievements: recorded });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'The streaks could not be worked out.');
      }
    },
  );

  server.registerTool(
    'set_streak_freeze',
    {
      title: 'Freeze a week',
      description:
        'Freezes a week for the weekly streaks (training and logging weeks), or lifts the freeze: for a planned rest week, a holiday, being unwell. ' +
        'A frozen week below its target keeps the streak going without adding to it, and does not use the one forgiven week; up to 4 frozen weeks in any 11 count, and a week that met its target counts as usual and uses none. Daily streaks are not frozen. ' +
        `Give any day in the week (default today; the person's own days, Monday to Sunday); weeks from ${BACK_WEEKS} back to ${AHEAD_WEEKS} ahead can be frozen. ` +
        'Only on their request or with their yes: offer it when they say they will be away, rest or are ill. Say it plainly and warmly, with no pressure either way.',
      inputSchema: z.object({
        day: z.string().refine(isDay, 'Use YYYY-MM-DD').optional().describe('Any day in the week; default today'),
        frozen: z.boolean().default(true).describe('false lifts the freeze'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ day, frozen }) => {
      const today = todayIn((await deps.data.profile()).timeZone);
      const week = weekStart(day ?? today);
      const current = weekStart(today);
      if (dayDiff(current, week) < -7 * BACK_WEEKS || dayDiff(current, week) > 7 * AHEAD_WEEKS) {
        return toolError(`Only weeks from ${BACK_WEEKS} back to ${AHEAD_WEEKS} ahead of this one can be frozen; the week of ${week} is outside that.`);
      }
      await deps.data.setStreakFreeze(week, frozen);
      const frozenWeeks = (await deps.data.streakFreezes(addDays(current, -7 * (FORGIVE_WEEKS + 1)))).slice(-(FORGIVE_WEEKS + 1 + AHEAD_WEEKS));
      return json({ week, frozen, frozenWeeks, note: frozen ? `The week of ${week} is frozen for the training and logging week streaks.` : `The freeze on the week of ${week} is lifted.` });
    },
  );
}

/** How far back and ahead a week can be frozen, and how many weeks the forgiveness rules look back over. */
const BACK_WEEKS = 4;
const AHEAD_WEEKS = 4;
const FORGIVE_WEEKS = 11;
