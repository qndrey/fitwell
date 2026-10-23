import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { DestinationRegistrar, DestinationResult } from '../auth/destinations';
import { findUserByEmail, inviteUser, normalizeEmail } from '../data/users';
import { json, toolError } from './result';

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

const MANUAL = 'On the free Cloudflare plan, add this address as a verified destination in Email Routing (dashboard → fitwell.fyi → Email → Email Routing → Destination addresses)';

function nextStep(d: DestinationResult): string {
  switch (d.status) {
    case 'verification_sent':
      return 'Cloudflare has emailed them a verification link. Tell them to click it (check spam); sign-in emails only arrive after that. Then they add the connector in Claude.';
    case 'already_registered':
      return d.verified ? 'Their address is already a verified destination. Tell them to add the connector in Claude.' : 'Their address is registered but not verified yet: they need to click the link in the earlier Cloudflare email (check spam). Then they add the connector in Claude.';
    case 'failed':
      return `Could not add the destination automatically (${d.reason}). ${MANUAL}, then tell them to add the connector in Claude.`;
    default:
      return `${MANUAL}, then tell them to add the connector in Claude.`;
  }
}

/** Only registered for the people listed in ADMIN_EMAILS, so everyone else never sees it. */
export function registerInviteTools(server: McpServer, deps: { db: D1Database; ownEmail: string; registerDestination?: DestinationRegistrar }) {
  server.registerTool(
    'manage_invites',
    {
      title: 'Manage invitations',
      description:
        'For the owner of this Fitwell server only. list: everyone on the invite list with whether they have signed in. add: invite an email address. remove: take back an invitation that has not been used yet (someone who already signed in deletes their own data with delete_my_account). ' +
        'After add, remind the owner that on the free Cloudflare plan the address must also be a verified destination in Email Routing, or the sign-in email will not arrive, and that the person signs in by adding the connector in Claude.',
      inputSchema: z.object({ action: z.enum(['list', 'add', 'remove']), email: z.string().max(254).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ action, email }) => {
      if (action === 'list') {
        const { results } = await deps.db.prepare('SELECT email, status, created_at, last_login_at FROM users ORDER BY created_at').all<{ email: string; status: string; created_at: number; last_login_at: number | null }>();
        return json({ people: results.map((u) => ({ email: u.email, status: u.status === 'active' ? 'signed in' : 'invited, not signed in yet', invitedAt: new Date(u.created_at).toISOString().slice(0, 10), lastSignIn: u.last_login_at ? new Date(u.last_login_at).toISOString().slice(0, 10) : null })) });
      }
      const address = normalizeEmail(email ?? '');
      if (!EMAIL.test(address)) return toolError('Give a valid email address.');
      if (action === 'add') {
        const existing = await findUserByEmail(deps.db, address);
        if (existing) return json({ email: address, alreadyInvited: true, status: existing.status === 'active' ? 'signed in' : 'invited, not signed in yet' });
        await inviteUser(deps.db, address);
        const destination = deps.registerDestination ? await deps.registerDestination(address) : ({ status: 'not_configured' } as const);
        return json({ email: address, invited: true, destination: destination.status, next: nextStep(destination) });
      }
      const user = await findUserByEmail(deps.db, address);
      if (!user) return toolError('That address is not on the list.');
      if (address === normalizeEmail(deps.ownEmail)) return toolError('You cannot remove yourself.');
      if (user.status === 'active') return toolError('That person has already signed in and has data stored. They can delete their account themselves with delete_my_account.');
      await deps.db.prepare("DELETE FROM users WHERE id = ? AND status = 'invited'").bind(user.id).run();
      return json({ email: address, removed: true });
    },
  );
}
