import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { createImportLink, lastImport, LINK_MINUTES } from '../import/routes';
import { json, toolError } from './result';

export function registerImportTools(server: McpServer, deps: { db: D1Database; userId: string; publicUrl: string }) {
  server.registerTool(
    'import_fitwell_backup',
    {
      title: 'Import a Fitwell backup',
      description:
        'Brings the history from the Fitwell app (the private, on-device version) into this account: food log, workouts, weigh-ins, measurements, own foods, templates and goals. ' +
        `Returns a one-time link, valid for ${LINK_MINUTES} minutes and only for this person, to a page where they choose the backup file (in the app: Settings → Your data → Save backup). ` +
        'Give the person the link and tell them to open it in their browser; their browser reads the file and uploads it, so the file never goes through the chat. ' +
        'Existing entries are never changed or duplicated, so repeating it is safe. ' +
        'With check_result it makes no link and instead reports what the most recent finished import added, skipped or found already there: use it after the person says they uploaded the file.',
      inputSchema: z.object({ check_result: z.boolean().default(false) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ check_result }) => {
      if (check_result) {
        const last = await lastImport(deps.db, deps.userId);
        return last ? json({ finishedAt: new Date(last.finishedAt).toISOString(), summary: last.lines }) : toolError('No import has finished yet.');
      }
      const { url } = await createImportLink(deps.db, deps.userId, deps.publicUrl);
      return json({ url, validForMinutes: LINK_MINUTES, singleUse: true, next: 'Ask the person to open the link, pick their Fitwell backup file and press Import. Then call import_fitwell_backup again with check_result: true.' });
    },
  );
}
