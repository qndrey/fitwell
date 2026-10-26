// Account-level queries (not scoped to one person): invites, sign-in bookkeeping, deletion.
// Everything about a person's own data goes through UserData instead.

export interface User {
  id: string;
  email: string;
  name: string | null;
  status: 'invited' | 'active';
  created_at: number;
  consented_at: number | null;
  last_login_at: number | null;
  /** The member who invited this person (invite_friend); null for people the owner added or approved. */
  invited_by: string | null;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function findUserByEmail(db: D1Database, email: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(normalizeEmail(email)).first<User>();
}

export function findUser(db: D1Database, id: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
}

/** Adds an invited address (or returns the existing person). */
export async function inviteUser(db: D1Database, email: string, name?: string, now = Date.now()): Promise<User> {
  const existing = await findUserByEmail(db, email);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO users (id, email, name, status, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, normalizeEmail(email), name ?? null, 'invited', now).run();
  return (await findUser(db, id))!;
}

/** After a successful sign-in with the consent box ticked. Creates the profile row on first sign-in. */
export async function recordLogin(db: D1Database, userId: string, now = Date.now()): Promise<void> {
  await db.batch([
    db.prepare("UPDATE users SET status = 'active', last_login_at = ?, consented_at = COALESCE(consented_at, ?) WHERE id = ?").bind(now, now, userId),
    db.prepare('INSERT OR IGNORE INTO profiles (user_id, updated_at) VALUES (?, ?)').bind(userId, now),
  ]);
}

/** Erases a person and everything they stored (rows cascade from users). Sign-in attempts go too. */
export async function deleteUser(db: D1Database, user: Pick<User, 'id' | 'email'>): Promise<void> {
  await db.batch([
    // Invitations this person sent that nobody used go with them; friends who joined stay (their invited_by is cleared).
    db.prepare("DELETE FROM users WHERE invited_by = ? AND status = 'invited'").bind(user.id),
    db.prepare('DELETE FROM member_invites WHERE inviter_id = ?').bind(user.id),
    // Off every inviter's list; their count stays.
    db.prepare('UPDATE member_invites SET email = NULL WHERE email = ?').bind(normalizeEmail(user.email)),
    db.prepare('DELETE FROM food_entries WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM meal_plans WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM recipes WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM import_links WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM weights WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM measurements WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM daily_metrics WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM grocery_ticks WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM review_notes WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM achievements WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM workouts WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM workout_templates WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM custom_foods WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM goals WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM profiles WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM login_requests WHERE email = ?').bind(normalizeEmail(user.email)),
    db.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
}
