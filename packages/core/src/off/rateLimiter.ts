/**
 * Politeness for Open Food Facts (search is limited to 10 req/min/IP): one request at a time,
 * at least `minGapMs` apart, at most `perMinute` per rolling minute, interactive requests
 * ahead of background ones, and a global pause when the server says "slow down".
 */
export interface LimiterDeps {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export interface LimiterOptions {
  minGapMs: number;
  perMinute: number;
}

export type Priority = 'interactive' | 'background';

interface Job<T> {
  run: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
  priority: Priority;
}

export class RateLimiter {
  private queue: Job<unknown>[] = [];
  private starts: number[] = [];
  private pausedUntil = 0;
  private lastStart = -Infinity;
  private running = false;

  constructor(
    private readonly deps: LimiterDeps = { now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    private readonly opts: LimiterOptions = { minGapMs: 1500, perMinute: 6 },
  ) {}

  schedule<T>(run: () => Promise<T>, priority: Priority = 'background'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job = { run, resolve, reject, priority } as Job<unknown>;
      // Interactive jobs go ahead of every waiting background job (but behind other interactive ones).
      if (priority === 'interactive') {
        const i = this.queue.findIndex((j) => j.priority === 'background');
        if (i === -1) this.queue.push(job);
        else this.queue.splice(i, 0, job);
      } else this.queue.push(job);
      void this.pump();
    });
  }

  /** Called when the server asked us to back off (429/503). */
  pauseFor(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.deps.now() + ms);
  }

  get pending(): number {
    return this.queue.length;
  }

  private waitTime(): number {
    const now = this.deps.now();
    this.starts = this.starts.filter((t) => now - t < 60_000);
    let wait = Math.max(0, this.pausedUntil - now, this.lastStart + this.opts.minGapMs - now);
    if (this.starts.length >= this.opts.perMinute) wait = Math.max(wait, this.starts[0]! + 60_000 - now);
    return wait;
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const wait = this.waitTime();
        if (wait > 0) {
          await this.deps.sleep(wait);
          continue; // re-evaluate: a pause may have been added, new jobs may have arrived
        }
        const job = this.queue.shift()!;
        this.lastStart = this.deps.now();
        this.starts.push(this.lastStart);
        try {
          job.resolve(await job.run());
        } catch (e) {
          job.reject(e);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
