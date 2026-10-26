import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { buildCelebrations, toCelebrate } from '../analytics/celebrate';
import type { CelebrationResult } from '../analytics/celebrationTypes';
import { achievementsOf, loadStreaks, type StreakDeps } from '../analytics/streaks';
import type { AchievementsData } from '../data/achievements';
import celebrationHtml from '../ui/generated/celebration';
import { toolError, VIEW_ONLY } from './result';

export const CELEBRATION_VIEW_URI = 'ui://fitwell/celebration.html';

export interface CelebrationDeps extends StreakDeps {
  achievements: AchievementsData;
  now?: () => number;
}

export function registerCelebrationTools(server: McpServer, deps: CelebrationDeps) {
  registerAppResource(server, 'Milestone', CELEBRATION_VIEW_URI, {
    description: 'A streak milestone or the goal weight reached: the number, what it took and what is next, and a share card the person can make.',
    // The card can be copied to the clipboard; where the host does not grant this the view shows the picture to press and hold.
    _meta: { ui: { permissions: { clipboardWrite: {} } } },
  }, async () => ({
    contents: [{ uri: CELEBRATION_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: celebrationHtml }],
  }));

  registerAppTool(
    server,
    'show_celebration',
    {
      title: 'Show a milestone',
      description:
        'Opens a calm page for a new milestone: 7 weeks of training, 30 days of logging, the goal weight reached. It shows the number, what it took and what is next. ' +
        'Each milestone is shown once: it picks up what the person has not seen from the last week (the highest per streak) and marks it seen, so a second call right after shows nothing. ' +
        'Call it after finish_workout, log_cardio or log_session, after the first food log of a day, or when you open the weekly review, and only if get_streaks reports newAchievements or you expect a milestone. ' +
        'The page has a "Make a card" button for a picture to share (feed, story or square; light or dark), drawn on their device: nothing is stored or posted, and their name and weight are on it only if they turn them on. ' +
        'When there is nothing new it says so and opens nothing worth showing: do not announce it. Say anything you need to before calling it and write nothing after it, except that if they ask for a caption for the card you can suggest one in the reply: warm, short, about the milestone, never their weight.',
      inputSchema: z.object({}),
      // It marks what it shows as seen, so a repeat call changes the answer.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      _meta: { ui: { resourceUri: CELEBRATION_VIEW_URI } },
    },
    async () => {
      try {
        const loaded = await loadStreaks(deps);
        await deps.achievements.record(achievementsOf(loaded.result));
        const unseen = (await deps.achievements.list()).filter((a) => a.celebratedAt === null);
        const celebrations = buildCelebrations(toCelebrate(unseen, loaded.today), loaded);
        if (unseen.length > 0) await deps.achievements.markCelebrated((deps.now ?? Date.now)());
        const data: CelebrationResult = { celebrations };
        const text = celebrations.length === 0 ? 'Nothing new to celebrate right now.' : `The milestone page is open: ${celebrations.map((c) => c.title).join('; ')}.${VIEW_ONLY}`;
        return { content: [{ type: 'text', text }], structuredContent: data as unknown as Record<string, unknown> };
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'The milestone could not be worked out.');
      }
    },
  );
}
