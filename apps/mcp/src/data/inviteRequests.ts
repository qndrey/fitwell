// Requests for an invitation (the public form at /request-access), waiting for the owner to approve or decline.
// Only an address in this shape is ever stored, so what the owner reads back is never free text from a stranger.
import { normalizeEmail } from './users';

export const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
export const PLATFORMS = ['desktop', 'web', 'iphone'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const KEEP_REQUESTS_MS = 30 * 86_400_000;

export interface InviteRequest {
  id: string;
  email: string;
  platform: Platform | null;
  created_at: number;
}

/** Stores a request; an address that already has one is left as it is. True when it is a new request. */
export async function addInviteRequest(db: D1Database, r: { email: string; platform: Platform | null; ip: string; now: number }): Promise<boolean> {
  const [, insert] = await db.batch([
    db.prepare('DELETE FROM invite_requests WHERE created_at < ?').bind(r.now - KEEP_REQUESTS_MS),
    db.prepare('INSERT OR IGNORE INTO invite_requests (id, email, platform, ip, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), normalizeEmail(r.email), r.platform, r.ip, r.now),
  ]);
  return (insert?.meta.changes ?? 0) > 0;
}

export async function listInviteRequests(db: D1Database): Promise<InviteRequest[]> {
  const { results } = await db.prepare('SELECT id, email, platform, created_at FROM invite_requests ORDER BY created_at').all<InviteRequest>();
  return results;
}

export function findInviteRequest(db: D1Database, email: string): Promise<InviteRequest | null> {
  return db.prepare('SELECT id, email, platform, created_at FROM invite_requests WHERE email = ?').bind(normalizeEmail(email)).first<InviteRequest>();
}

export async function deleteInviteRequest(db: D1Database, email: string): Promise<void> {
  await db.prepare('DELETE FROM invite_requests WHERE email = ?').bind(normalizeEmail(email)).run();
}

export async function countInviteRequests(db: D1Database): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS n FROM invite_requests').first<number>('n')) ?? 0;
}

export async function countInviteRequestsFromIp(db: D1Database, ip: string, since: number): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS n FROM invite_requests WHERE ip = ? AND created_at > ?').bind(ip, since).first<number>('n')) ?? 0;
}
