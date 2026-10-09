// Manual check against the REAL Open Food Facts (not part of CI; be polite, run it rarely).
// Verifies: the endpoint answers JSON, browsers are allowed to read it (CORS), and our parser accepts the shape.
// Run: npm run smoke:off -- "oat drink"
import { toCandidates } from '../src/off/normalize.ts';
import { OFF_ORIGIN } from '../src/off/client.ts';

const term = process.argv[2] ?? 'oat drink';
const url = `${OFF_ORIGIN}/cgi/search.pl?search_terms=${encodeURIComponent(term)}&search_simple=1&action=process&json=1&page_size=5&fields=code,product_name,brands,nutriments,serving_quantity`;
const res = await fetch(url, { headers: { Origin: 'https://fitwell.example', 'User-Agent': 'Fitwell-smoke/0.1 (manual check)' } });
const cors = res.headers.get('access-control-allow-origin');
console.log(`HTTP ${res.status}  content-type: ${res.headers.get('content-type')}  access-control-allow-origin: ${cors ?? '(none)'}`);
if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) {
  console.error('✗ Not a JSON success (OFF may be in maintenance or rate-limiting). Try again later.');
  process.exit(1);
}
const json = (await res.json()) as { products?: unknown[] };
const candidates = toCandidates(json.products ?? []);
console.log(`products: ${json.products?.length ?? 0}, usable candidates: ${candidates.length}`);
for (const c of candidates.slice(0, 3)) console.log(' •', c.name, c.brand ?? '', `${c.per100g.kcal} kcal/100 g`);
if (!cors) console.error('✗ No Access-Control-Allow-Origin: browsers on other origins cannot read this endpoint.');
process.exit(cors && candidates.length ? 0 : 1);
