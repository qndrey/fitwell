// Households (B2): friends who cook together share one meal plan and one grocery list with a portion each; goals, allergies and what each person ate stay their own.
import { addDays, weekStart } from '@fitwell/core/domain/dates';
import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MealPlanView } from '../src/analytics/mealPlanTypes';
import type { FriendList } from '../src/data/friends';
import type { HouseholdInfo, HouseholdInvite } from '../src/data/households';
import type { ShoppingData } from '../src/planning/shoppingTypes';
import { todayIn } from '../src/data/time';
import { deleteUser, type User } from '../src/data/users';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';

const today = todayIn('Europe/Copenhagen');
const week = weekStart(today);
const OATS = 'frida:59';
const RYE = 'frida:413'; // 209 kcal per 100 g

let env: Env;
let ana: User;
let bo: User;
let cy: User;
let anaC: Client;
let boC: Client;
let cyC: Client;
beforeEach(async () => {
  env = createTestEnv().env;
  [ana, bo, cy] = [await signedInUser(env, 'ana@example.com'), await signedInUser(env, 'bo@example.com'), await signedInUser(env, 'cy@example.com')];
  [anaC, boC, cyC] = [await connectAs(env, ana), await connectAs(env, bo), await connectAs(env, cy)];
});

/** The connection id as `from` sees a friend, after making them friends. */
async function befriend(from: Client, to: Client, email: string) {
  await call(from, 'request_friend', { email });
  const incoming = ((await call(to, 'list_friends')).data as unknown as FriendList).incoming[0]!.connectionId;
  await call(to, 'accept_friend', { connection_id: incoming });
  return ((await call(from, 'list_friends')).data as unknown as FriendList).friends.find((f) => f.nickname === null && f.email === email)!.connectionId;
}
const household = async (c: Client) => ((await call(c, 'list_household')).data as unknown as { household: HouseholdInfo | null; invitations: HouseholdInvite[] });
/** Ana invites Bo and Bo accepts. */
async function join() {
  const id = await befriend(anaC, boC, 'bo@example.com');
  await call(anaC, 'invite_to_household', { connection_id: id });
  await call(boC, 'accept_household_invite', { invite_id: (await household(boC)).invitations[0]!.inviteId });
}
const items = (grams = 80) => [{ day: week, slot: 'breakfast', food_id: OATS, grams }, { day: addDays(week, 1), slot: 'lunch', food_id: RYE, grams: 200 }];
const shared = (c: Client, its: Record<string, unknown>[] = items()) => call(c, 'save_meal_plan', { week_start: week, items: its, household: true });
const meals = async (c: Client) => {
  const r = await call(c, 'get_meal_plan', { week_start: week });
  return r.isError ? [] : (r.data as unknown as { days: { meals: { name: string; grams: number; kcal: number; logged?: boolean }[] }[] }).days.flatMap((d) => d.meals);
};

describe('membership', () => {
  it('invites a friend, who sees it and joins; both then see the household with the portions', async () => {
    const id = await befriend(anaC, boC, 'bo@example.com');
    expect((await call(anaC, 'invite_to_household', { connection_id: id })).isError).toBe(false);
    expect((await household(boC)).invitations).toMatchObject([{ from: { email: 'ana@example.com' } }]);
    expect((await household(boC)).household).toBeNull(); // not a member yet: nothing of it is visible
    expect((await call(boC, 'accept_household_invite', { invite_id: (await household(boC)).invitations[0]!.inviteId })).isError).toBe(false);
    for (const c of [anaC, boC]) expect((await household(c)).household!.members).toMatchObject([{ email: 'ana@example.com', portion: 1 }, { email: 'bo@example.com', portion: 1 }]);
    expect((await household(boC)).household!.members.map((m) => m.you)).toEqual([false, true]);
    expect((await household(boC)).invitations).toEqual([]);
  });

  it('only friends can be invited, and only people not in a household already', async () => {
    const pending = ((await call(anaC, 'list_friends')).data as unknown as FriendList).friends;
    expect(pending).toEqual([]);
    expect((await call(anaC, 'invite_to_household', { connection_id: 'nope' })).isError).toBe(true);
    const eveC = await connectAs(env, await signedInUser(env, 'eve@example.com'));
    await call(anaC, 'request_friend', { email: 'eve@example.com' }); // a request is not a friend
    const requestId = ((await call(eveC, 'list_friends')).data as unknown as FriendList).incoming[0]!.connectionId;
    expect((await call(anaC, 'invite_to_household', { connection_id: requestId })).isError).toBe(true);
    await join();
    const boToCy = await befriend(boC, cyC, 'cy@example.com');
    await call(cyC, 'set_household_portion', { portion: 1 }); // not in one: refused
    expect((await call(boC, 'invite_to_household', { connection_id: boToCy })).isError).toBe(false);
    await call(cyC, 'accept_household_invite', { invite_id: (await household(cyC)).invitations[0]!.inviteId });
    // Cy is in Ana and Bo's household; inviting Cy elsewhere is refused.
    const dan = await signedInUser(env, 'dan@example.com');
    const danC = await connectAs(env, dan);
    const danToCy = await befriend(danC, cyC, 'cy@example.com');
    expect((await call(danC, 'invite_to_household', { connection_id: danToCy })).text).toContain('already in a household');
  });

  it('answering is up to the invitee: a decline deletes the invitation, and a stranger cannot answer someone else\'s', async () => {
    const id = await befriend(anaC, boC, 'bo@example.com');
    await call(anaC, 'invite_to_household', { connection_id: id });
    const invite = (await household(boC)).invitations[0]!.inviteId;
    expect((await call(cyC, 'accept_household_invite', { invite_id: invite })).isError).toBe(true);
    expect((await call(cyC, 'decline_household_invite', { invite_id: invite })).isError).toBe(true);
    expect((await call(anaC, 'invite_to_household', { connection_id: id })).isError).toBe(true); // already invited
    expect((await call(boC, 'decline_household_invite', { invite_id: invite })).isError).toBe(false);
    expect((await household(boC)).invitations).toEqual([]);
    expect((await household(boC)).household).toBeNull();
  });

  it('an invitation from someone who is no longer a friend is not shown or accepted', async () => {
    const id = await befriend(anaC, boC, 'bo@example.com');
    await call(anaC, 'invite_to_household', { connection_id: id });
    const invite = (await household(boC)).invitations[0]!.inviteId;
    await call(anaC, 'remove_friend', { connection_id: id });
    expect((await household(boC)).invitations).toEqual([]);
    expect((await call(boC, 'accept_household_invite', { invite_id: invite })).isError).toBe(true);
  });

  it('a household holds six people at most, counting open invitations', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const p = await signedInUser(env, `p${i}@example.com`);
      ids.push(await befriend(anaC, await connectAs(env, p), `p${i}@example.com`));
    }
    for (let i = 0; i < 5; i++) expect((await call(anaC, 'invite_to_household', { connection_id: ids[i]! })).isError, `invite ${i}`).toBe(false);
    expect((await call(anaC, 'invite_to_household', { connection_id: ids[5]! })).text).toContain('up to 6');
  });

  it('the portion is bounded, shown to the others, and nothing else of a member is', async () => {
    await join();
    await call(boC, 'update_profile', { diet: { allergies: ['peanut'] }, weight_kg: 77 });
    await call(boC, 'set_goals', { kcal: 1800 });
    expect((await call(boC, 'set_household_portion', { portion: 5 })).isError).toBe(true);
    await call(boC, 'set_household_portion', { portion: 0.5 });
    const seenByAna = await call(anaC, 'list_household');
    expect((seenByAna.data as unknown as { household: HouseholdInfo }).household.members[1]).toMatchObject({ email: 'bo@example.com', portion: 0.5, you: false });
    expect(Object.keys((seenByAna.data as unknown as { household: HouseholdInfo }).household.members[1]!).sort()).toEqual(['email', 'nickname', 'portion', 'you']); // nothing else of a member
    expect(JSON.stringify(seenByAna.data) + seenByAna.text).not.toMatch(/peanut|\b77\b|\b1800\b/);
  });

  it('leaving takes the household away when the last one leaves, and leaves each person\'s own copy', async () => {
    await join();
    await shared(anaC);
    await call(boC, 'use_household_plan', { week_start: week });
    expect((await call(boC, 'leave_household')).isError).toBe(false);
    expect((await household(boC)).household).toBeNull();
    expect((await household(anaC)).household!.members).toHaveLength(1);
    expect(await meals(boC)).toHaveLength(2); // Bo's copy stays, no longer following
    await call(anaC, 'leave_household');
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM households').first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM household_plans').first<{ n: number }>())!.n).toBe(0);
    expect(await meals(anaC)).toHaveLength(2);
    expect((await call(anaC, 'leave_household')).isError).toBe(true);
  });
});

describe('the shared plan', () => {
  it('is saved for the household, and the saver\'s own week follows it at their portion', async () => {
    await join();
    const r = await shared(anaC);
    expect(r.isError).toBe(false);
    expect(r.data).toMatchObject({ saved: { household: true, yourPlanFollowsIt: true } });
    expect(await meals(anaC)).toMatchObject([{ grams: 80 }, { grams: 200 }]);
    expect((await household(boC)).household!.weeks).toMatchObject([{ weekStart: week, items: 2, savedBy: 'ana@example.com' }]);
    expect(await meals(boC)).toEqual([]); // Bo's own week is untouched until Bo asks
  });

  it('is refused for someone who is not in a household, and not readable by them', async () => {
    await join();
    await shared(anaC);
    expect((await shared(cyC)).isError).toBe(true);
    expect((await call(cyC, 'use_household_plan', { week_start: week })).isError).toBe(true);
    expect((await call(cyC, 'show_grocery_list', { week_start: week, household: true })).isError).toBe(true);
    expect((await household(cyC)).household).toBeNull();
    expect(await meals(cyC)).toEqual([]);
  });

  it('gives each member their own portion, checked against their own goals', async () => {
    await join();
    await call(boC, 'set_household_portion', { portion: 0.5 });
    await call(boC, 'set_goals', { kcal: 900, protein_g: 40 });
    await shared(anaC);
    expect((await call(boC, 'use_household_plan', { week_start: week })).isError).toBe(false);
    expect(await meals(boC)).toMatchObject([{ grams: 40 }, { grams: 100 }]);
    expect(await meals(anaC)).toMatchObject([{ grams: 80 }, { grams: 200 }]);
    const view = (await call(boC, 'show_meal_plan', { week_start: week })).data as unknown as { mealPlan: MealPlanView };
    expect(view.mealPlan.goals.kcal).toBe(900);
    expect(view.mealPlan.days[1]!.meals[0]).toMatchObject({ kcal: 209 }); // 100 g of rye: half of 200 g
  });

  it('warns each person about their own allergies only, and never says whose', async () => {
    await join();
    await call(boC, 'update_profile', { diet: { allergies: ['rye'] } });
    const saved = await shared(anaC); // Ana is not allergic: nothing is said to her
    expect(JSON.stringify(saved.data)).not.toMatch(/allerg/i);
    expect(saved.text).not.toMatch(/rye/i);
    await call(boC, 'use_household_plan', { week_start: week });
    expect(JSON.stringify((await call(boC, 'get_meal_plan', { week_start: week })).data)).toMatch(/allergy/i);
    expect(JSON.stringify((await call(anaC, 'get_meal_plan', { week_start: week })).data)).not.toMatch(/allergy/i);
    const forBo = await shared(boC, [{ day: week, slot: 'lunch', food_id: RYE, grams: 100 }]);
    expect(JSON.stringify(forBo.data)).toMatch(/allergy/i); // the one who is allergic is told, about their own portion
  });

  it('a change by one member reaches the others\' copies, scaled, keeping what they ate', async () => {
    await join();
    await call(boC, 'set_household_portion', { portion: 2 });
    await shared(anaC);
    await call(boC, 'use_household_plan', { week_start: week });
    await call(boC, 'log_planned_meal', { day: week }); // Bo ate Monday's breakfast
    expect((await meals(boC))[0]).toMatchObject({ logged: true, grams: 160 });
    await shared(anaC, [{ day: week, slot: 'breakfast', food_id: OATS, grams: 100 }, { day: addDays(week, 2), slot: 'dinner', food_id: RYE, grams: 100 }]);
    const after = await meals(boC);
    expect(after).toMatchObject([{ grams: 200, logged: true }, { grams: 200 }]); // 100 g x 2, still marked eaten; the new dinner at Bo's portion
    expect(after[1]!.logged).toBeFalsy();
    expect((await call(boC, 'get_food_log', { day: week })).data).toMatchObject({ entries: [{ grams: 160 }] }); // what was logged stays as it was
    await call(boC, 'set_household_portion', { portion: 1 });
    expect(await meals(boC)).toMatchObject([{ grams: 100, logged: true }, { grams: 100 }]);
  });

  it('what one member eats is not marked for the others', async () => {
    await join();
    await shared(anaC);
    await call(boC, 'use_household_plan', { week_start: week });
    await call(anaC, 'log_planned_meal', { day: week });
    expect((await meals(anaC))[0]).toMatchObject({ logged: true });
    expect((await meals(boC))[0]!.logged).toBeFalsy();
  });

  it('stops following once the person changes their copy, and is not overwritten by the household after that', async () => {
    await join();
    await shared(anaC);
    await call(boC, 'use_household_plan', { week_start: week });
    const view = ((await call(boC, 'show_meal_plan', { week_start: week })).data as unknown as { mealPlan: MealPlanView }).mealPlan;
    await call(boC, 'plan_copy_meal', { week_start: week, version: view.version, index: 1, copy_from: 0 });
    await shared(anaC, [{ day: week, slot: 'dinner', food_id: RYE, grams: 100 }]);
    expect((await meals(boC)).map((m) => m.grams)).toEqual([80, 80]); // Bo's own now
    expect((await meals(anaC)).map((m) => m.grams)).toEqual([100]);
  });

  it('eating from a copy that follows keeps it following; saving an own plan over it makes it theirs', async () => {
    await join();
    await shared(anaC);
    await call(boC, 'use_household_plan', { week_start: week });
    await call(boC, 'log_planned_meal', { day: week });
    await shared(anaC, [{ day: week, slot: 'breakfast', food_id: OATS, grams: 40 }]);
    expect((await meals(boC)).map((m) => m.grams)).toEqual([40]); // still following after the tap
    await call(boC, 'save_meal_plan', { week_start: week, items: [{ day: week, slot: 'lunch', food_id: RYE, grams: 50 }] });
    await shared(anaC, [{ day: week, slot: 'breakfast', food_id: OATS, grams: 60 }]);
    expect((await meals(boC)).map((m) => m.grams)).toEqual([50]);
  });

  it('a member with a plan of their own for the week keeps it until they ask to use the shared one', async () => {
    await join();
    await call(boC, 'save_meal_plan', { week_start: week, items: [{ day: week, slot: 'lunch', food_id: RYE, grams: 50 }] });
    const r = await shared(anaC);
    expect(r.data).toMatchObject({ saved: { yourPlanFollowsIt: true } }); // Ana had none
    expect((await meals(boC)).map((m) => m.grams)).toEqual([50]);
    const own = await call(boC, 'save_meal_plan', { week_start: week, items: [{ day: week, slot: 'dinner', food_id: RYE, grams: 70 }], household: true });
    expect(own.data).toMatchObject({ saved: { yourPlanFollowsIt: false }, note: expect.stringContaining('use_household_plan') }); // Bo's own plan kept
    expect((await meals(boC)).map((m) => m.grams)).toEqual([50]);
    await call(boC, 'use_household_plan', { week_start: week });
    expect((await meals(boC)).map((m) => m.grams)).toEqual([70]);
  });

  it('cleans the names a member writes, and carries nothing that points to their own things', async () => {
    await join();
    await call(anaC, 'save_recipe', { name: '<b>Evil</b> https://evil.example/x stew', servings: 2, ingredients: [{ food_id: OATS, grams: 200 }] });
    await shared(anaC, [{ day: week, slot: 'dinner', recipe_name: '<b>Evil</b> https://evil.example/x stew', servings: 1 }]);
    await call(boC, 'use_household_plan', { week_start: week });
    const m = (await meals(boC))[0]!;
    expect(m.name).toBe('Evil stew');
    const raw = await env.DB.prepare('SELECT items FROM meal_plans WHERE user_id = ?').bind(bo.id).first<{ items: string }>();
    expect(raw!.items).not.toMatch(/recipeId|evil\.example|<b>/);
  });
});

describe('the plan view', () => {
  const planView = async (c: Client) => ((await call(c, 'show_meal_plan', { week_start: week })).data as unknown as { mealPlan: MealPlanView }).mealPlan;

  it('shows each member\'s portion side by side for a week that follows the household, and only names and portions', async () => {
    await join();
    await call(boC, 'set_household_portion', { portion: 0.5 });
    await call(boC, 'update_profile', { diet: { allergies: ['peanut'] } });
    await call(boC, 'set_goals', { kcal: 1800 });
    await shared(anaC);
    const v = await planView(anaC);
    expect(v.household!.members).toEqual([{ label: 'ana@example.com', portion: 1, you: true }, { label: 'bo@example.com', portion: 0.5, you: false }]);
    expect(v.days[1]!.meals[0]).toMatchObject({ kcal: 418, memberKcal: [418, 209] }); // 200 g of rye bread for Ana, half for Bo
    expect(JSON.stringify(v)).not.toMatch(/peanut|1800/);
    await call(boC, 'use_household_plan', { week_start: week });
    const b = await planView(boC);
    expect(b.household!.members.map((m) => m.you)).toEqual([false, true]);
    expect(b.days[1]!.meals[0]).toMatchObject({ kcal: 209, memberKcal: [418, 209] }); // the same numbers from Bo's side
  });

  it('is plain for a week of one\'s own, and once the copy is changed by hand', async () => {
    await join();
    await call(anaC, 'save_meal_plan', { week_start: week, items: items() });
    expect((await planView(anaC)).household).toBeUndefined();
    await shared(anaC);
    expect((await planView(anaC)).household).toBeUndefined(); // her own plan was kept
    await call(anaC, 'use_household_plan', { week_start: week });
    const v = await planView(anaC);
    expect(v.household).toBeDefined();
    await call(anaC, 'plan_copy_meal', { week_start: week, version: v.version, index: 1, copy_from: 0 });
    expect((await planView(anaC)).household).toBeUndefined();
  });
});

describe('the shared grocery list', () => {
  const list = async (c: Client) => ((await call(c, 'show_grocery_list', { week_start: week, household: true })).data as unknown as { shopping: ShoppingData }).shopping;

  it('is for everyone\'s portions together, from the shared plan, with ticks the whole household sees', async () => {
    await join();
    await call(boC, 'set_household_portion', { portion: 0.5 });
    await shared(anaC);
    const s = await list(boC);
    expect(s).toMatchObject({ household: true, people: 1.5 });
    const oats = s.sections.flatMap((x) => x.items).find((i) => /oat/i.test(i.name))!;
    expect(oats.checked).toBe(false);
    expect((await call(boC, 'set_grocery_checked', { week_start: week, key: oats.key, checked: true, household: true })).isError).toBe(false);
    expect((await list(anaC)).sections.flatMap((x) => x.items).find((i) => i.key === oats.key)!.checked).toBe(true);
    expect((await call(anaC, 'show_grocery_list', { week_start: week })).data).toMatchObject({ shopping: { sections: expect.any(Array) } });
  });

  it('keeps the personal list and its ticks separate, and a non-member cannot tick the household\'s', async () => {
    await join();
    await shared(anaC);
    const personal = ((await call(anaC, 'show_grocery_list', { week_start: week })).data as unknown as { shopping: ShoppingData }).shopping;
    const key = personal.sections[0]!.items[0]!.key;
    await call(anaC, 'set_grocery_checked', { week_start: week, key, checked: true });
    expect((await list(boC)).sections.flatMap((x) => x.items).every((i) => !i.checked)).toBe(true);
    expect((await call(cyC, 'set_grocery_checked', { week_start: week, key, checked: true, household: true })).isError).toBe(true);
  });
});

describe('who can see what, and when an account goes', () => {
  it('is in the export of a member (the plan, portions and ticks, nothing of the others\' own data) and gone with the account', async () => {
    await join();
    await shared(anaC);
    await call(boC, 'update_profile', { diet: { allergies: ['peanut'] } });
    const exp = (await call(anaC, 'export_my_data')).data as { household: { members: unknown[]; plans: unknown[]; yourPortion: number } };
    expect(exp.household).toMatchObject({ yourPortion: 1, members: [{}, {}], plans: [{}] });
    expect(JSON.stringify(exp.household)).not.toMatch(/peanut/);
    await deleteUser(env.DB, ana);
    expect((await household(boC)).household!.members).toHaveLength(1); // Bo stays, the household stays
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM household_plans').first<{ n: number }>())!.n).toBe(1);
    await deleteUser(env.DB, bo);
    for (const t of ['households', 'household_members', 'household_plans', 'household_invites', 'household_ticks']) expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n, t).toBe(0);
  });

  it('the household tools carry the right hints, and what changes or removes something asks first', async () => {
    const tools = (await anaC.listTools()).tools;
    expect(tools.find((t) => t.name === 'list_household')?.annotations).toMatchObject({ readOnlyHint: true });
    for (const name of ['leave_household', 'set_household_portion', 'use_household_plan', 'decline_household_invite']) expect(tools.find((t) => t.name === name)?.annotations, name).toMatchObject({ destructiveHint: true });
    for (const name of ['invite_to_household', 'accept_household_invite']) expect(tools.find((t) => t.name === name)?.annotations, name).toMatchObject({ destructiveHint: false });
  });
});
