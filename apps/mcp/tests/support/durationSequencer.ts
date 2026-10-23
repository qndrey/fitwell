// Splits the test files over CI runners (`vitest run --shard=i/n`) by how long they take instead of by count. Vitest's own split
// orders the files by a hash of their path and cuts the list into equal counts, so one runner can get several of the browser files
// that take two to three minutes each while another gets only quick ones.
import { relative } from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/** Seconds per file, measured on 2026-10-23 with 3 workers. A file not listed counts as DEFAULT; refresh when a file grows a lot. */
const SECONDS: Record<string, number> = {
  'tests/workout-cards-logging.test.ts': 215,
  'tests/workout-cards-moves.test.ts': 177,
  'tests/workout-cards-secondary.test.ts': 153,
  'tests/workout-cards-dock.test.ts': 139,
  'tests/workout-cards-finish.test.ts': 129,
  'tests/workout-cards-pager.test.ts': 94,
  'tests/dashboard-cards.test.ts': 92,
  'tests/review-cards.test.ts': 83,
  'tests/workout-cards-record-cue.test.ts': 36,
  'tests/workout-cards-effort.test.ts': 28,
  'tests/workout-cards-rest-resume.test.ts': 18,
  'tests/workout-cards-warmups.test.ts': 15,
  'tests/shopping-undo.test.ts': 11,
  'tests/muscles-compare.test.ts': 11,
  'tests/cards-shell-dashboard.test.ts': 11,
};
const DEFAULT = 3;

export class DurationSequencer extends BaseSequencer {
  /** Longest file first, each onto the runner with the least work so far. Every runner computes the same split from the same list. */
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    const name = (f: TestSpecification) => relative(this.ctx.config.root, f.moduleId).split('\\').join('/');
    const weight = (f: TestSpecification) => SECONDS[name(f)] ?? DEFAULT;
    const ordered = [...files].sort((a, b) => weight(b) - weight(a) || (name(a) < name(b) ? -1 : 1));
    const load: number[] = Array.from({ length: count }, () => 0);
    const mine: TestSpecification[] = [];
    for (const f of ordered) {
      const lightest = load.indexOf(Math.min(...load));
      load[lightest]! += weight(f);
      if (lightest === index - 1) mine.push(f);
    }
    return mine;
  }
}
