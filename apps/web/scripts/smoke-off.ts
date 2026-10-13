// Manual check against the REAL Open Food Facts (not part of CI; be polite, run it rarely).
// Verifies, for both endpoints we use: JSON answer, browsers allowed to read it (CORS), and our parser accepts the shape.
// The text search is known to answer 503 intermittently, so it is retried a few times, spaced out.
// Run: npm run smoke:off -- "oat drink"
import { toCandidate, toCandidates } from '@fitwell/core/off/normalize';
import { OFF_ORIGIN } from '@fitwell/core/off/client';

const term = process.argv[2] ?? 'oat drink';
const FIELDS = 'code,product_name,brands,nutriments,serving_quantity';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const headers = { Origin: 'https://fitwell.example', 'User-Agent': 'Fitwell-smoke/0.1 (manual check)' };

async function get(url: string) {
  const res = await fetch(url, { headers });
  const json = (res.headers.get('content-type') ?? '').includes('json') ? await res.json().catch(() => null) : null;
  return { res, json, cors: res.headers.get('access-control-allow-origin') };
}

let failed = 0;

console.log('— product by barcode (used by the scanner)');
{
  const { res, json, cors } = await get(`${OFF_ORIGIN}/api/v2/product/3017620422003.json?fields=${FIELDS}`);
  const c = json ? toCandidate({ ...(json.product ?? {}), code: json.code }) : null;
  console.log(`  HTTP ${res.status}  CORS: ${cors ?? '(none)'}  parsed: ${c ? `${c.name} ${c.per100g.kcal} kcal/100 g` : 'no'}`);
  if (!res.ok || !cors || !c) failed++;
}

console.log('— text search (used for typed foods and the pending queue)');
{
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    if (attempt > 1) await sleep(15_000);
    const { res, json, cors } = await get(`${OFF_ORIGIN}/cgi/search.pl?search_terms=${encodeURIComponent(term)}&search_simple=1&action=process&json=1&page_size=5&fields=${FIELDS}`);
    const list = toCandidates(json?.products ?? []);
    console.log(`  attempt ${attempt}: HTTP ${res.status}  CORS: ${cors ?? '(none)'}  usable candidates: ${list.length}`);
    ok = res.ok && !!cors && list.length > 0;
  }
  if (!ok) {
    failed++;
    console.error('  ✗ search never answered with JSON. The app retries 503s with a pause, but check OFF status.');
  }
}
process.exit(failed ? 1 : 0);
