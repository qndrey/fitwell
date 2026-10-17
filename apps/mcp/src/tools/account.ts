import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { UserData } from '../data/userData';
import { json } from './result';

export interface AccountDeps {
  data: UserData;
  /** Everything else the person stored (workouts, templates), merged into the export. */
  extraExport: () => Promise<Record<string, unknown>>;
  email: string;
  /** Erases the person's data and signs them out everywhere (revokes every OAuth grant). */
  deleteAccount: () => Promise<void>;
}

const CONFIRM = 'delete my account';

export function registerAccountTools(server: McpServer, deps: AccountDeps) {
  server.registerTool(
    'export_my_data',
    {
      title: 'Export my data',
      description: 'Everything Fitwell stores about the person (profile, goals, food log, own foods, workouts, templates, weigh-ins, measurements, recipes, meal plans) as JSON, for their own copy.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => json({ exportedAt: new Date().toISOString(), email: deps.email, ...(await deps.data.exportAll()), ...(await deps.extraExport()) }),
  );

  server.registerTool(
    'delete_my_account',
    {
      title: 'Delete my account',
      description:
        'Permanently erases everything Fitwell stores about the person and signs them out of every client. Cannot be undone. ' +
        `Only call it after the person explicitly asked, offered them export_my_data first, and they typed "${CONFIRM}".`,
      inputSchema: z.object({ confirm: z.literal(CONFIRM) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async () => {
      await deps.deleteAccount();
      return json({ deleted: true, message: 'Your Fitwell data is erased, including your invitation, and you are signed out. To use Fitwell again you would need a new invitation.' });
    },
  );
}
