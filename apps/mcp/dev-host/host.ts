// A minimal MCP Apps host for trying the views locally, the way Claude embeds them.
// Served by scripts/dev-host.ts; never deployed.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';

const SAMPLE = {
  name: 'Full body',
  exercises: [
    { id: 'ex:Barbell_Squat', sets: 3, reps: 5, weight_kg: 80, rest_sec: 5 },
    { id: 'ex:Pullups', sets: 2, reps: 8, rest_sec: 5 },
    { id: 'ex:Barbell_Bench_Press_-_Medium_Grip', sets: 3, reps: 8, weight_kg: 60, rest_sec: 5 },
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

const result = await client.callTool({ name: 'start_workout', arguments: SAMPLE });
log('start_workout', (result.content as { text?: string }[])[0]?.text ?? result);
const resource = await client.readResource({ uri: 'ui://fitwell/workout.html' });
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
  void bridge.sendToolInput({ arguments: SAMPLE });
  void bridge.sendToolResult(result as Parameters<typeof bridge.sendToolResult>[0]);
};
await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
