// Builds the bundled exercise library from free-exercise-db (The Unlicense / public domain).
// Input:  data/raw/exercises/exercises.json  (gitignored; see data/README.md)
// Output: src/data/generated/exercises.index.json         search + filters (loaded when picking an exercise)
//         src/data/generated/exercises.instructions.json  how-to text (loaded only when someone opens "How to")
// Images are deliberately NOT included (bundle size, no third-party requests). The original `id` is the stable key
// ("ex:<id>") so images can be added later without touching user data. Run: npm run build:exercises
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const INPUT = process.argv[2] ?? 'data/raw/exercises/exercises.json';
const COMMIT = 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5';

interface Raw {
  id: string; name: string; category: string; level: string; equipment: string | null; force: string | null; mechanic: string | null;
  primaryMuscles: string[]; secondaryMuscles: string[]; instructions: string[];
}
const raw: Raw[] = JSON.parse(readFileSync(INPUT, 'utf8'));

const ids = new Set<string>();
for (const r of raw) {
  if (!r.id || !r.name || ids.has(r.id)) throw new Error(`Missing or duplicate id: ${r.id}`);
  ids.add(r.id);
}
raw.sort((a, b) => (a.id < b.id ? -1 : 1));

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const index = raw.map((r) => ({
  id: r.id,
  name: clean(r.name),
  category: r.category,
  level: r.level,
  equipment: r.equipment ?? 'none',
  force: r.force ?? undefined,
  mechanic: r.mechanic ?? undefined,
  primary: r.primaryMuscles,
  secondary: r.secondaryMuscles,
}));
const instructions = Object.fromEntries(raw.filter((r) => r.instructions.length).map((r) => [r.id, r.instructions.map(clean)]));

const meta = {
  id: 'free-exercise-db',
  name: 'free-exercise-db',
  url: 'https://github.com/yuhonas/free-exercise-db',
  commit: COMMIT,
  license: 'The Unlicense (public domain)',
  sourceSha256: createHash('sha256').update(readFileSync(INPUT)).digest('hex'),
};
const categories = [...new Set(index.map((e) => e.category))].sort();
const equipment = [...new Set(index.map((e) => e.equipment))].sort();
const muscles = [...new Set(index.flatMap((e) => [...e.primary, ...e.secondary]))].sort();

writeFileSync('src/data/generated/exercises.index.json', JSON.stringify({ meta, categories, equipment, muscles, exercises: index }) + '\n');
writeFileSync('src/data/generated/exercises.instructions.json', JSON.stringify(instructions) + '\n');
console.log(`Wrote ${index.length} exercises; ${categories.length} categories, ${equipment.length} equipment types, ${muscles.length} muscles.`);
