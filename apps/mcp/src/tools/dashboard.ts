import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { loadProgress, type ProgressDeps } from '../analytics/load';
import { summarize } from '../analytics/progress';
import dashboardHtml from '../ui/generated/dashboard';
import { DASHBOARD_VIEW_URI } from '../workout/plan';
import { VIEW_ONLY } from './result';

const input = z.object({ days: z.number().int().min(7).max(365).default(90) });

export function registerDashboardTools(server: McpServer, deps: ProgressDeps) {
  registerAppResource(server, 'Progress dashboard', DASHBOARD_VIEW_URI, { description: 'Weight trend, nutrition against goals, training volume and strength records.' }, async () => ({
    contents: [{ uri: DASHBOARD_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: dashboardHtml }],
  }));

  registerAppTool(
    server,
    'show_dashboard',
    {
      title: 'Show the progress dashboard',
      description:
        'Opens the interactive dashboard in the chat: weight with its 7-day average and goal, calories and macros against goals, training per week and sets per muscle, and strength records. ' +
        'The person can switch the period (30, 90 or 365 days) in the view. Use it when they ask how they are doing, want to see progress or a chart. Default 90 days.',
      inputSchema: input,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: DASHBOARD_VIEW_URI } },
    },
    async ({ days }) => {
      const progress = await loadProgress(deps, days);
      // The view gets the full series as structured content; the model gets the short summary as text.
      return { content: [{ type: 'text', text: `The dashboard is open (${progress.from} to ${progress.to}).${VIEW_ONLY} ${JSON.stringify(summarize(progress))}` }], structuredContent: { progress } as unknown as Record<string, unknown> };
    },
  );

  registerAppTool(
    server,
    'get_dashboard_data',
    {
      title: 'Dashboard data',
      description: 'Called by the dashboard when the period changes: the full series for charts.',
      inputSchema: input,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: DASHBOARD_VIEW_URI, visibility: ['app'] } },
    },
    async ({ days }) => {
      const progress = await loadProgress(deps, days);
      return { content: [{ type: 'text', text: `Dashboard data for ${progress.from} to ${progress.to}.` }], structuredContent: { progress } as unknown as Record<string, unknown> };
    },
  );
}
