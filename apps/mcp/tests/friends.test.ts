// Friends (B foundation): connecting by email, accepting, what is shared (nothing by default), who may see what, and removal, export and delete.
import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { canView, MAX_PENDING_SENT, type FriendList } from '../src/data/friends';
import { deleteUser, inviteUser, type User } from '../src/data/users';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';

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

const list = async (c: Client) => (await call(c, 'list_friends')).data as unknown as FriendList;
/** Ana asks Bo and Bo accepts: returns the connection id. */
async function connect(from: Client, to: Client, toEmail: string) {
  await call(from, 'request_friend', { email: toEmail });
  const id = (await list(to)).incoming[0]!.connectionId;
  expect((await call(to, 'accept_friend', { connection_id: id })).isError).toBe(false);
  return id;
}
const rows = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

describe('requesting', () => {
  it('answers the same for a member and for an address with no account, and only a member gets a request', async () => {
    const member = await call(anaC, 'request_friend', { email: 'bo@example.com' });
    const stranger = await call(anaC, 'request_friend', { email: 'nobody@example.com' });
    expect(member.isError).toBe(false);
    expect(member.data).toEqual(stranger.data);
    expect(await rows('connections')).toBe(1);
    expect((await list(boC)).incoming).toMatchObject([{ email: 'ana@example.com', sentOn: new Date().toISOString().slice(0, 10) }]);
    expect((await list(anaC)).outgoing).toMatchObject([{ email: 'bo@example.com' }]);
  });

  it('is not made to someone who has not signed in yet, to oneself, or to a bad address', async () => {
    await inviteUser(env.DB, 'dee@example.com'); // invited, never signed in
    await call(anaC, 'request_friend', { email: 'dee@example.com' });
    expect(await rows('connections')).toBe(0);
    expect((await call(anaC, 'request_friend', { email: 'Ana@Example.com' })).text).toContain('own address');
    expect((await call(anaC, 'request_friend', { email: 'not an address' })).isError).toBe(true);
    expect(await rows('connections')).toBe(0);
  });

  it('asking someone who already asked back connects the two, and asking twice changes nothing', async () => {
    await call(anaC, 'request_friend', { email: 'bo@example.com' });
    await call(anaC, 'request_friend', { email: 'bo@example.com' });
    expect(await rows('connections')).toBe(1);
    await call(boC, 'request_friend', { email: 'ana@example.com' });
    expect(await rows('connections')).toBe(1);
    expect((await list(anaC)).friends).toMatchObject([{ email: 'bo@example.com', iShare: [], theyShare: [] }]);
    expect((await list(boC)).friends).toMatchObject([{ email: 'ana@example.com' }]);
  });

  it(`allows at most ${MAX_PENDING_SENT} waiting requests`, async () => {
    for (let i = 0; i < MAX_PENDING_SENT; i++) await signedInUser(env, `friend${i}@example.com`);
    for (let i = 0; i < MAX_PENDING_SENT; i++) expect((await call(anaC, 'request_friend', { email: `friend${i}@example.com` })).isError).toBe(false);
    const eleventh = await call(anaC, 'request_friend', { email: 'cy@example.com' });
    expect(eleventh.isError).toBe(true);
    expect(eleventh.text).toContain('decline_friend');
  });
});

describe('answering', () => {
  it('accepting makes friends who share nothing', async () => {
    await connect(anaC, boC, 'bo@example.com');
    for (const c of [anaC, boC]) expect((await list(c)).friends).toHaveLength(1);
    expect((await list(anaC)).friends[0]).toMatchObject({ iShare: [], theyShare: [] });
    expect((await list(boC)).incoming).toEqual([]);
  });

  it('only the person asked can accept; the sender can take it back; the person asked can decline', async () => {
    await call(anaC, 'request_friend', { email: 'bo@example.com' });
    const id = (await list(anaC)).outgoing[0]!.connectionId;
    expect((await call(anaC, 'accept_friend', { connection_id: id })).isError).toBe(true); // the sender cannot accept their own request
    expect((await call(cyC, 'accept_friend', { connection_id: id })).isError).toBe(true);
    expect((await call(cyC, 'decline_friend', { connection_id: id })).isError).toBe(true);
    expect(await rows('connections')).toBe(1);
    expect((await call(anaC, 'decline_friend', { connection_id: id })).data).toEqual({ declined: true });
    expect(await rows('connections')).toBe(0);
    await call(anaC, 'request_friend', { email: 'bo@example.com' });
    expect((await call(boC, 'decline_friend', { connection_id: (await list(boC)).incoming[0]!.connectionId })).isError).toBe(false);
    expect(await rows('connections')).toBe(0);
  });

  it('decline does not end an accepted friendship', async () => {
    const id = await connect(anaC, boC, 'bo@example.com');
    expect((await call(boC, 'decline_friend', { connection_id: id })).isError).toBe(true);
    expect((await list(boC)).friends).toHaveLength(1);
  });
});

describe('sharing: no share means no access', () => {
  it('shares one kind with one friend in one direction, and only between friends', async () => {
    // Before anything: nobody can see anything.
    for (const cat of ['workouts', 'consistency', 'templates', 'body'] as const) expect(await canView(env.DB, bo.id, ana.id, cat)).toBe(false);
    await call(anaC, 'request_friend', { email: 'bo@example.com' }); // pending is not a connection
    const pendingId = (await list(anaC)).outgoing[0]!.connectionId;
    expect((await call(anaC, 'set_sharing', { connection_id: pendingId, category: 'workouts', share: true })).isError).toBe(true);
    expect(await canView(env.DB, bo.id, ana.id, 'workouts')).toBe(false);

    // Bo accepts the request that was waiting: now they are friends.
    expect((await call(boC, 'accept_friend', { connection_id: pendingId })).isError).toBe(false);
    const friend = (await list(anaC)).friends[0]!;

    expect((await call(anaC, 'set_sharing', { connection_id: friend.connectionId, category: 'workouts', share: true })).data).toEqual({ category: 'workouts', sharedWithThisFriend: true });
    expect(await canView(env.DB, bo.id, ana.id, 'workouts')).toBe(true); // Bo can see Ana's workouts
    expect(await canView(env.DB, bo.id, ana.id, 'consistency')).toBe(false); // not another kind
    expect(await canView(env.DB, ana.id, bo.id, 'workouts')).toBe(false); // not the other way round
    expect(await canView(env.DB, cy.id, ana.id, 'workouts')).toBe(false); // not a third person
    expect(await canView(env.DB, ana.id, ana.id, 'workouts')).toBe(false); // a person's own data is not read through a share
    expect((await list(anaC)).friends[0]).toMatchObject({ iShare: ['workouts'], theyShare: [] });
    expect((await list(boC)).friends[0]).toMatchObject({ iShare: [], theyShare: ['workouts'] });

    await call(anaC, 'set_sharing', { connection_id: friend.connectionId, category: 'workouts', share: false });
    expect(await canView(env.DB, bo.id, ana.id, 'workouts')).toBe(false);
  });

  it('a third person cannot use a connection that is not theirs', async () => {
    const id = await connect(anaC, boC, 'bo@example.com');
    await call(anaC, 'set_sharing', { connection_id: id, category: 'templates', share: true });
    expect((await call(cyC, 'set_sharing', { connection_id: id, category: 'body', share: true })).isError).toBe(true);
    expect((await call(cyC, 'remove_friend', { connection_id: id })).isError).toBe(true);
    expect(await canView(env.DB, cy.id, ana.id, 'templates')).toBe(false);
    expect(await canView(env.DB, cy.id, bo.id, 'body')).toBe(false);
    expect(await rows('shares')).toBe(1);
    expect((await list(cyC)).friends).toEqual([]);
  });

  it('records every grant and withdrawal, once each', async () => {
    const id = await connect(anaC, boC, 'bo@example.com');
    await call(anaC, 'set_sharing', { connection_id: id, category: 'body', share: true });
    await call(anaC, 'set_sharing', { connection_id: id, category: 'body', share: true }); // already shared: not a new grant
    await call(anaC, 'set_sharing', { connection_id: id, category: 'body', share: false });
    await call(anaC, 'set_sharing', { connection_id: id, category: 'body', share: false });
    const log = (await env.DB.prepare('SELECT category, action FROM share_consents WHERE owner_id = ? ORDER BY id').bind(ana.id).all<{ category: string; action: string }>()).results;
    expect(log).toEqual([{ category: 'body', action: 'granted' }, { category: 'body', action: 'withdrawn' }]);
  });
});

describe('removing', () => {
  it('ends the friendship for both and stops everything shared either way, recording the withdrawals', async () => {
    const id = await connect(anaC, boC, 'bo@example.com');
    await call(anaC, 'set_sharing', { connection_id: id, category: 'workouts', share: true });
    await call(boC, 'set_sharing', { connection_id: id, category: 'consistency', share: true });
    expect((await call(boC, 'remove_friend', { connection_id: id })).data).toEqual({ removed: true });
    expect(await rows('connections')).toBe(0);
    expect(await rows('shares')).toBe(0);
    expect(await canView(env.DB, bo.id, ana.id, 'workouts')).toBe(false);
    expect(await canView(env.DB, ana.id, bo.id, 'consistency')).toBe(false);
    const withdrawn = (await env.DB.prepare("SELECT COUNT(*) AS n FROM share_consents WHERE action = 'withdrawn'").first<{ n: number }>())!.n;
    expect(withdrawn).toBe(2);
    // Starting again starts from nothing shared.
    await connect(anaC, boC, 'bo@example.com');
    expect((await list(boC)).friends[0]).toMatchObject({ theyShare: [] });
  });
});

describe('export and delete', () => {
  it('exports connections, what is shared and the consent record by email, and not ids of other people', async () => {
    const id = await connect(anaC, boC, 'bo@example.com');
    await call(anaC, 'set_sharing', { connection_id: id, category: 'workouts', share: true });
    await call(boC, 'set_sharing', { connection_id: id, category: 'templates', share: true });
    const out = (await call(anaC, 'export_my_data')).data as { friends: { connections: Record<string, unknown>[]; sharing: Record<string, unknown>[]; consents: Record<string, unknown>[] } };
    expect(out.friends.connections).toMatchObject([{ with: 'bo@example.com', status: 'accepted', sentByMe: true }]);
    expect(out.friends.sharing).toMatchObject([{ with: 'bo@example.com', direction: 'iShare', category: 'workouts' }, { with: 'bo@example.com', direction: 'theyShare', category: 'templates' }]);
    expect(out.friends.consents).toMatchObject([{ with: 'bo@example.com', category: 'workouts', action: 'granted' }]);
    expect(JSON.stringify(out.friends)).not.toContain(bo.id);
  });

  it('deleting an account removes its connections, shares and consent records from both sides', async () => {
    const id = await connect(anaC, boC, 'bo@example.com');
    await call(anaC, 'set_sharing', { connection_id: id, category: 'workouts', share: true });
    await call(boC, 'set_sharing', { connection_id: id, category: 'consistency', share: true });
    const idCy = await connect(cyC, boC, 'bo@example.com');
    await call(cyC, 'set_sharing', { connection_id: idCy, category: 'body', share: true });
    await deleteUser(env.DB, ana);
    expect((await list(boC)).friends).toMatchObject([{ email: 'cy@example.com', theyShare: ['body'] }]); // Bo keeps Cy, loses Ana
    expect(await rows('connections')).toBe(1);
    expect(await rows('shares')).toBe(1);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM share_consents WHERE owner_id = ? OR viewer_id = ?').bind(ana.id, ana.id).first<{ n: number }>())!.n).toBe(0);
  });
});
