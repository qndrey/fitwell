// Talks to a running server like Claude would. Usage: npm run smoke -w @fitwell/mcp [-- http://127.0.0.1:8787/mcp]
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:8787/mcp');
const client = new Client({ name: 'fitwell-smoke', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(url));

const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));

for (const [name, args] of [
  ['search_foods', { query: 'rye bread', limit: 3 }],
  ['search_exercises', { query: 'bench press', equipment: 'barbell', limit: 3 }],
  ['get_exercise', { id: 'ex:Barbell_Squat' }],
  ['get_profile', {}],
  ['log_food', { items: [{ food_id: 'frida:413', grams: 120 }] }],
  ['get_day', {}],
] as const) {
  const t0 = performance.now();
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { text?: string }[])[0]?.text ?? '';
  console.log(`\n${name} ${JSON.stringify(args)} → ${res.isError ? 'ERROR ' : ''}${Math.round(performance.now() - t0)} ms\n${text.slice(0, 400)}`);
}
await client.close();
