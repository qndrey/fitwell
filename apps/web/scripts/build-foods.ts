// Builds the bundled food dataset from the Frida 5.5 spreadsheet (CC BY 4.0, DTU National Food Institute).
// Input:  data/raw/frida/Frida_5.5_Dataset.xlsx   (gitignored; see data/README.md)
// Output: src/data/generated/foods.frida.json     (committed; deterministic)
// Run:    npm run build:foods
import readXlsxFile from 'read-excel-file/node';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const INPUT = process.argv[2] ?? 'data/raw/frida/Frida_5.5_Dataset.xlsx';
const OUTPUT = 'src/data/generated/foods.frida.json';

type Cell = string | number | boolean | Date | null;
const sheets = (await readXlsxFile(INPUT)) as unknown as { sheet: string; data: Cell[][] }[];
const sheet = (name: string): Cell[][] => {
  const s = sheets.find((x) => x.sheet === name);
  if (!s) throw new Error(`Sheet not found: ${name}`);
  return s.data;
};

// Wide table: row 1 = English parameter names, row 3 = parameter IDs, data from row 4.
const table = sheet('Data_Table');
const names = table[1]!;
const col = (englishName: string): number => {
  const i = names.indexOf(englishName);
  if (i < 0) throw new Error(`Column not found: ${englishName}`);
  return i;
};
// Label-style (EU "declaration") values first, so numbers match what packaging shows
// and stay consistent with Open Food Facts data; fall back to the calculated ones.
const C = {
  kcal: [col('Energy, labelling (kcal)'), col('Energy (kcal)')],
  protein: [col('Protein, labeling'), col('Protein')],
  carbs: [col('Available carbohydrate, labelling'), col('Available carbohydrates')],
  fat: [col('Fat')],
} as const;

const num = (v: Cell | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pick = (row: Cell[], cols: readonly number[]): number | null => {
  for (const c of cols) {
    const v = num(row[c]);
    if (v !== null) return v;
  }
  return null;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

// Food sheet: English name, ID and English group.
const foodSheet = sheet('Food');
const fh = foodSheet[0]!;
const [iName, iId, iGroup] = [fh.indexOf('FoodName'), fh.indexOf('FoodID'), fh.indexOf('FoodGroup')];
if ([iName, iId, iGroup].some((i) => i < 0)) throw new Error('Food sheet columns changed');
const meta = new Map<number, { name: string; group: string }>();
for (const r of foodSheet.slice(1)) {
  const id = num(r[iId]);
  if (id !== null) meta.set(id, { name: String(r[iName] ?? '').trim(), group: String(r[iGroup] ?? '').trim() });
}

const groups: string[] = [];
const foods: [number, string, number, number, number, number, number][] = [];
const dropped: string[] = [];
for (const row of table.slice(4)) {
  const id = num(row[2]);
  if (id === null) continue;
  const m = meta.get(id);
  const [kcal, p, c, f] = [pick(row, C.kcal), pick(row, C.protein), pick(row, C.carbs), pick(row, C.fat)];
  if (!m || !m.name || kcal === null || p === null || c === null || f === null) {
    dropped.push(`${id} ${m?.name ?? '?'} (missing value)`);
    continue;
  }
  if (kcal < 0 || kcal > 900 || p < 0 || c < 0 || f < 0 || p + c + f > 105) {
    dropped.push(`${id} ${m.name} (implausible: ${kcal} kcal, ${p}/${c}/${f} g)`);
    continue;
  }
  let g = groups.indexOf(m.group);
  if (g < 0) g = groups.push(m.group) - 1;
  foods.push([id, m.name, Math.round(kcal), r1(p), r1(c), r1(f), g]);
}
foods.sort((a, b) => a[0] - b[0]);

const out = {
  dataset: {
    id: 'frida',
    name: 'The Danish Food Composition Database, Frida',
    version: '5.5',
    doi: '10.11583/DTU.29500682',
    license: 'CC BY 4.0',
    attribution:
      'Marija Langwagen, Jette Jacobsen, Tue Christensen and Anders Poulsen: The Danish Food Composition Database, Frida version 5.5, November 2025, National Food Institute, Technical University of Denmark. https://doi.org/10.11583/DTU.29500682',
    sourceSha256: createHash('sha256').update(readFileSync(INPUT)).digest('hex'),
    note: 'Per 100 g. Energy, protein and carbohydrate use the label-style (declaration) values where available.',
  },
  groups,
  // [id, name, kcal, protein g, carbs g, fat g, groupIndex] per 100 g
  foods,
};
writeFileSync(OUTPUT, JSON.stringify(out) + '\n');
console.log(`Wrote ${foods.length} foods, ${groups.length} groups to ${OUTPUT}`);
if (dropped.length) console.log(`Dropped ${dropped.length}:\n  ${dropped.slice(0, 25).join('\n  ')}`);
