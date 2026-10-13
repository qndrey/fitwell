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
        'Existing entries are never changed or duplicated, so repeating it is safe. Afterwards, get_last_import shows what was imported.',
      inputSchema: z.object({}),
    },
    async () => {
      const { url } = await createImportLink(deps.db, deps.userId, deps.publicUrl);
      return json({ url, validForMinutes: LINK_MINUTES, singleUse: true, next: 'Ask the person to open the link, pick their Fitwell backup file and press Import. Then call get_last_import.' });
    },
  );

  server.registerTool(
    'get_last_import',
    { title: 'Result of the last import', description: 'What the most recent finished backup import added, skipped or found already there.', inputSchema: z.object({}), annotations: { readOnlyHint: true } },
    async () => {
      const last = await lastImport(deps.db, deps.userId);
      return last ? json({ finishedAt: new Date(last.finishedAt).toISOString(), summary: last.lines }) : toolError('No import has finished yet.');
    },
  );
}
