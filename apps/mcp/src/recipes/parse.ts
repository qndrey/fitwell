// Reads a recipe out of a web page. Most recipe sites publish it as schema.org JSON-LD for search engines, so no
// scraping of page layout is needed. Pure: takes the HTML text.

export interface ParsedRecipe {
  name: string;
  servings: number | null;
  /** Ingredient lines as written, e.g. "200 g chicken breast". Matching them to foods is for the caller. */
  ingredientLines: string[];
  steps: string[];
  totalMinutes: number | null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾' };
/** Recipe sites escape their text as HTML even inside JSON. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&([a-z0-9]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

const clean = (v: unknown): string => (typeof v === 'string' ? decodeEntities(v.replace(/<(?:br|\/p|\/li|\/div)[^>]*>/gi, ' ').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim() : '');

function isRecipe(node: unknown): node is Record<string, unknown> {
  if (typeof node !== 'object' || node === null) return false;
  const t = (node as Record<string, unknown>)['@type'];
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
}

/** Depth-first through arrays, @graph and nested values until a Recipe object turns up. */
function findRecipe(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6 || typeof node !== 'object' || node === null) return null;
  if (isRecipe(node)) return node;
  const children = Array.isArray(node) ? node : Object.values(node);
  for (const c of children) {
    const r = findRecipe(c, depth + 1);
    if (r) return r;
  }
  return null;
}

function servingsOf(v: unknown): number | null {
  const first = Array.isArray(v) ? v[0] : v;
  const n = typeof first === 'number' ? first : typeof first === 'string' ? Number(/\d+(?:[.,]\d+)?/.exec(first)?.[0]?.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 50 ? n : null;
}

/** "PT1H30M" → 90. */
export function minutesOf(v: unknown): number | null {
  const m = typeof v === 'string' ? /^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?/i.exec(v) : null;
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

function stepsOf(v: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (typeof v === 'string') return clean(v) ? [clean(v)] : [];
  if (Array.isArray(v)) return v.flatMap((x) => stepsOf(x, depth + 1));
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    if (o.itemListElement) return stepsOf(o.itemListElement, depth + 1);
    return stepsOf(o.text ?? o.name, depth + 1);
  }
  return [];
}

export function parseRecipePage(html: string): ParsedRecipe | null {
  const blocks = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const b of blocks) {
    let json: unknown;
    try {
      json = JSON.parse(b[1]!.trim());
    } catch {
      continue;
    }
    const r = findRecipe(json);
    if (!r) continue;
    const ingredientLines = (Array.isArray(r.recipeIngredient) ? r.recipeIngredient : []).map(clean).filter(Boolean).slice(0, 60);
    const name = clean(r.name);
    if (!name || !ingredientLines.length) continue;
    return { name: name.slice(0, 80), servings: servingsOf(r.recipeYield), ingredientLines, steps: stepsOf(r.recipeInstructions).slice(0, 40).map((s) => s.slice(0, 500)), totalMinutes: minutesOf(r.totalTime) };
  }
  return null;
}

/** https, the standard port, no password in the address, and a host name rather than an address or a local name. */
export function checkRecipeUrl(raw: string): URL | string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'That is not a valid web address.';
  }
  if (u.protocol !== 'https:') return 'Only https:// addresses can be opened.';
  if (u.username || u.password) return 'Addresses with a login in them cannot be opened.';
  if (u.port && u.port !== '443') return 'Only the standard https port can be used.';
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[') || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)) return 'That address is not a public website.';
  return u;
}

const MAX_BYTES = 1_500_000;

/** Downloads at most MAX_BYTES of a page as text; recipe data sits in the head or early in the body. */
export async function fetchPage(url: URL, fetcher: typeof fetch, userAgent: string): Promise<{ html: string; finalUrl: string } | string> {
  let res: Response;
  try {
    res = await fetcher(url.toString(), { headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
  } catch {
    return 'The page could not be reached.';
  }
  const finalUrl = res.url || url.toString();
  const again = checkRecipeUrl(finalUrl);
  if (typeof again === 'string') return 'The page redirected somewhere that cannot be opened.';
  if (!res.ok) return `The site answered ${res.status}.`;
  if (!/html|xml/i.test(res.headers.get('content-type') ?? '')) return 'That address is not a web page.';
  const reader = res.body?.getReader();
  if (!reader) return 'The page was empty.';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  void reader.cancel().catch(() => undefined);
  const all = new Uint8Array(Math.min(size, MAX_BYTES));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.max(0, all.length - at));
    all.set(part, at);
    at += part.length;
  }
  return { html: new TextDecoder().decode(all), finalUrl };
}
