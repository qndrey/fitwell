import { isDay, weekStart as mondayOf } from '@fitwell/core/domain/dates';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { HouseholdData, MAX_MEMBERS, MAX_PORTION, MIN_PORTION, type InviteOutcome, type JoinOutcome } from '../data/households';
import type { PlanData } from '../data/planData';
import { json, toolError } from './result';

const day = z.string().refine((d) => isDay(d) && mondayOf(d) === d, 'Use the Monday of the week, YYYY-MM-DD');

const INVITE_ERRORS: Record<Extract<InviteOutcome, { ok: false }>['reason'], string> = {
  not_friends: 'That is not one of their friends. Use list_friends for the connection ids.',
  already_member: 'That friend is already in a household.',
  full: `A household holds up to ${MAX_MEMBERS} people, counting open invitations.`,
  too_many_pending: 'Too many invitations are waiting for an answer.',
  already_invited: 'That friend was already invited and has not answered yet.',
};
const JOIN_ERRORS: Record<Extract<JoinOutcome, { ok: false }>['reason'], string> = {
  not_found: 'No such invitation.',
  already_in_one: 'They are already in a household. Leave it first (leave_household) to join another.',
  full: 'That household is full.',
};

/** Households (B2): people who cook together share one meal plan and one grocery list, with a portion each. Goals, allergies, dislikes and what each person eats stay their own. */
export function registerHouseholdTools(server: McpServer, deps: { households: HouseholdData; plans: PlanData }) {
  const { households, plans } = deps;

  server.registerTool(
    'list_household',
    {
      title: 'Show the household',
      description:
        'The household the person cooks with: its members (shown as friends are, with each one\'s portion), the weeks that have a shared meal plan, and invitations waiting for their answer. ' +
        'Only the plan, the portions and the grocery ticks are shared; nobody sees anyone else\'s goals, allergies or food log. Members are friends. Say plainly what is shared when it comes up.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => json({ household: await households.info(), invitations: await households.incoming(), limit: MAX_MEMBERS }),
  );

  server.registerTool(
    'invite_to_household',
    {
      title: 'Invite a friend to the household',
      description: 'Invites a friend (connection_id from list_friends) to cook together: one shared meal plan and grocery list, a portion each. Creates the household if there is none. The friend sees the invitation when they next ask and decides; nothing is shared until they accept. Ask first.',
      inputSchema: z.object({ connection_id: z.string().min(1).max(64) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ connection_id }) => {
      const r = await households.invite(connection_id);
      return r.ok ? json({ invited: true, next: 'They answer with accept_household_invite when they next ask.' }) : toolError(INVITE_ERRORS[r.reason]);
    },
  );

  server.registerTool(
    'accept_household_invite',
    {
      title: 'Join a household',
      description: 'Joins the household of an invitation (invite_id from list_household). From then on the household\'s meal plans and grocery list are shared with them, at a portion of 1 until they set it (set_household_portion). Only with their yes.',
      inputSchema: z.object({ invite_id: z.string().min(1).max(64) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ invite_id }) => {
      const r = await households.accept(invite_id);
      return r.ok ? json({ joined: true, household: await households.info() }) : toolError(JOIN_ERRORS[r.reason]);
    },
  );

  server.registerTool(
    'decline_household_invite',
    {
      title: 'Decline a household invitation',
      description: 'Turns down an invitation to a household and deletes it.',
      inputSchema: z.object({ invite_id: z.string().min(1).max(64) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ invite_id }) => ((await households.decline(invite_id)) ? json({ declined: true }) : toolError('No such invitation.')),
  );

  server.registerTool(
    'leave_household',
    {
      title: 'Leave the household',
      description: 'Leaves the household. Their own copies of its meal plans stay theirs but stop following it; the others keep theirs. The last one to leave takes the household with them. Only when they ask.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => ((await households.leave()) ? json({ left: true }) : toolError('They are not in a household.')),
  );

  server.registerTool(
    'set_household_portion',
    {
      title: 'Set my portion',
      description: `How much of the shared meal plan this person eats: 1 is the amounts as planned, 0.5 half of them, 1.5 half as much again (${MIN_PORTION} to ${MAX_PORTION}). Scales their copy of the plan and counts toward the grocery list. Only the portion is visible to the others.`,
      inputSchema: z.object({ portion: z.number().min(MIN_PORTION).max(MAX_PORTION) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ portion }) => ((await households.setPortion(portion)) ? json({ portion, household: await households.info() }) : toolError('They are not in a household.')),
  );

  server.registerTool(
    'use_household_plan',
    {
      title: 'Use the household meal plan',
      description:
        'Makes the person\'s own plan for a week a copy of the household\'s shared one, scaled to their portion and checked against their own goals, allergies and dislikes (get_meal_plan, show_meal_plan, Today and logging then work on it as usual). ' +
        'It keeps following the shared plan, rebuilt when the household changes it, until they change it themselves. It replaces any plan of their own for that week, so ask when they have one.',
      inputSchema: z.object({ week_start: day }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ week_start }) => {
      const r = await plans.useHouseholdPlan(week_start);
      if (r === 'not_a_member') return toolError('They are not in a household.');
      if (r === 'no_household_plan') return toolError(`The household has no plan for the week of ${week_start}. Save one with save_meal_plan and household: true.`);
      return json({ using: { weekStart: week_start, meals: r.items.length }, next: 'Show it with get_meal_plan or show_meal_plan; a warning about their allergies or dislikes is theirs alone, so say it.' });
    },
  );
}
