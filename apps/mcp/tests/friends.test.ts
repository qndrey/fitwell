// Friends (B foundation): connecting by email, accepting, what is shared (nothing by default), who may see what, and removal, export and delete.
import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { canView, MAX_PENDING_SENT, type FriendList } from '../src/data/friends';
import { LOOKUPS_PER_HOUR } from '../src/data/nicknames';
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
  it('cannot tell a member from an address with no account: same answer, same list, nothing but the typed address', async () => {
    const member = await call(anaC, 'request_friend', { email: 'bo@example.com' });
    const stranger = await call(anaC, 'request_friend', { email: 'nobody@example.com' });
    const invited = await inviteUser(env.DB, 'dee@example.com'); // invited, never signed in
    const dee = await call(anaC, 'request_friend', { email: 'dee@example.com' });
    expect(member.isError).toBe(false);
    expect(stranger.data).toEqual(member.data);
    expect(dee.data).toEqual(member.data);
    const outgoing = (await list(anaC)).outgoing;
    expect(outgoing.map((o) => o.email)).toEqual(['bo@example.com', 'nobody@example.com', 'dee@example.com']);
    // Each entry has the same shape and no profile data, whoever it is.
    for (const o of outgoing) expect(Object.keys(o).sort()).toEqual(['connectionId', 'email', 'nickname', 'sentOn']);
    expect(outgoing.every((o) => o.nickname === null)).toBe(true);
    expect(JSON.stringify(outgoing)).not.toContain(bo.id);
    expect(JSON.stringify(outgoing)).not.toContain(invited.id);
    // The person asked sees it, with the address of the one who asked (they have no nickname).
    expect((await list(boC)).incoming).toMatchObject([{ email: 'ana@example.com', sentOn: new Date().toISOString().slice(0, 10) }]);
  });

  it('the limits do not depend on who is asked', async () => {
    for (let i = 0; i < MAX_PENDING_SENT; i++) await call(anaC, 'request_friend', { email: `${i % 2 ? 'ghost' : 'friend'}${i}@example.com` }); // members and not
    const members = await call(anaC, 'request_friend', { email: 'bo@example.com' });
    const stranger = await call(anaC, 'request_friend', { email: 'nobody@example.com' });
    expect(members).toEqual(stranger);
    expect(members.isError).toBe(true);
  });

  it('a request waits for the person at the address, even if they join later, and is deleted after 30 days', async () => {
    await call(anaC, 'request_friend', { email: 'late@example.com' });
    const late = await signedInUser(env, 'late@example.com');
    const lateC = await connectAs(env, late);
    expect((await list(lateC)).incoming).toMatchObject([{ email: 'ana@example.com' }]);
    await env.DB.prepare('UPDATE connections SET created_at = ?').bind(Date.now() - 31 * 86_400_000).run();
    expect((await list(lateC)).incoming).toEqual([]);
    expect(await rows('connections')).toBe(0);
  });

  it('is not made to oneself or to a bad address', async () => {
    expect((await call(anaC, 'request_friend', { email: 'Ana@Example.com' })).text).toContain('own address');
    expect((await call(anaC, 'request_friend', { email: 'not an address' })).isError).toBe(true);
    expect(await rows('connections')).toBe(0);
  });

  it('asking twice the same way changes nothing; asking back is a request of its own, and answering one clears the other', async () => {
    await call(anaC, 'request_friend', { email: 'bo@example.com' });
    await call(anaC, 'request_friend', { email: 'bo@example.com' });
    expect(await rows('connections')).toBe(1);
    await call(boC, 'request_friend', { email: 'ana@example.com' });
    expect(await rows('connections')).toBe(2); // nothing connects them behind their backs
    expect((await list(anaC)).friends).toEqual([]);
    await call(boC, 'accept_friend', { connection_id: (await list(boC)).incoming[0]!.connectionId });
    expect(await rows('connections')).toBe(1); // Bo's own request to Ana is a leftover and goes
    expect((await list(anaC)).friends).toMatchObject([{ email: 'bo@example.com', iShare: [], theyShare: [] }]);
    expect((await list(boC)).friends).toMatchObject([{ email: 'ana@example.com' }]);
    expect((await list(anaC)).incoming).toEqual([]);
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

  it('a share left over from nowhere is cleared when a friendship starts, and one cannot be written for a connection that is not accepted', async () => {
    await env.DB.prepare("INSERT INTO shares (owner_id, viewer_id, category, granted_at) VALUES (?, ?, 'workouts', 1)").bind(ana.id, bo.id).run();
    expect(await canView(env.DB, bo.id, ana.id, 'workouts')).toBe(false); // no connection: a stray row grants nothing
    await call(anaC, 'request_friend', { email: 'bo@example.com' });
    const pendingId = (await list(anaC)).outgoing[0]!.connectionId;
    expect((await call(anaC, 'set_sharing', { connection_id: pendingId, category: 'body', share: true })).isError).toBe(true);
    await call(boC, 'accept_friend', { connection_id: pendingId });
    expect(await rows('shares')).toBe(0);
    expect((await list(boC)).friends[0]).toMatchObject({ theyShare: [] });
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

describe('a friendship is one row', () => {
  it('asking an existing friend creates a request like any other, which is dropped when answered, and what is shared stays', async () => {
    const id = await connect(anaC, boC, 'bo@example.com');
    await call(anaC, 'set_sharing', { connection_id: id, category: 'workouts', share: true });
    await call(boC, 'request_friend', { email: 'ana@example.com' }); // looks like any request, so it cannot tell a friend from anyone else
    expect(await rows('connections')).toBe(2);
    expect(await canView(env.DB, bo.id, ana.id, 'workouts')).toBe(true);
    expect((await call(anaC, 'accept_friend', { connection_id: (await list(anaC)).incoming[0]!.connectionId })).isError).toBe(false);
    expect(await rows('connections')).toBe(1);
    expect(await rows('shares')).toBe(1);
    expect(await rows('share_consents')).toBe(1); // only the grant
    expect(await canView(env.DB, bo.id, ana.id, 'workouts')).toBe(true);
  });

  it('a request that crossed an accepted friendship is dropped when answered, and shares and consent records are not touched', async () => {
    const id = await connect(anaC, boC, 'bo@example.com');
    await call(anaC, 'set_sharing', { connection_id: id, category: 'workouts', share: true });
    await env.DB.prepare("INSERT INTO connections (id, requester_id, addressee_email, status, created_at) VALUES ('crossed', ?, 'ana@example.com', 'pending', ?)").bind(bo.id, Date.now()).run();
    expect((await call(anaC, 'accept_friend', { connection_id: 'crossed' })).isError).toBe(false);
    expect(await rows('connections')).toBe(1);
    expect((await list(anaC)).friends).toHaveLength(1);
    expect(await canView(env.DB, bo.id, ana.id, 'workouts')).toBe(true);
    expect(await rows('share_consents')).toBe(1); // only the grant: nothing was withdrawn
  });

  it('the database allows one accepted connection per pair, in either direction', async () => {
    await connect(anaC, boC, 'bo@example.com');
    const second = env.DB.prepare("INSERT INTO connections (id, requester_id, addressee_email, addressee_id, status, created_at) VALUES ('dup', ?, 'ana@example.com', ?, 'accepted', 1)").bind(bo.id, ana.id).run();
    await expect(second).rejects.toThrow();
    expect(await rows('connections')).toBe(1);
  });

  it('removing deletes every row between the two, so nothing brings the friendship back', async () => {
    const id = await connect(anaC, boC, 'bo@example.com');
    await env.DB.prepare("INSERT INTO connections (id, requester_id, addressee_email, status, created_at) VALUES ('stray', ?, 'ana@example.com', 'pending', ?)").bind(bo.id, Date.now()).run();
    expect((await call(anaC, 'remove_friend', { connection_id: id })).isError).toBe(false);
    expect(await rows('connections')).toBe(0);
    expect((await list(anaC)).incoming).toEqual([]);
  });

  it('accepting a first request clears a leftover share and records it as withdrawn', async () => {
    await env.DB.prepare("INSERT INTO shares (owner_id, viewer_id, category, granted_at) VALUES (?, ?, 'workouts', 1)").bind(ana.id, bo.id).run();
    await call(anaC, 'request_friend', { email: 'bo@example.com' });
    await call(boC, 'accept_friend', { connection_id: (await list(boC)).incoming[0]!.connectionId });
    expect(await rows('shares')).toBe(0);
    expect((await env.DB.prepare("SELECT action FROM share_consents WHERE owner_id = ?").bind(ana.id).first<{ action: string }>())!.action).toBe('withdrawn');
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

describe('nicknames', () => {
  const nick = async (c: Client, nickname: string | null) => call(c, 'set_nickname', { nickname });
  const mine = async (c: Client) => ((await call(c, 'list_friends')).data as { nickname: string | null }).nickname;

  it('are unique across the system ignoring case, validated, and can be changed or cleared', async () => {
    expect((await nick(anaC, 'Ana_Fit')).data).toEqual({ nickname: 'Ana_Fit' });
    expect(await mine(anaC)).toBe('Ana_Fit');
    const taken = await nick(boC, 'ana_fit'); // another case of the same
    expect(taken.isError).toBe(true);
    expect(taken.text).toContain('taken');
    expect((await nick(anaC, 'ANA_FIT')).isError).toBe(false); // one's own, in another case
    for (const bad of ['ab', 'a'.repeat(21), 'has space', '-leading', 'ana@example.com', 'Fitwell', 'ADMIN', '<b>x</b>']) expect((await nick(boC, bad)).isError, bad).toBe(true);
    expect((await nick(boC, 'bo.lifts')).isError).toBe(false);
    expect((await nick(anaC, null)).data).toEqual({ nickname: null });
    expect((await nick(boC, 'ana_fit')).isError).toBe(false); // free again
    expect(await mine(anaC)).toBeNull();
  });

  it('ask by nickname: needs one of your own, an unknown one is said to be unknown, and the asked sees a nickname and never an email', async () => {
    await nick(boC, 'bo.lifts');
    expect((await call(anaC, 'request_friend', { nickname: 'bo.lifts' })).text).toContain('nickname of their own');
    await nick(anaC, 'ana_fit');
    expect((await call(anaC, 'request_friend', { nickname: 'nobody_here' })).text).toContain('No one has that nickname');
    expect((await call(anaC, 'request_friend', { nickname: 'ANA_FIT' })).text).toContain('own');
    expect((await call(anaC, 'request_friend', { nickname: 'BO.LIFTS' })).isError).toBe(false); // any case
    expect((await call(anaC, 'request_friend', { nickname: 'bo.lifts', email: 'bo@example.com' })).isError).toBe(true); // exactly one
    expect((await call(anaC, 'request_friend', {})).isError).toBe(true);
    // Ana never sees Bo's email; Bo sees Ana's nickname, not her email.
    const outgoing = (await list(anaC)).outgoing;
    expect(outgoing).toMatchObject([{ nickname: 'bo.lifts', email: null }]);
    expect(JSON.stringify(await list(anaC))).not.toContain('bo@example.com');
    expect((await list(boC)).incoming).toMatchObject([{ nickname: 'ana_fit', email: null }]);
    expect(JSON.stringify(await list(boC))).not.toContain('ana@example.com');
    await call(boC, 'accept_friend', { connection_id: (await list(boC)).incoming[0]!.connectionId });
    expect((await list(anaC)).friends).toMatchObject([{ nickname: 'bo.lifts', email: null }]);
    expect((await list(boC)).friends).toMatchObject([{ nickname: 'ana_fit', email: null }]);
    const exported = JSON.stringify((await call(anaC, 'export_my_data')).data.friends);
    expect(exported).toContain('bo.lifts');
    expect(exported).not.toContain('bo@example.com');
  });

  it('asking by email does not reveal a nickname, and a friend asked by email is shown by nickname once they have one', async () => {
    await nick(boC, 'bo.lifts');
    await call(anaC, 'request_friend', { email: 'bo@example.com' });
    expect((await list(anaC)).outgoing).toMatchObject([{ nickname: null, email: 'bo@example.com' }]); // the same as for any address
    await call(boC, 'accept_friend', { connection_id: (await list(boC)).incoming[0]!.connectionId });
    expect((await list(anaC)).friends).toMatchObject([{ nickname: 'bo.lifts', email: null }]);
  });

  it('limits nickname lookups to a few an hour, and the limit does not depend on the nickname', async () => {
    await nick(anaC, 'ana_fit');
    for (let i = 0; i < LOOKUPS_PER_HOUR; i++) expect((await call(anaC, 'request_friend', { nickname: `guess${i}` })).text).toContain('No one has that nickname');
    const over = await call(anaC, 'request_friend', { nickname: 'bo.lifts' });
    expect(over.text).toContain('lot of nickname lookups');
    expect(await rows('connections')).toBe(0);
    await env.DB.prepare('UPDATE nickname_lookups SET at = ?').bind(Date.now() - 2 * 3_600_000).run();
    expect((await call(anaC, 'request_friend', { nickname: 'bo.lifts' })).text).toContain('No one has that nickname'); // Bo has none yet; the window has passed
  });

  it('a person who has not signed in has no nickname to find, and deleting an account frees its nickname and lookups', async () => {
    await nick(anaC, 'ana_fit');
    await call(anaC, 'request_friend', { nickname: 'nobody_here' });
    await deleteUser(env.DB, ana);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM nickname_lookups').first<{ n: number }>())!.n).toBe(0);
    expect((await nick(boC, 'ana_fit')).isError).toBe(false);
  });
});

describe('a nickname cannot be tested against an email', () => {
  const outgoing = async (c: Client) => (await list(c)).outgoing.length;
  beforeEach(async () => {
    await call(anaC, 'set_nickname', { nickname: 'ana_fit' });
    await call(boC, 'set_nickname', { nickname: 'bo.lifts' });
  });

  it('asking by email after asking by nickname looks the same whether or not the address is that person\'s', async () => {
    await call(anaC, 'request_friend', { nickname: 'bo.lifts' });
    expect(await outgoing(anaC)).toBe(1);
    await call(anaC, 'request_friend', { email: 'wrong@example.com' }); // not Bo's
    await call(anaC, 'request_friend', { email: 'bo@example.com' }); // Bo's
    expect(await outgoing(anaC)).toBe(3); // each is a new request: no difference to see
    expect((await list(anaC)).outgoing.map((o) => o.email ?? o.nickname).sort()).toEqual(['bo.lifts', 'bo@example.com', 'wrong@example.com']);
  });

  it('asking by email for someone who asked this person by nickname does not connect them or show a difference', async () => {
    await call(boC, 'request_friend', { nickname: 'ana_fit' }); // Ana sees "bo.lifts", not an email
    await call(anaC, 'request_friend', { email: 'cy@example.com' });
    await call(anaC, 'request_friend', { email: 'bo@example.com' });
    expect((await list(anaC)).friends).toEqual([]);
    expect((await list(anaC)).incoming).toMatchObject([{ nickname: 'bo.lifts', email: null }]);
    expect(await outgoing(anaC)).toBe(2);
  });

  it('declining someone who asked twice answers both', async () => {
    await call(anaC, 'request_friend', { nickname: 'bo.lifts' });
    await call(anaC, 'request_friend', { email: 'bo@example.com' });
    expect((await list(boC)).incoming).toHaveLength(2);
    await call(boC, 'decline_friend', { connection_id: (await list(boC)).incoming[0]!.connectionId });
    expect(await rows('connections')).toBe(0);
  });
});
