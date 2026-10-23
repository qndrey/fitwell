// Adds an address to the invite list. Usage (from the repo root):
//   npm run invite -w @fitwell/mcp -- someone@example.com            (local dev database)
//   npm run invite -w @fitwell/mcp -- someone@example.com --remote   (the deployed database)
// On the free plan the address must also be a verified destination in Cloudflare Email Routing, or sign-in emails won't arrive.
// With --remote and CF_ACCOUNT_ID + CF_API_TOKEN (Email Routing Addresses: Edit) in the environment, the destination is added
// here too and Cloudflare emails the person a verification link; otherwise add it in the dashboard
// (fitwell.fyi → Email → Email Routing → Destination addresses).
import { execFileSync } from 'node:child_process';
import { cloudflareDestinations } from '../src/auth/destinations';

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
if (remote) {
  const result = await cloudflareDestinations({ CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID, CF_API_TOKEN: process.env.CF_API_TOKEN })(email);
  if (result.status === 'verification_sent') console.log('Cloudflare emailed them a verification link; they must click it before sign-in emails arrive.');
  else if (result.status === 'already_registered') console.log(result.verified ? 'Already a verified destination.' : 'Already registered but not verified yet; they need to click the earlier Cloudflare link.');
  else if (result.status === 'failed') console.error(`Could not add the Email Routing destination: ${result.reason}. Add it in the dashboard.`);
  else console.log('Set CF_ACCOUNT_ID and CF_API_TOKEN to add the Email Routing destination automatically; otherwise add it in the dashboard.');
}
