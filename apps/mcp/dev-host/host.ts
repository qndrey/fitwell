// A minimal MCP Apps host for trying the views locally, the way Claude embeds them.
// Served by scripts/dev-host.ts; never deployed.
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";

// Typed locally so the file also compiles in the worker-typed root program that the tests use.
interface HostElement {
  textContent: string | null;
  prepend(child: HostElement): void;
  srcdoc: string;
  style: { height: string };
  addEventListener(
    type: string,
    listener: (event: unknown) => void,
    options?: { once: boolean },
  ): void;
  contentWindow: object | null;
  dataset: Record<string, string | undefined>;
}
const doc = (
  globalThis as unknown as {
    document: {
      createElement(tag: string): HostElement;
      getElementById(id: string): HostElement | null;
      documentElement: HostElement;
    };
  }
).document;
const loc = (
  globalThis as unknown as { location: { search: string; href: string } }
).location;

/** ?sample=a2: warm-ups and plates (squat), a superset (curl + pushdown) and a timed plank. */
const SAMPLE_A2 = {
  name: "Legs and arms",
  exercises: [
    { id: "ex:Barbell_Squat", sets: 2, reps: 5, weight_kg: 102.5, rest_sec: 3 },
    {
      id: "ex:Barbell_Curl",
      sets: 2,
      reps: 10,
      weight_kg: 30,
      rest_sec: 3,
      superset: "A",
    },
    {
      id: "ex:Triceps_Pushdown",
      sets: 2,
      reps: 12,
      weight_kg: 25,
      rest_sec: 3,
      superset: "A",
    },
    { id: "ex:Plank", sets: 1, seconds: 10, rest_sec: 3 },
  ],
};

const SAMPLE = {
  name: "Full body",
  exercises: [
    { id: "ex:Barbell_Squat", sets: 2, reps: 5, rest_sec: 3 },
    { id: "ex:Pullups", sets: 1, reps: 8, rest_sec: 3 },
    {
      id: "ex:Barbell_Bench_Press_-_Medium_Grip",
      sets: 1,
      reps: 8,
      weight_kg: 60,
      rest_sec: 3,
      notes: "Pause on the chest",
    },
  ],
  cardio: [
    { activity_id: "act:row-machine", minutes: 5, when: "before" },
    { activity_id: "act:run-10", minutes: 10, when: "after", distance_km: 1.5 },
  ],
};

type Sample = {
  name: string;
  exercises: Record<string, unknown>[];
  cardio?: Record<string, unknown>[];
};
type Prepare = "resume" | "close" | "sets" | "finish" | "finish-record";

const SQUAT = { id: "ex:Barbell_Squat", sets: 2, reps: 5, rest_sec: 3 };
const PULLUPS = { id: "ex:Pullups", sets: 2, reps: 8, rest_sec: 3 };
const BENCH = {
  id: "ex:Barbell_Bench_Press_-_Medium_Grip",
  sets: 2,
  reps: 8,
  weight_kg: 60,
  rest_sec: 3,
};
const FINISHER = {
  activity_id: "act:run-10",
  minutes: 10,
  when: "after",
  distance_km: 1.5,
};

/** ?sample=<name> picks one of these; each runs against the real server, so the stored state is real. */
const SAMPLES: Record<string, { plan: Sample; prepare?: Prepare }> = {
  cards: {
    plan: {
      name: "Full body A",
      exercises: [
        SQUAT,
        PULLUPS,
        { ...BENCH, sets: 1, notes: "Pause on the chest" },
      ],
      cardio: [FINISHER],
    },
  },
  resumed: {
    plan: {
      name: "Full body A",
      exercises: [SQUAT, PULLUPS, { ...BENCH, sets: 1 }],
      cardio: [FINISHER],
    },
    prepare: "resume",
  },
  superset: {
    plan: {
      name: "Arms",
      exercises: [
        {
          id: "ex:Barbell_Curl",
          sets: 3,
          reps: 10,
          weight_kg: 50,
          rest_sec: 3,
          superset: "A",
          warmup: true,
        },
        {
          id: "ex:Triceps_Pushdown",
          sets: 2,
          reps: 12,
          weight_kg: 25,
          rest_sec: 3,
          superset: "A",
        },
      ],
    },
  },
  timed: {
    plan: {
      name: "Core",
      exercises: [{ id: "ex:Plank", sets: 2, seconds: 10, rest_sec: 3 }],
    },
  },
  "cardio-heavy": {
    plan: {
      name: "Cardio day",
      exercises: [{ ...PULLUPS, sets: 1, reps: 5 }],
      cardio: [
        { activity_id: "act:row-machine", minutes: 5, when: "before" },
        FINISHER,
      ],
    },
    prepare: "sets",
  },
  many: {
    plan: {
      name: "Big session",
      exercises: [
        SQUAT,
        PULLUPS,
        BENCH,
        {
          id: "ex:Barbell_Curl",
          sets: 1,
          reps: 10,
          weight_kg: 30,
          rest_sec: 3,
        },
        {
          id: "ex:Triceps_Pushdown",
          sets: 1,
          reps: 12,
          weight_kg: 25,
          rest_sec: 3,
        },
        { id: "ex:Plank", sets: 1, seconds: 10, rest_sec: 3 },
      ].concat([
        SQUAT,
        PULLUPS,
        BENCH,
        {
          id: "ex:Barbell_Curl",
          sets: 1,
          reps: 10,
          weight_kg: 30,
          rest_sec: 3,
        },
        {
          id: "ex:Triceps_Pushdown",
          sets: 1,
          reps: 12,
          weight_kg: 25,
          rest_sec: 3,
        },
        { id: "ex:Plank", sets: 1, seconds: 10, rest_sec: 3 },
      ]),
      cardio: [FINISHER],
    },
  },
  closed: {
    plan: {
      name: "Push day",
      exercises: [SQUAT, PULLUPS],
      cardio: [FINISHER],
    },
    prepare: "close",
  },
  finished: {
    plan: {
      name: "Pull day",
      exercises: [{ ...BENCH, weight_kg: 140 }, PULLUPS],
      cardio: [FINISHER],
    },
    prepare: "finish-record",
  },
  "finished-norecord": {
    plan: { name: "Finished, no record", exercises: [{ ...PULLUPS, sets: 1 }] },
    prepare: "finish",
  },
};

SAMPLES["cardio-only"] = SAMPLES["cardio-heavy"]!;

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type PlanSet = {
  id: string;
  done: boolean;
  targetReps: number;
  targetSec?: number;
  weightKg?: number;
};
type PlanShape = {
  workoutId: string;
  exercises: { timed?: boolean; bodyweight: boolean; sets: PlanSet[] }[];
  cardio: { id: string }[];
};

/**
 * Logs an earlier light bench session, then returns a weight whose estimated 1RM beats every earlier bench session
 * (the dev database keeps earlier runs), so the finished summary always has a record on the bench.
 */
async function recordWeight(): Promise<number> {
  await client.callTool({
    name: "log_past_workout",
    arguments: {
      day: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
      name: "Earlier bench",
      exercises: [{ id: BENCH.id, sets: [{ reps: 8, weight_kg: 40 }] }],
    },
  });
  const history = await client.callTool({
    name: "get_workout_history",
    arguments: { days: 365, exercise_id: BENCH.id },
  });
  const sessions =
    (history.structuredContent as { sessions?: { estimated1rmKg?: number }[] })
      .sessions ?? [];
  const best = Math.max(0, ...sessions.map((s) => s.estimated1rmKg ?? 0));
  return Math.max(140, Math.ceil(best / (1 + 8 / 30) / 2.5) * 2.5 + 2.5);
}

/** Logs sets on the real server so the view opens resumed, fully closed or finished. */
async function prepareWorkout(
  started: ToolResult,
  how: Prepare,
): Promise<ToolResult> {
  const plan = (started.structuredContent as { workout: PlanShape }).workout;
  const id = plan.workoutId;
  const record = how === "finish-record" ? await recordWeight() : undefined;
  const all = plan.exercises.flatMap((e) =>
    e.sets.map((s, k) => ({ e, s, last: k === e.sets.length - 1 })),
  );
  const todo = how === "resume" ? all.slice(0, 2) : all;
  for (const [n, { e, s }] of todo.entries()) {
    const skip = how === "close" && n === 1;
    await client.callTool({
      name: "log_set",
      arguments: {
        workoutId: id,
        setId: s.id,
        reps: e.timed ? 0 : s.targetReps,
        ...(e.bodyweight || s.weightKg === undefined
          ? {}
          : { weightKg: record !== undefined && n === 0 ? record : s.weightKg }),
        ...(e.timed ? { seconds: s.targetSec ?? 10 } : {}),
        skip,
      },
    });
  }
  if (how !== "resume" && how !== "sets") {
    for (const b of plan.cardio)
      await client.callTool({
        name: "log_cardio_block",
        arguments: { workoutId: id, blockId: b.id },
      });
  }
  if (how === "finish" || how === "finish-record")
    await client.callTool({
      name: "finish_workout",
      arguments: { workoutId: id },
    });
  return client.callTool({ name: "get_workout", arguments: { workoutId: id } });
}

const log = (kind: string, data: unknown) => {
  const li = doc.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString()} ${kind}: ${typeof data === "string" ? data : JSON.stringify(data)}`;
  doc.getElementById("log")!.prepend(li);
};

const theme =
  new URLSearchParams(loc.search).get("theme") === "dark" ? "dark" : "light";
doc.documentElement.dataset.theme = theme;

const client = new Client({ name: "fitwell-dev-host", version: "0.1.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL("/mcp", loc.href)),
);

function pickSample(): Record<string, unknown> {
  const name = new URLSearchParams(loc.search).get("sample") ?? "";
  if (name === "a2") return SAMPLE_A2;
  return SAMPLES[name]?.plan ?? SAMPLE;
}

// ?view=dashboard, review, shopping, exercise or muscles shows that view instead of the workout player.
const VIEWS: Record<
  string,
  { tool: string; args: Record<string, unknown>; uri: string }
> = {
  dashboard: {
    tool: "show_dashboard",
    args: { days: 90 },
    uri: "ui://fitwell/dashboard.html",
  },
  food: {
    tool: "log_food",
    args: {
      items: [
        { food_id: "frida:59", grams: 80 },
        { food_id: "frida:413", grams: 120 },
      ],
    },
    uri: "ui://fitwell/food.html",
  },
  review: {
    tool: "show_weekly_review",
    args: {},
    uri: "ui://fitwell/review.html",
  },
  shopping: {
    tool: "show_grocery_list",
    args: { people: 2 },
    uri: "ui://fitwell/shopping.html",
  },
  muscles: {
    tool: "show_muscle_map",
    args: {
      weeks: Number(new URLSearchParams(loc.search).get("weeks") ?? 4),
    },
    uri: "ui://fitwell/exercise.html",
  },
  exercise: {
    tool: "show_exercise",
    args: {
      query: new URLSearchParams(loc.search).get("q") ?? "leg press",
    },
    uri: "ui://fitwell/exercise.html",
  },
  workout: {
    tool: "start_workout",
    args: pickSample(),
    uri: "ui://fitwell/workout.html",
  },
};
const which =
  VIEWS[new URLSearchParams(loc.search).get("view") ?? "workout"] ??
  VIEWS.workout!;
// ?args={"week_start":"2026-10-05"} replaces the tool arguments (used by scripts/screenshots.ts).
const argsParam = new URLSearchParams(loc.search).get("args");
let result = await client.callTool({
  name: which.tool,
  arguments: argsParam
    ? (JSON.parse(argsParam) as Record<string, unknown>)
    : which.args,
});
const prepare =
  which.tool === "start_workout"
    ? SAMPLES[new URLSearchParams(loc.search).get("sample") ?? ""]?.prepare
    : undefined;
if (prepare && !result.isError) result = await prepareWorkout(result, prepare);

// ?fail=log (or 1), send or finish makes that call return isError until cleared: ?fail= or a reload, or window.fitwellFail.value = ''.
const failParam = new URLSearchParams(loc.search).get("fail") ?? "";
const fail = { value: failParam === "1" ? "log" : failParam };
(globalThis as unknown as { fitwellFail: typeof fail }).fitwellFail = fail;
const failed = (what: string) => ({
  isError: true,
  content: [
    { type: "text" as const, text: `Dev host: ${what} failed on purpose.` },
  ],
});
log(
  which.tool,
  (result.content as { text?: string }[])[0]?.text?.slice(0, 160) ?? result,
);
const resource = await client.readResource({ uri: which.uri });
const html = (resource.contents[0] as { text: string }).text;

const iframe = doc.getElementById("view")!;
iframe.srcdoc = html;
await new Promise((r) => iframe.addEventListener("load", r, { once: true }));

const bridge = new AppBridge(
  client,
  { name: "fitwell-dev-host", version: "0.1.0" },
  {
    serverTools: {},
    openLinks: {},
    logging: {},
    message: { text: {} },
    updateModelContext: { text: {} },
  },
  { hostContext: { theme, platform: "web", displayMode: "inline" } },
);
bridge.onsizechange = ({ height }) => {
  if (height) iframe.style.height = `${height}px`;
};
bridge.onopenlink = async (params) => {
  log("open link", params.url);
  return {};
};
bridge.onmessage = async (params) => {
  log("message to Claude", params.content);
  return fail.value === "send" ? { isError: true } : {};
};
bridge.onupdatemodelcontext = async (params) => {
  log("model context", params.content);
  return {};
};
bridge.oninitialized = () => {
  log("view", "initialized");
  void bridge.sendToolInput({ arguments: which.args });
  void bridge.sendToolResult(
    result as Parameters<typeof bridge.sendToolResult>[0],
  );
};
await bridge.connect(
  new PostMessageTransport(
    iframe.contentWindow as never,
    iframe.contentWindow as never,
  ),
);
// connect() installs its own tools/call forwarder when the server has tools, replacing any handler set before it, so the failure
// switches are put in after it (set before, ?fail=log and ?fail=finish never applied).
bridge.oncalltool = undefined;
bridge.oncalltool = async (params) => {
  if (
    (params.name === "log_set" && fail.value === "log") ||
    (params.name === "finish_workout" && fail.value === "finish")
  ) {
    log("failing", params.name);
    return failed(params.name);
  }
  return (await client.callTool(params)) as Awaited<
    ReturnType<NonNullable<typeof bridge.oncalltool>>
  >;
};

