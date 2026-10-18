// A minimal MCP Apps host for trying the views locally, the way Claude embeds them.
// Served by scripts/dev-host.ts; never deployed.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';

/** ?sample=a2: warm-ups and plates (squat), a superset (curl + pushdown) and a timed plank. */
const SAMPLE_A2 = {
  name: 'Player features',
  exercises: [
    { id: 'ex:Barbell_Squat', sets: 2, reps: 5, weight_kg: 102.5, rest_sec: 3 },
    { id: 'ex:Barbell_Curl', sets: 2, reps: 10, weight_kg: 30, rest_sec: 3, superset: 'A' },
    { id: 'ex:Triceps_Pushdown', sets: 2, reps: 12, weight_kg: 25, rest_sec: 3, superset: 'A' },
    { id: 'ex:Plank', sets: 1, seconds: 10, rest_sec: 3 },
  ],
};

const SAMPLE = {
  name: 'Full body',
  exercises: [
    { id: 'ex:Barbell_Squat', sets: 2, reps: 5, rest_sec: 3 },
    { id: 'ex:Pullups', sets: 1, reps: 8, rest_sec: 3 },
    { id: 'ex:Barbell_Bench_Press_-_Medium_Grip', sets: 1, reps: 8, weight_kg: 60, rest_sec: 3, notes: 'Pause on the chest' },
  ],
  cardio: [
    { activity_id: 'act:row-machine', minutes: 5, when: 'before' },
    { activity_id: 'act:run-10', minutes: 10, when: 'after', distance_km: 1.5 },
  ],
};

const log = (kind: string, data: unknown) => {
  const li = document.createElement('li');
  li.textContent = `${new Date().toLocaleTimeString()} ${kind}: ${typeof data === 'string' ? data : JSON.stringify(data)}`;
  document.getElementById('log')!.prepend(li);
};

const theme = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;

const client = new Client({ name: 'fitwell-dev-host', version: '0.1.0' });
await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', location.href)));

// ?view=dashboard, review, shopping, exercise or muscles shows that view instead of the workout player.
const VIEWS: Record<string, { tool: string; args: Record<string, unknown>; uri: string }> = {
  dashboard: { tool: 'show_dashboard', args: { days: 90 }, uri: 'ui://fitwell/dashboard.html' },
  food: { tool: 'log_food', args: { items: [{ food_id: 'frida:59', grams: 80 }, { food_id: 'frida:413', grams: 120 }] }, uri: 'ui://fitwell/food.html' },
  review: { tool: 'show_weekly_review', args: {}, uri: 'ui://fitwell/review.html' },
  shopping: { tool: 'show_grocery_list', args: { people: 2 }, uri: 'ui://fitwell/shopping.html' },
  muscles: { tool: 'show_muscle_map', args: { weeks: Number(new URLSearchParams(location.search).get('weeks') ?? 4) }, uri: 'ui://fitwell/exercise.html' },
  exercise: { tool: 'show_exercise', args: { query: new URLSearchParams(location.search).get('q') ?? 'leg press' }, uri: 'ui://fitwell/exercise.html' },
  workout: { tool: 'start_workout', args: new URLSearchParams(location.search).get('sample') === 'a2' ? SAMPLE_A2 : SAMPLE, uri: 'ui://fitwell/workout.html' },
};
const which = VIEWS[new URLSearchParams(location.search).get('view') ?? 'workout'] ?? VIEWS.workout!;
// ?args={"week_start":"2026-10-05"} replaces the tool arguments (used by scripts/screenshots.ts).
const argsParam = new URLSearchParams(location.search).get('args');
const result = await client.callTool({ name: which.tool, arguments: argsParam ? (JSON.parse(argsParam) as Record<string, unknown>) : which.args });
log(which.tool, (result.content as { text?: string }[])[0]?.text?.slice(0, 160) ?? result);
const resource = await client.readResource({ uri: which.uri });
const html = (resource.contents[0] as { text: string }).text;

const iframe = document.getElementById('view') as HTMLIFrameElement;
iframe.srcdoc = html;
await new Promise((r) => iframe.addEventListener('load', r, { once: true }));

const bridge = new AppBridge(
  client,
  { name: 'fitwell-dev-host', version: '0.1.0' },
  { serverTools: {}, openLinks: {}, logging: {}, message: { text: {} }, updateModelContext: { text: {} } },
  { hostContext: { theme, platform: 'web', displayMode: 'inline' } },
);
bridge.onsizechange = ({ height }) => {
  if (height) iframe.style.height = `${height}px`;
};
bridge.onopenlink = async (params) => {
  log('open link', params.url);
  return {};
};
bridge.onmessage = async (params) => {
  log('message to Claude', params.content);
  return {};
};
bridge.onupdatemodelcontext = async (params) => {
  log('model context', params.content);
  return {};
};
bridge.oninitialized = () => {
  log('view', 'initialized');
  void bridge.sendToolInput({ arguments: which.args });
  void bridge.sendToolResult(result as Parameters<typeof bridge.sendToolResult>[0]);
};
await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
