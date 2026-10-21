// P3: the dev host serves sample workouts and failure switches (Specs: Verification fixtures).
// The host is a browser module, so it is loaded here with a stubbed DOM, an MCP client that forwards to the real
// in-process server (real tools, real migrations) and a recording AppBridge. The unit under test is not mocked.
import type { Client } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../src/data/users';
import type { PlannedExercise, WorkoutPlan } from '../src/workout/plan';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';

type ToolResult = { isError?: boolean; structuredContent?: Record<string, unknown>; content?: { text?: string }[] };
type Handler = (params: Record<string, unknown>, extra?: unknown) => Promise<ToolResult> | ToolResult;

interface FakeClient {
  callTool: (req: { name: string; arguments?: Record<string, unknown> }) => Promise<ToolResult>;
}
interface FakeBridge {
  oncalltool?: Handler;
  onmessage?: Handler;
  sent: unknown[];
}

const h = vi.hoisted(() => ({
  real: undefined as unknown as {
    callTool: (req: { name: string; arguments?: Record<string, unknown> }) => Promise<ToolResult>;
    readResource: (req: { uri: string }) => Promise<unknown>;
  },
  stubbing: false,
  clients: [] as unknown[],
  bridges: [] as unknown[],
}));

// The stub applies only while the dev host module is being loaded (`h.stubbing`); the support helpers
// (connectAs) build their client from the same module and must get the real one.
vi.mock('@modelcontextprotocol/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@modelcontextprotocol/client')>();
  return {
    ...actual,
    Client: class {
      constructor(...args: ConstructorParameters<typeof actual.Client>) {
        if (!h.stubbing) return new actual.Client(...args) as never;
        h.clients.push(this);
      }
      async connect() {}
      callTool(req: { name: string; arguments?: Record<string, unknown> }) {
        return h.real.callTool(req);
      }
      readResource(req: { uri: string }) {
        return h.real.readResource(req);
      }
    },
    StreamableHTTPClientTransport: class {
      constructor(...args: ConstructorParameters<typeof actual.StreamableHTTPClientTransport>) {
        if (!h.stubbing) return new actual.StreamableHTTPClientTransport(...args) as never;
      }
    },
  };
});

vi.mock('@modelcontextprotocol/ext-apps/app-bridge', () => ({
  PostMessageTransport: class {},
  AppBridge: class {
    oninitialized?: () => void;
    sent: unknown[] = [];
    constructor() {
      h.bridges.push(this);
    }
    async sendToolInput() {}
    async sendToolResult(r: unknown) {
      this.sent.push(r);
    }
    // Like the real AppBridge: connect() installs its own tools/call forwarder, replacing a handler set before it. The host's failure
    // switches therefore only work when they are installed after connect (they were not, and ?fail=log never failed).
    oncalltool?: (params: { name: string; arguments?: Record<string, unknown> }, extra: unknown) => Promise<unknown>;
    async connect() {
      this.oncalltool = async (params) => h.real.callTool(params);
      this.oninitialized?.();
    }
  },
}));

let env: Env;
let user: User;
let real: Client;

beforeEach(async () => {
  env = createTestEnv().env;
  user = await signedInUser(env, 'ana@example.com');
  real = await connectAs(env, user);
  h.real = real as unknown as typeof h.real;
  h.clients.length = 0;
  h.bridges.length = 0;
  vi.resetModules();
});

afterEach(() => {
  h.stubbing = false;
  vi.unstubAllGlobals();
});

function el(): Record<string, unknown> {
  const listeners: Record<string, (() => void)[]> = {};
  const e: Record<string, unknown> = {
    style: {},
    dataset: {},
    children: [] as unknown[],
    textContent: '',
    contentWindow: {},
    prepend() {},
    append() {},
    addEventListener(type: string, fn: () => void) {
      (listeners[type] ??= []).push(fn);
      if (type === 'load') queueMicrotask(fn);
    },
  };
  return e;
}

/** Opens the dev host page at `?<query>` and returns what the view would get: the plan sent to it and ways to call tools as the view. */
async function openHost(query: string) {
  const doc = { getElementById: () => el(), createElement: () => el(), documentElement: el() };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('location', { href: `http://127.0.0.1:8788/?${query}`, search: `?${query}` });
  h.stubbing = true;
  try {
    await import('../dev-host/host');
  } finally {
    h.stubbing = false;
  }
  const client = h.clients[0] as FakeClient;
  const bridge = h.bridges[0] as FakeBridge;
  const sent = bridge.sent[0] as ToolResult;
  const plan = (sent.structuredContent?.workout ?? undefined) as WorkoutPlan | undefined;
  /** A tool call from the view: through the host's handler when it installs one, else straight to the server as the bridge does. */
  const viewCall = async (name: string, args: Record<string, unknown>): Promise<ToolResult> =>
    bridge.oncalltool ? await bridge.oncalltool({ name, arguments: args }, {}) : await client.callTool({ name, arguments: args });
  const viewMessage = async (text: string): Promise<ToolResult> => (bridge.onmessage ? await bridge.onmessage({ role: 'user', content: [{ type: 'text', text }] }, {}) : {});
  return { plan, sent, viewCall, viewMessage };
}

/** The stored workout, read straight from the server (what the view fetches with get_workout on open). */
async function stored(workoutId: string): Promise<WorkoutPlan> {
  const r = await call(real, 'get_workout', { workoutId });
  expect(r.isError, r.text).toBe(false);
  return r.data.workout as WorkoutPlan;
}

async function sample(name: string, extra = ''): Promise<{ plan: WorkoutPlan; host: Awaited<ReturnType<typeof openHost>> }> {
  const host = await openHost(`sample=${name}${extra}`);
  expect(host.plan, `?sample=${name} sends a workout plan to the view`).toBeDefined();
  return { plan: await stored(host.plan!.workoutId), host };
}

const steps = (p: WorkoutPlan) => p.exercises.length + p.cardio.length;
const closed = (s: { done: boolean; skipped?: boolean }) => s.done || s.skipped === true;
const anyClosed = (p: WorkoutPlan) => p.exercises.some((e) => e.sets.some(closed)) || p.cardio.some(closed);
const allClosed = (p: WorkoutPlan) => p.exercises.every((e) => e.sets.every(closed)) && p.cardio.every(closed);
const hasWarmups = (e: PlannedExercise) => e.sets.some((s) => s.warmup);

describe('dev host samples: Verification fixtures', () => {
  it('?sample=cards has 3 exercises: one bodyweight, one with barbell warm-ups, and one cardio finisher (P3.1)', async () => {
    const { plan } = await sample('cards');
    expect(plan.exercises).toHaveLength(3);
    expect(plan.exercises.filter((e) => e.bodyweight).length).toBeGreaterThanOrEqual(1);
    expect(plan.exercises.some((e) => hasWarmups(e) && !e.bodyweight)).toBe(true);
    expect(plan.cardio.filter((c) => c.when === 'after')).toHaveLength(1);
  });

  it('?sample=cards is fresh: nothing logged and not finished (P3.4 fresh)', async () => {
    const { plan } = await sample('cards');
    expect(anyClosed(plan)).toBe(false);
    expect(plan.finished).toBe(false);
  });

  it('?sample=superset has two superset exercises with warm-ups on one and unequal set counts (P3.2)', async () => {
    const { plan } = await sample('superset');
    const paired = plan.exercises.filter((e) => e.supersetId !== undefined);
    expect(paired).toHaveLength(2);
    expect(paired[0]!.supersetId).toBe(paired[1]!.supersetId);
    expect(paired.filter(hasWarmups)).toHaveLength(1);
    expect(paired[0]!.sets.length).not.toBe(paired[1]!.sets.length);
    expect(plan.finished).toBe(false);
  });

  it('?sample=timed has a timed plank (P3.2)', async () => {
    const { plan } = await sample('timed');
    const plank = plan.exercises.find((e) => e.timed === true);
    expect(plank).toBeDefined();
    expect(plank!.name).toMatch(/plank/i);
    expect(plank!.sets[0]!.targetSec).toBeGreaterThan(0);
  });

  it('?sample=cardio-heavy has one exercise with every set closed, and open cardio blocks before and after (P3.3)', async () => {
    const { plan } = await sample('cardio-heavy');
    expect(plan.exercises).toHaveLength(1);
    expect(plan.exercises[0]!.sets.length).toBeGreaterThanOrEqual(1);
    expect(plan.exercises[0]!.sets.every(closed)).toBe(true);
    expect(plan.cardio.length).toBeGreaterThanOrEqual(2);
    expect(plan.cardio.some((c) => c.when === 'before')).toBe(true);
    expect(plan.cardio.some((c) => c.when === 'after')).toBe(true);
    expect(plan.cardio.every((c) => !closed(c))).toBe(true);
    expect(plan.finished).toBe(false);
  });

  it('?sample=many has 12 or more steps, exercises and cardio together (P3.3)', async () => {
    const { plan } = await sample('many');
    expect(steps(plan)).toBeGreaterThanOrEqual(12);
  });

  it('?sample=closed has every step closed and the workout not finished (P3.3)', async () => {
    const { plan } = await sample('closed');
    expect(steps(plan)).toBeGreaterThanOrEqual(1);
    expect(allClosed(plan)).toBe(true);
    expect(plan.finished).toBe(false);
  });

  it('?sample=finished is finished, and its summary has a record on one exercise and none on another (P3.3, P3.4)', async () => {
    const { plan } = await sample('finished');
    expect(plan.finished).toBe(true);
    const r = await call(real, 'finish_workout', { workoutId: plan.workoutId });
    expect(r.isError, r.text).toBe(false);
    const lines = r.data.exercises as { personalRecord?: string }[];
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.some((l) => typeof l.personalRecord === 'string' && l.personalRecord.length > 0)).toBe(true);
    expect(lines.some((l) => l.personalRecord === undefined)).toBe(true);
  });

  it('?sample=resumed is partly done: some sets closed, at least one step still open, not finished (P3.4 resumed)', async () => {
    const { plan } = await sample('resumed');
    expect(anyClosed(plan)).toBe(true);
    expect(allClosed(plan)).toBe(false);
    expect(plan.finished).toBe(false);
  });

  it('every sample keeps the existing default: no ?sample still serves a workout (regression)', async () => {
    const { plan } = await sample('cards');
    expect(plan.exercises.length).toBeGreaterThan(0);
    const plain = await openHost('');
    expect(plain.plan).toBeDefined();
  });
});

describe('dev host failure switches: Verification fixtures (AC9, AC21)', () => {
  it.each(['log', '1'])('?fail=%s makes log_set return isError and stores nothing (P3.5, AC9)', async (fail) => {
    const { plan, host } = await sample('cards', `&fail=${fail}`);
    const set = plan.exercises[0]!.sets.find((s) => !s.warmup)!;
    const res = await host.viewCall('log_set', { workoutId: plan.workoutId, setId: set.id, reps: set.targetReps, skip: false, ...(set.weightKg !== undefined ? { weightKg: set.weightKg } : {}) });
    expect(res.isError).toBe(true);
    const after = await stored(plan.workoutId);
    expect(after.exercises[0]!.sets.find((s) => s.id === set.id)!.done).toBe(false);
  });

  it('?fail=log leaves other tools working (P3.5)', async () => {
    const { plan, host } = await sample('cards', '&fail=log');
    const res = await host.viewCall('get_workout', { workoutId: plan.workoutId });
    expect(res.isError).not.toBe(true);
  });

  it('log_set works without a fail switch, and a reload without ?fail= clears the switch (P3.5 until cleared)', async () => {
    const failing = await sample('cards', '&fail=log');
    expect((await failing.host.viewCall('log_set', { workoutId: failing.plan.workoutId, setId: failing.plan.exercises[0]!.sets[0]!.id, reps: 5, skip: false, weightKg: 20 })).isError).toBe(true);

    h.clients.length = 0;
    h.bridges.length = 0;
    vi.resetModules();
    const { plan, host } = await sample('cards', '&fail=');
    const set = plan.exercises[0]!.sets[0]!;
    const ok = await host.viewCall('log_set', { workoutId: plan.workoutId, setId: set.id, reps: set.targetReps, skip: false, ...(set.weightKg !== undefined ? { weightKg: set.weightKg } : {}) });
    expect(ok.isError).not.toBe(true);
    expect((await stored(plan.workoutId)).exercises[0]!.sets[0]!.done).toBe(true);
  });

  it('?fail=send makes sendMessage fail with isError, and without it the message is accepted (P3.5, AC21)', async () => {
    const failing = await openHost('sample=cards&fail=send');
    expect((await failing.viewMessage('I finished my workout')).isError).toBe(true);

    h.clients.length = 0;
    h.bridges.length = 0;
    vi.resetModules();
    const ok = await openHost('sample=cards');
    expect((await ok.viewMessage('I finished my workout')).isError).not.toBe(true);
  });

  it('?fail=send does not break log_set (P3.5)', async () => {
    const { plan, host } = await sample('cards', '&fail=send');
    const set = plan.exercises[0]!.sets[0]!;
    const res = await host.viewCall('log_set', { workoutId: plan.workoutId, setId: set.id, reps: set.targetReps, skip: false, ...(set.weightKg !== undefined ? { weightKg: set.weightKg } : {}) });
    expect(res.isError).not.toBe(true);
  });

  it('?sample=finished&fail=finish makes finish_workout return isError: a failing summary refetch (P3.4, P3.5)', async () => {
    const { plan, host } = await sample('finished', '&fail=finish');
    expect(plan.finished).toBe(true);
    const res = await host.viewCall('finish_workout', { workoutId: plan.workoutId });
    expect(res.isError).toBe(true);
  });
});
