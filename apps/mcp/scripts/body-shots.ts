// Pictures of the 3D figure in fixed poses and from fixed angles, to compare before and after a change to the body, the hands
// or the highlight. Needs no server: the figure is bundled into one page and drawn by headless Chromium (software WebGL).
// Run: npx tsx scripts/body-shots.ts [name ...]     (no names = all shots; SHOTS_OUT = the folder, default .wrangler/body-shots;
// THEME=dark for the dark theme's colours)
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface Shot {
  name: string;
  /** The movement's library name; none for the figure at ease. */
  exercise?: string;
  /** Where in the movement (0 top, 1 bottom). */
  p?: number;
  muscles?: { primary: string[]; secondary?: string[] };
  heat?: Record<string, number>;
  /** Every part of the muscles in a colour of its own, to check the muscle map. */
  heads?: boolean;
  /** The camera: around the figure and up, in radians (0 is the side, π/2 the front of a standing figure). */
  turn: [number, number];
  /** A close-up: the point looked at (x forward, y up) and the distance. */
  look?: [number, number, number];
}

const FRONT = Math.PI / 2;
const SHOTS: Shot[] = [
  { name: 'rest-front', turn: [FRONT, 0.06], muscles: { primary: ['chest', 'abdominals', 'quadriceps'], secondary: ['shoulders', 'biceps'] } },
  { name: 'rest-back', turn: [-FRONT, 0.06], muscles: { primary: ['lats', 'glutes', 'hamstrings'], secondary: ['traps', 'triceps', 'calves'] } },
  { name: 'heads-front', heads: true, turn: [FRONT, 0.06], look: [0, 0.95, 2.6] },
  { name: 'heads-back', heads: true, turn: [-FRONT, 0.06], look: [0, 0.95, 2.6] },
  { name: 'heads-side', heads: true, turn: [0, 0.06], look: [0, 0.95, 2.6] },
  { name: 'heads-angle', heads: true, turn: [0.8, 0.3], look: [0, 0.95, 2.6] },
  { name: 'heads-back-angle', heads: true, turn: [-2.3, 0.3], look: [0, 0.95, 2.6] },
  { name: 'rest-angle', turn: [0.9, 0.25] },
  { name: 'rest-hands-front', turn: [FRONT, 0.05], look: [0, 0.85, 1.3] },
  { name: 'rest-hands-side', turn: [0.15, 0.05], look: [0, 0.85, 1.3] },
  { name: 'heat', turn: [1.0, 0.15], heat: { chest: 0x2e9a5a, shoulders: 0xd8402a, biceps: 0x6f6a63, abdominals: 0x2e9a5a, quadriceps: 0xd8402a, forearms: 0x6f6a63, adductors: 0x2e9a5a } },
  { name: 'squat', exercise: 'Barbell Squat', p: 1, turn: [Math.PI / 4, 0.3], muscles: { primary: ['quadriceps', 'glutes'], secondary: ['hamstrings', 'lower back'] } },
  { name: 'squat-hands', exercise: 'Barbell Squat', p: 0, turn: [-1.0, 0.3], look: [-0.05, 1.42, 1.3] },
  { name: 'front-squat', exercise: 'Front Barbell Squat', p: 1, turn: [0.5, 0.2] },
  { name: 'front-squat-hands', exercise: 'Front Barbell Squat', p: 0, turn: [1.0, 0.25], look: [0.1, 1.42, 1.4] },
  { name: 'squat-knees', exercise: 'Barbell Squat', p: 1, turn: [0.3, 0.15], look: [0.15, 0.45, 1.6] },
  { name: 'squat-hips-back', exercise: 'Barbell Squat', p: 1, turn: [-2.2, 0.25], look: [-0.15, 0.6, 1.7] },
  { name: 'curl-elbow', exercise: 'Barbell Curl', p: 0, turn: [0.2, 0.1], look: [0.15, 1.2, 1.2] },
  { name: 'lunge-legs', exercise: 'Barbell Lunge', p: 1, turn: [0.2, 0.15], look: [-0.2, 0.45, 2.0] },
  { name: 'deadlift-hands', exercise: 'Barbell Deadlift', p: 0, turn: [1.1, 0.1], look: [0.1, 0.78, 1.2] },
  { name: 'bench', exercise: 'Barbell Bench Press - Medium Grip', p: 0.5, turn: [-Math.PI / 4, 0.3], muscles: { primary: ['chest'], secondary: ['shoulders', 'triceps'] } },
  { name: 'bench-hands', exercise: 'Barbell Bench Press - Medium Grip', p: 0, turn: [-0.5, 0.25], look: [-0.25, 1.25, 1.3] },
  { name: 'press-hands', exercise: 'Standing Military Press', p: 0, turn: [1.1, 0.0], look: [0.05, 2.0, 1.4] },
  { name: 'curl-hands', exercise: 'Barbell Curl', p: 0.5, turn: [0.9, 0.2], look: [0.3, 1.05, 1.3] },
  { name: 'dumbbell-hands', exercise: 'Dumbbell Bicep Curl', p: 0.6, turn: [0.9, 0.15], look: [0.25, 1.15, 1.2] },
  { name: 'pullup-hands-front', exercise: 'Pullups', p: 0.2, turn: [1.2, 0.1], look: [0, 2.25, 1.2] },
  { name: 'pullup-hands-back', exercise: 'Pullups', p: 0.2, turn: [-1.2, 0.2], look: [0, 2.25, 1.2] },
  { name: 'chinup-hands', exercise: 'Chin-Up', p: 0.2, turn: [1.2, 0.1], look: [0, 2.25, 1.2] },
  { name: 'pushup-hands', exercise: 'Pushups', p: 0.5, turn: [0.5, 0.4], look: [1.25, 0.05, 1.5] },
  { name: 'rope-hands', exercise: 'Triceps Pushdown - Rope Attachment', p: 0.5, turn: [0.9, 0.1], look: [0.25, 1.0, 1.3] },
  { name: 'seated-row-hands', exercise: 'Seated Cable Rows', p: 0.5, turn: [0.5, 0.3], look: [0.45, 0.85, 1.3] },
];

const out = resolve(process.env.SHOTS_OUT ?? '.wrangler/body-shots');
mkdirSync(out, { recursive: true });
const wanted = process.argv.slice(2);
const shots = wanted.length ? SHOTS.filter((s) => wanted.includes(s.name)) : SHOTS;
if (!shots.length) throw new Error(`No such shot. Names: ${SHOTS.map((s) => s.name).join(', ')}`);

const js = (await build({ entryPoints: ['dev-host/bodyShots.ts'], bundle: true, format: 'iife', target: 'es2022', write: false, loader: { '.gz': 'binary' } })).outputFiles[0]!.text;
const dark = process.env.THEME === 'dark';
const pagePath = join(out, 'page.html');
writeFileSync(
  pagePath,
  `<!doctype html><meta charset="utf-8"><style>:root{--bg:${dark ? '#1b1a18' : '#faf8f5'};--text:${dark ? '#f2efe9' : '#1f1d1a'}}body{margin:0;background:var(--bg);width:900px}.motion-controls,p{display:none}canvas{display:block;width:100%}</style><body><script>${js.replace(/<\/script/gi, '<\\/script')}</script>`,
);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 680 } });
page.on('console', (m) => m.type() === 'error' && console.error('page:', m.text()));
page.on('pageerror', (e) => console.error('page:', e.message));
await page.goto(pathToFileURL(pagePath).href);
for (const s of shots) {
  // The page's own globals (`showExercise`, `showHeat`, the player's `fitwellMotion`) are reached as text: this file has no DOM types.
  if (s.heads) {
    // Colours far apart for heads next to each other in the list.
    await page.evaluate('showExercise(null)');
    await page.waitForFunction('fitwellMotion.bodyReady()');
    const names = (await page.evaluate('fitwellMotion.heads().map((h) => h.name)')) as string[];
    const hue = (i: number) => {
      const h = (i * 0.381966) % 1;
      const f = (n: number) => {
        const k = (n + h * 12) % 12;
        return Math.round(255 * (0.55 - 0.42 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
      };
      return (f(0) << 16) | (f(8) << 8) | f(4);
    };
    s.heat = Object.fromEntries(names.map((n, i) => [n, hue(i)]));
  }
  await page.evaluate(`(${s.heat ? `showHeat(${JSON.stringify(s.heat)})` : `showExercise(${JSON.stringify(s.exercise ?? null)}, ${JSON.stringify(s.muscles?.primary ?? [])}, ${JSON.stringify(s.muscles?.secondary ?? [])})`})`);
  await page.waitForFunction('fitwellMotion.bodyReady()');
  await page.evaluate(`(() => { ${s.exercise ? `fitwellMotion.seek(${s.p ?? 0.5});` : ''} fitwellMotion.rotate(${s.turn[0]}, ${s.turn[1]}); fitwellMotion.look(${(s.look ?? []).join(', ')}); })()`);
  await page.waitForTimeout(120);
  await page.screenshot({ path: join(out, `${s.name}.png`) });
  console.log(join(out, `${s.name}.png`));
}
await browser.close();
