// Streak milestones and the goal weight reached. Like the other data classes, every query is bound to the signed-in user's id.
import type { AchievementKind } from '../analytics/celebrationTypes';

export type { AchievementKind };

export interface Achievement {
  kind: AchievementKind;
  threshold: number;
  /** The local day it was reached. */
  achievedAt: string;
  /** When the celebration view showed it; null until then. */
  celebratedAt: number | null;
}

type Row = Record<string, unknown>;
const toAchievement = (r: Row): Achievement => ({ kind: r.kind as AchievementKind, threshold: r.threshold as number, achievedAt: r.achieved_at as string, celebratedAt: (r.celebrated_at as number | null) ?? null });

export class AchievementsData {
  constructor(
    private readonly db: D1Database,
    readonly userId: string,
  ) {}

  /** Records what was reached; one already recorded keeps its first day and its celebration. Returns the ones that were new. */
  async record(found: Pick<Achievement, 'kind' | 'threshold' | 'achievedAt'>[]): Promise<Pick<Achievement, 'kind' | 'threshold' | 'achievedAt'>[]> {
    if (found.length === 0) return [];
    const results = await this.db.batch(
      found.map((a) => this.db.prepare('INSERT OR IGNORE INTO achievements (user_id, kind, threshold, achieved_at) VALUES (?, ?, ?, ?)').bind(this.userId, a.kind, a.threshold, a.achievedAt)),
    );
    return found.filter((_, i) => results[i]!.meta.changes > 0);
  }

  /** Marks every achievement not yet shown as shown at `at`; each is celebrated once, whether or not a view was drawn for it. */
  async markCelebrated(at: number): Promise<void> {
    await this.db.prepare('UPDATE achievements SET celebrated_at = ? WHERE user_id = ? AND celebrated_at IS NULL').bind(at, this.userId).run();
  }

  async list(): Promise<Achievement[]> {
    const { results } = await this.db.prepare('SELECT kind, threshold, achieved_at, celebrated_at FROM achievements WHERE user_id = ? ORDER BY achieved_at, kind, threshold').bind(this.userId).all<Row>();
    return results.map(toAchievement);
  }

  async exportAll() {
    return { achievements: await this.list() };
  }
}
