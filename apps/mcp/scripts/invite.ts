// Adds an address to the invite list. Usage (from the repo root):
//   npm run invite -w @fitwell/mcp -- someone@example.com            (local dev database)
//   npm run invite -w @fitwell/mcp -- someone@example.com --remote   (the deployed database)
// On the free plan the address must also be a verified destination in Cloudflare Email Routing
// (dashboard → fitwell.fyi → Email → Email Routing → Destination addresses), or sign-in emails won't arrive.
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase() ?? '';
// Strict shape check; the value also goes into SQL below, so nothing but these characters is allowed.
if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
  console.error('Usage: npm run invite -w @fitwell/mcp -- someone@example.com [--remote]');
  process.exit(1);
}
const sql = `INSERT INTO users (id, email, status, created_at) VALUES ('${crypto.randomUUID()}', '${email}', 'invited', ${Date.now()}) ON CONFLICT (email) DO NOTHING;`;
execFileSync('npx', ['wrangler', 'd1', 'execute', 'fitwell', remote ? '--remote' : '--local', '--command', sql], { stdio: 'inherit' });
console.log(`${email} is invited${remote ? '' : ' (local database)'}.`);
