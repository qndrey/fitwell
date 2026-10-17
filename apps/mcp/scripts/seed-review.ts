// Fills the directory reviewers' demo account with 12 weeks of history, then writes it as SQL for D1.
// Usage (from the repo root):
//   npm run seed:review -w @fitwell/mcp                          write .wrangler/review-seed.sql only
//   npm run seed:review -w @fitwell/mcp -- --apply local         and load it into the local dev database
//   npm run seed:review -w @fitwell/mcp -- --apply remote        and load it into the deployed database
//   ... -- --email someone@example.com                           another address (default review@fitwell.fyi)
//   ... -- --email dev@localhost --apply local                   the local dev user, for screenshots in the dev host
//
// The history is built by calling Fitwell's own tools in-process, against a throwaway SQLite copy of the schema,
// so every row went through the same validation as a real person's. The SQL then replaces only that address's
// rows: the account is invited if it doesn't exist and keeps its id if it does (its sign-ins stay valid), so
// running it again before each review resets the demo. Dates are relative to today, so the dashboard, the
// weekly review and the meal plan always show the current weeks. Sign-in for this address is REVIEW_LOGIN
// (see REVIEW.md); the account must not be in ADMIN_EMAILS.
import { addDays, dayDiff } from '@fitwell/core/domain/dates';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { todayIn } from '../src/data/time';
import { createTestEnv } from '../tests/support/env';
import { call, connectAs, signedInUser } from '../tests/support/mcp';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const EMAIL = (flag('email') ?? 'review@fitwell.fyi').trim().toLowerCase();
const APPLY = flag('apply');
// Run through npm (the script is bundled first), so the working directory is apps/mcp.
const MCP_DIR = process.cwd();
if (!existsSync(join(MCP_DIR, 'wrangler.jsonc'))) {
  console.error('Run it with npm run seed:review -w @fitwell/mcp (from the repo root).');
  process.exit(1);
}
const OUT = flag('out') ?? join(MCP_DIR, '.wrangler/review-seed.sql');
// Strict shape check; the address also goes into the SQL.
// dev@localhost is the local dev user (DEV_UNAUTHENTICATED), for screenshots through the dev host; never remote.
const DEV_USER = EMAIL === 'dev@localhost' && APPLY !== 'remote';
if ((!DEV_USER && !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(EMAIL)) || (APPLY && !['local', 'remote'].includes(APPLY))) {
  console.error('Usage: npm run seed:review -w @fitwell/mcp -- [--email review@fitwell.fyi] [--apply local|remote] [--out file.sql]');
  process.exit(1);
}

const TZ = 'Europe/Copenhagen';
const WEEKS = 12;
const TODAY = todayIn(TZ);
const START = addDays(TODAY, -(WEEKS * 7 - 1));

// A seeded random source, so every run tells the same story (the same days skipped, the same noise).
let seed = 20261016;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
const round = (x: number, step: number) => Math.round(x / step) * step;
const jitter = (x: number, spread: number) => x + (rand() * 2 - 1) * spread;

const { env } = createTestEnv();
const user = await signedInUser(env, EMAIL);
const client = await connectAs(env, user);

async function tool(name: string, input: Record<string, unknown>) {
  const res = await call(client, name, input);
  if (res.isError) throw new Error(`${name} failed: ${res.text}\n${JSON.stringify(input)}`);
  return res.data;
}

// --- Who they are --------------------------------------------------------------------------------------------
await tool('update_profile', {
  time_zone: TZ,
  sex: 'male',
  birth_year: 1990,
  height_cm: 180,
  weight_kg: 84,
  activity_level: 'moderate',
  equipment: ['barbell', 'dumbbell', 'cable', 'machine', 'body only'],
  bar_kg: 20,
  diet: { preferences: ['high protein'], allergies: ['peanuts'], dislikes: ['olives'] },
});
await tool('set_goals', { kcal: 2300, protein_g: 150, carbs_g: 250, fat_g: 75, workouts_per_week: 3, goal_weight_kg: 78 });

// --- Foods: Frida ids found through search_foods by their exact name, so the seed follows the bundled data -------
async function food(name: string) {
  const { foods } = (await tool('search_foods', { query: name, limit: 25 })) as { foods: { id: string; name: string }[] };
  const hit = foods.find((f) => f.name === name);
  if (!hit) throw new Error(`No food named "${name}"; search found: ${foods.map((f) => f.name).join('; ')}`);
  return hit.id;
}
const F = {
  oats: await food('Oats, rolled, average values'),
  milk: await food('Milk, skimmed'),
  banana: await food('Banana, raw'),
  skyr: await food('Skyr, 0.2 % fat'),
  blueberries: await food('Blueberries, raw'),
  egg: await food('Eggs, chicken, free-range (outdoor) hens, raw'),
  rye: await food('Rye bread, dark, industrially produced'),
  chicken: await food('Chicken, breast, flesh and skin, raw'),
  rice: await food('Rice, polished, raw'),
  broccoli: await food('Broccoli, raw'),
  salmon: await food('Salmon, Atlantic, wild, raw'),
  potato: await food('Potato, raw'),
  spinach: await food('Spinach, raw'),
  beef: await food('Beef, mince, 10-15% fat, raw'),
  pasta: await food('Pasta, raw'),
  tomato: await food('Tomato, peeled, canned'),
  apple: await food('Apple, raw, all varieties'),
  almonds: await food('Almond, raw'),
  oil: await food('Olive oil'),
};

// --- Recipes (the three from the screenshots, plus one) --------------------------------------------------------
await tool('save_recipe', {
  name: 'Overnight oats with berries',
  servings: 1,
  ingredients: [{ food_id: F.oats, grams: 80 }, { food_id: F.milk, grams: 200 }, { food_id: F.skyr, grams: 100 }, { food_id: F.blueberries, grams: 80 }],
  steps: ['Stir the oats, milk and skyr together in a jar.', 'Top with the berries, close and leave in the fridge overnight.'],
});
await tool('save_recipe', {
  name: 'Chicken, rice and broccoli',
  servings: 1,
  ingredients: [{ food_id: F.chicken, grams: 180 }, { food_id: F.rice, grams: 75 }, { food_id: F.broccoli, grams: 150 }, { food_id: F.oil, grams: 5 }],
  steps: ['Cook the rice.', 'Fry the chicken in the oil, about 6 minutes a side.', 'Steam the broccoli for 4 minutes and serve together.'],
});
await tool('save_recipe', {
  name: 'Salmon with potatoes and spinach',
  servings: 1,
  ingredients: [{ food_id: F.salmon, grams: 150 }, { food_id: F.potato, grams: 250 }, { food_id: F.spinach, grams: 100 }],
  steps: ['Boil the potatoes for 20 minutes.', 'Bake the salmon at 200 °C for 12 minutes.', 'Wilt the spinach in the pan and serve.'],
});
await tool('save_recipe', {
  name: 'Pasta bolognese',
  servings: 4,
  ingredients: [{ food_id: F.beef, grams: 500 }, { food_id: F.pasta, grams: 400 }, { food_id: F.tomato, grams: 800 }, { food_id: F.oil, grams: 15 }],
  notes: 'Freezes well.',
  steps: ['Brown the mince in the oil.', 'Add the tomatoes and simmer for 30 minutes.', 'Cook the pasta and serve with the sauce.'],
});

// --- 12 weeks of eating, weighing in, sleeping and walking ------------------------------------------------------
type Item = Record<string, unknown>;
const breakfasts: Item[][] = [
  [{ recipe: 'Overnight oats with berries' }],
  [{ food_id: F.oats, grams: 80 }, { food_id: F.milk, grams: 280 }, { food_id: F.banana, grams: 120 }],
  [{ food_id: F.egg, grams: 150 }, { food_id: F.rye, grams: 100 }],
];
const lunches: Item[][] = [[{ recipe: 'Chicken, rice and broccoli', servings: 1.5 }], [{ food_id: F.rye, grams: 120 }, { food_id: F.egg, grams: 100 }, { food_id: F.skyr, grams: 170 }]];
const dinners: Item[][] = [[{ recipe: 'Salmon with potatoes and spinach' }], [{ recipe: 'Pasta bolognese', servings: 1.2 }], [{ recipe: 'Chicken, rice and broccoli' }]];
const snacks: Item[][] = [[{ food_id: F.skyr, grams: 170 }], [{ food_id: F.apple, grams: 150 }, { food_id: F.almonds, grams: 30 }], [{ food_id: F.banana, grams: 120 }]];
const scale = (items: Item[], f: number) =>
  items.map((i) => (i.grams ? { ...i, grams: round((i.grams as number) * f, 5) } : { ...i, servings: Math.round(((i.servings as number | undefined) ?? 1) * f * 10) / 10 }));

const days = Array.from({ length: WEEKS * 7 }, (_, i) => addDays(START, i));
let fullDays = 0;
for (const day of days) {
  const isToday = day === TODAY;
  const r = rand();
  // About 85 % of days fully logged, some half logged (the energy estimate leaves those out), a few not at all.
  const slots = isToday ? ['breakfast', 'lunch'] : r < 0.85 ? ['breakfast', 'lunch', 'dinner', 'snacks'] : r < 0.95 ? ['breakfast', 'lunch'] : [];
  if (slots.length === 4) fullDays++;
  const portion = jitter(1.27, 0.12); // about the 2,300 kcal goal on a fully logged day
  const menu: Record<string, Item[]> = { breakfast: pick(breakfasts), lunch: pick(lunches), dinner: pick(dinners), snacks: pick(snacks) };
  for (const slot of slots) await tool('log_food', { day, slot, items: scale(menu[slot]!, portion) });

  // Weight: 84 kg down to about 79.6 kg, with day-to-day water swings; weighed in on 6 days out of 7.
  const t = dayDiff(START, day) / (WEEKS * 7 - 1);
  const body: Record<string, unknown> = { day };
  if (rand() < 0.86 || isToday) body.weight_kg = Math.round(jitter(84 - 4.4 * t, 0.35) * 10) / 10;
  // Sleep, steps and water over the last 30 days only (people start logging these later).
  if (dayDiff(day, TODAY) < 30) Object.assign(body, { sleep_hours: Math.round(jitter(7, 0.8) * 4) / 4, steps: Math.round(jitter(8500, 2500)), water_ml: round(jitter(2000, 400), 250) });
  // Waist and hips every other Sunday.
  if (new Date(`${day}T12:00:00Z`).getUTCDay() === 0 && dayDiff(START, day) % 14 < 7) body.measurements = { waist: Math.round((92 - 4 * t) * 10) / 10, hips: Math.round((101 - 2 * t) * 10) / 10 };
  if (Object.keys(body).length > 1) await tool('log_body', body);
}

// --- Training: three sessions a week, A and B alternating, with a steady progression --------------------------
const A = (w: number) => [
  { id: 'ex:Barbell_Squat', sets: [5, 5, 5].map((reps) => ({ reps, weight_kg: round(85 + 17.5 * w, 2.5) })) },
  { id: 'ex:Barbell_Bench_Press_-_Medium_Grip', sets: [8, 8, 8].map((reps) => ({ reps, weight_kg: round(60 + 10 * w, 2.5) })) },
  { id: 'ex:Pullups', sets: [6 + Math.round(2 * w), 6 + Math.round(2 * w), 6].map((reps) => ({ reps, weight_kg: 0 })) },
];
const B = (w: number) => [
  { id: 'ex:Barbell_Deadlift', sets: [5, 5].map((reps) => ({ reps, weight_kg: round(100 + 20 * w, 2.5) })) },
  { id: 'ex:Standing_Military_Press', sets: [8, 8, 8].map((reps) => ({ reps, weight_kg: round(37.5 + 7.5 * w, 2.5) })) },
  { id: 'ex:Bent_Over_Barbell_Row', sets: [10, 10, 10].map((reps) => ({ reps, weight_kg: round(50 + 10 * w, 2.5) })) },
  { id: 'ex:Barbell_Curl', sets: [10, 10].map((reps) => ({ reps, weight_kg: round(25 + 5 * w, 2.5) })) },
];
let workouts = 0;
for (const day of days) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay(); // 1 Monday, 3 Wednesday, 5 Friday, 6 Saturday
  const w = dayDiff(START, day) / (WEEKS * 7 - 1);
  if ([1, 3, 5].includes(weekday) && day !== TODAY && rand() < 0.92) {
    const isA = workouts % 2 === 0;
    await tool('log_past_workout', {
      day,
      name: isA ? 'Workout A' : 'Workout B',
      minutes: Math.round(jitter(55, 8)),
      exercises: (isA ? A : B)(w),
      ...(isA ? { cardio: [{ activity_id: 'act:row-machine', minutes: 5, when: 'before' }] } : {}),
    });
    workouts++;
  }
  if (weekday === 6 && dayDiff(START, day) % 14 >= 7) await tool('log_cardio', { day, activity_id: 'act:run-10', duration_min: 30, distance_km: 5 });
}
await tool('save_workout_template', {
  name: 'Workout A',
  exercises: [
    { id: 'ex:Barbell_Squat', sets: 3, reps: 5, rest_sec: 150 },
    { id: 'ex:Barbell_Bench_Press_-_Medium_Grip', sets: 3, reps: 8, rest_sec: 120, notes: 'Pause on the chest' },
    { id: 'ex:Pullups', sets: 3, reps: 8, rest_sec: 90 },
  ],
  cardio: [{ activity_id: 'act:row-machine', minutes: 5, when: 'before' }],
});
await tool('save_workout_template', {
  name: 'Workout B',
  exercises: [
    { id: 'ex:Barbell_Deadlift', sets: 2, reps: 5, rest_sec: 180 },
    { id: 'ex:Standing_Military_Press', sets: 3, reps: 8, rest_sec: 120 },
    { id: 'ex:Bent_Over_Barbell_Row', sets: 3, reps: 10, rest_sec: 90 },
    { id: 'ex:Barbell_Curl', sets: 2, reps: 10, rest_sec: 60, superset: 'A' },
    { id: 'ex:Triceps_Pushdown', sets: 2, reps: 12, rest_sec: 60, superset: 'A' },
  ],
});

// --- Meal plans for this week and the next (Fitwell shows next week's from Saturday), with a few groceries ticked --
const monday = addDays(TODAY, -((new Date(`${TODAY}T12:00:00Z`).getUTCDay() + 6) % 7));
for (const weekStart of [monday, addDays(monday, 7)]) {
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  await tool('save_meal_plan', {
    week_start: weekStart,
    items: week.flatMap((day, i) => [
      { day, slot: 'breakfast', recipe_name: 'Overnight oats with berries' },
      { day, slot: 'lunch', recipe_name: 'Chicken, rice and broccoli', servings: 1.5 },
      { day, slot: 'dinner', recipe_name: i % 2 ? 'Pasta bolognese' : 'Salmon with potatoes and spinach', ...(i % 2 ? { servings: 1.2 } : {}) },
      { day, slot: 'snacks', food_id: F.skyr, grams: 170 },
    ]),
  });
  const grocery = (await call(client, 'show_grocery_list', { week_start: weekStart })).text;
  const keys = [...grocery.matchAll(/"key":"([^"]+)"/g)].map((m) => m[1]!);
  if (!keys.length) throw new Error(`No grocery items for ${weekStart}: ${grocery.slice(0, 200)}`);
  for (const key of keys.slice(0, 3)) await tool('set_grocery_checked', { week_start: weekStart, key, checked: true });
}

// --- Write the account as SQL ------------------------------------------------------------------------------------
const TABLES = ['profiles', 'goals', 'custom_foods', 'recipes', 'food_entries', 'weights', 'measurements', 'daily_metrics', 'workout_templates', 'workouts', 'meal_plans', 'grocery_ticks'];
const lit = (v: unknown) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' || typeof v === 'bigint' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const who = `(SELECT id FROM users WHERE email = ${lit(EMAIL)})`;
const lines = [
  `-- Fitwell reviewer demo account ${EMAIL}, generated ${new Date().toISOString()} by scripts/seed-review.ts (history ${START} to ${TODAY}).`,
  `INSERT INTO users (id, email, status, created_at) VALUES (${lit(crypto.randomUUID())}, ${lit(EMAIL)}, 'invited', ${Date.now()}) ON CONFLICT (email) DO NOTHING;`,
  ...TABLES.map((t) => `DELETE FROM ${t} WHERE user_id = ${who};`),
];
let rows = 0;
for (const t of TABLES) {
  const { results } = await env.DB.prepare(`SELECT * FROM ${t} WHERE user_id = ?`).bind(user.id).all<Record<string, unknown>>();
  for (const row of results) {
    const cols = Object.keys(row); // quoted: measurements has a column named values
    lines.push(`INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((c) => (c === 'user_id' ? who : lit(row[c]))).join(', ')});`);
    rows++;
  }
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join('\n') + '\n');
console.log(`${EMAIL}: ${days.length} days (${fullDays} fully logged), ${workouts} workouts, ${rows} rows → ${OUT}`);

if (APPLY) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'fitwell', `--${APPLY}`, '--file', OUT, '--yes'], { stdio: 'inherit', cwd: MCP_DIR });
  console.log(DEV_USER ? 'Loaded into the local database: npm run dev:mcp and npm run dev:host show it.' : `Loaded into the ${APPLY} database. Sign in as ${EMAIL} with the REVIEW_LOGIN code.`);
}
