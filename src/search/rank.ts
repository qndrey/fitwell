import { tokenize, withinOneEdit } from './text';

export interface Searchable<T> {
  item: T;
  name: string;
  tokens: string[];
}

export function prepare<T>(items: T[], nameOf: (t: T) => string): Searchable<T>[] {
  return items.map((item) => {
    const name = nameOf(item);
    return { item, name, tokens: tokenize(name) };
  });
}

/**
 * Every query word must match a word in the name (by prefix). Exact words beat prefixes,
 * a match on the first word (the food's main noun) is worth extra, shorter names win ties.
 * With fewer than 3 hits, retries tolerating one typo per word (words of 4+ letters).
 */
export function search<T>(index: Searchable<T>[], query: string, limit = 30): T[] {
  const q = tokenize(query);
  if (q.length === 0) return [];
  let hits = run(index, q, false);
  if (hits.length < 3 && q.some((w) => w.length >= 4)) {
    const seen = new Set(hits.map((h) => h.s));
    hits = hits.concat(run(index, q, true).filter((h) => !seen.has(h.s)));
  }
  hits.sort((a, b) => b.score - a.score || a.s.name.length - b.s.name.length || a.s.name.localeCompare(b.s.name));
  return hits.slice(0, limit).map((h) => h.s.item);
}

function run<T>(index: Searchable<T>[], q: string[], fuzzy: boolean): { s: Searchable<T>; score: number }[] {
  const out: { s: Searchable<T>; score: number }[] = [];
  for (const s of index) {
    let score = 0;
    let ok = true;
    for (const w of q) {
      let best = 0;
      for (let i = 0; i < s.tokens.length; i++) {
        const t = s.tokens[i]!;
        let m = 0;
        if (t === w) m = 3;
        else if (t.startsWith(w)) m = 1.5;
        else if (fuzzy && w.length >= 4 && withinOneEdit(t, w)) m = 1;
        if (m && i === 0) m += 2;
        if (m > best) best = m;
      }
      if (!best) {
        ok = false;
        break;
      }
      score += best;
    }
    if (ok) out.push({ s, score: score - s.name.length * 0.01 });
  }
  return out;
}
