import type { Client } from '@modelcontextprotocol/client';
import type { OffClient } from '@fitwell/core/off/client';
import type { Candidate } from '@fitwell/core/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { rankCookable } from '../src/planning/cookable';
import { parseRecipePage, checkRecipeUrl, fetchPage } from '../src/recipes/parse';
import { allergenTags, checkAllergens } from '../src/safety/allergens';
import type { User } from '../src/data/users';
import { createTestEnv } from './support/env';
import { call, connectAs, jsonInText, signedInUser } from './support/mcp';

let env: Env;
let ana: User;
let client: Client;
beforeEach(async () => {
  env = createTestEnv().env;
  ana = await signedInUser(env, 'ana@example.com');
  client = await connectAs(env, ana);
});

const RYE = 'frida:413'; // 209 kcal and 5.8 g protein per 100 g

describe('allergens', () => {
  it('maps what people write to the 14 allergen groups', () => {
    expect(allergenTags('lactose')).toEqual(['milk']);
    expect(allergenTags('Tree nuts')).toEqual(['nuts']);
    expect(allergenTags('peanut')).toEqual(['peanuts']);
    expect(allergenTags('shellfish').sort()).toEqual(['crustaceans', 'molluscs']);
    expect(allergenTags('cats')).toEqual([]);
  });

  it('separates contains, traces and unknown', () => {
    expect(checkAllergens(['lactose'], { allergens: ['milk'], traces: [] })).toEqual({ contains: ['milk'], traces: [], unknown: false });
    expect(checkAllergens(['nuts'], { allergens: ['milk'], traces: ['nuts'] })).toEqual({ contains: [], traces: ['nuts'], unknown: false });
    expect(checkAllergens(['milk'], {}).unknown).toBe(true);
  });

  const skyr: Candidate = { source: 'off', sourceId: '5701234567899', name: 'Skyr Natural', brand: 'Arla', per100g: { kcal: 63, protein: 11, carbs: 4, fat: 0.2 }, portions: [], allergens: ['milk'], traces: ['nuts'] };
  const unknownPack: Candidate = { source: 'off', sourceId: '4001686301050', name: 'Mystery bar', per100g: { kcal: 400, protein: 5, carbs: 50, fat: 20 }, portions: [] };
  const off: OffClient = { search: async () => [skyr], product: async (code) => (code === skyr.sourceId ? skyr : code === unknownPack.sourceId ? unknownPack : null) };

  it('warns when logging a packaged food with an allergen or trace, and when the name matches', async () => {
    const c = await connectAs(env, ana, off);
    await call(c, 'update_profile', { diet: { allergies: ['lactose', 'tree nuts', 'rye'] } });
    const res = await call(c, 'log_food', { items: [{ food_id: 'off:5701234567899', grams: 150 }, { food_id: RYE, grams: 50 }] });
    expect(res.isError, res.text).toBe(false);
    const warnings = res.data.allergyWarnings as string[];
    expect(warnings).toContain('ALLERGY: Skyr Natural contains milk.');
    expect(warnings).toContain('ALLERGY (may contain traces): Skyr Natural may contain traces of nuts.');
    expect(warnings.some((w) => w.includes('Rye bread') && w.includes('rye'))).toBe(true);
    const clean = await call(c, 'update_profile', { diet: { allergies: ['sesame'] } }).then(() => call(c, 'log_food', { items: [{ food_id: 'off:5701234567899', grams: 100 }] }));
    expect(clean.data.allergyWarnings).toBeUndefined();
  });

  it('stops a meal plan on a packaged food that lists the allergen, and notes foods with no allergen data', async () => {
    const c = await connectAs(env, ana, off);
    await call(c, 'update_profile', { diet: { allergies: ['milk'] } });
    const res = await call(c, 'save_meal_plan', { week_start: '2026-10-19', items: [{ day: '2026-10-19', slot: 'breakfast', food_id: 'off:5701234567899', grams: 200 }, { day: '2026-10-20', slot: 'snacks', food_id: 'off:4001686301050', grams: 40 }] });
    expect(res.data.ok).toBe(false);
    expect((res.data.problems as string[]).some((p) => p.startsWith('ALLERGY: Skyr Natural') && p.includes('milk'))).toBe(true);
    expect((res.data.notes as string[]).join(' ')).toContain('No allergen data for the packaged food Mystery bar');
  });
});

describe('daily metrics', () => {
  it('keeps sleep, steps and water per day, adds water a glass at a time, and shows them in progress and export', async () => {
    const day = '2026-10-12';
    await call(client, 'log_body', { day, sleep_hours: 7.5, steps: 8000 });
    await call(client, 'log_body', { day, add_water_ml: 250 });
    const third = await call(client, 'log_body', { day, add_water_ml: 500 });
    expect(third.data.logged).toMatchObject({ day, sleepHours: 7.5, steps: 8000, waterMl: 750 });
    await call(client, 'log_body', { day, water_ml: 2000 }); // replaces the total
    await call(client, 'log_body', { day: '2026-10-13', sleep_hours: 6.5 });
    const p = (await call(client, 'get_progress', { days: 30, to: '2026-10-13' })).data as { dailyMetrics: Record<string, number> };
    expect(p.dailyMetrics).toMatchObject({ sleepAverageHours: 7, nightsLogged: 2, stepsAverage: 8000, waterAverageMl: 2000 });
    const exported = (await call(client, 'export_my_data', {})).data as { dailyMetrics: { day: string; waterMl?: number }[] };
    expect(exported.dailyMetrics.find((m) => m.day === day)?.waterMl).toBe(2000);
  });

  it('validates, is private, and can be deleted', async () => {
    expect((await call(client, 'log_body', {})).isError).toBe(true);
    expect((await call(client, 'log_body', { water_ml: 100, add_water_ml: 100 })).isError).toBe(true);
    expect((await call(client, 'log_body', { sleep_hours: 30 })).isError).toBe(true);
    await call(client, 'log_body', { day: '2026-10-12', steps: 5000 });
    const bo = await connectAs(env, await signedInUser(env, 'bo@example.com'));
    expect((await call(bo, 'delete_item', { kind: 'daily_metrics', day: '2026-10-12' })).isError).toBe(true);
    expect((await call(client, 'delete_item', { kind: 'daily_metrics', day: '2026-10-12' })).data.deleted).toEqual({ kind: 'daily_metrics', day: '2026-10-12' });
  });

  it('draws measurement series for the dashboard', async () => {
    await call(client, 'log_body', { day: '2026-10-01', measurements: { waist: 86 } });
    await call(client, 'log_body', { day: '2026-10-13', measurements: { waist: 84.5 } });
    const res = await client.callTool({ name: 'show_dashboard', arguments: { days: 30 } });
    const types = (res.structuredContent as { progress: { measurements: { types: { key: string; points: { value: number }[] }[] } } }).progress.measurements.types;
    expect(types.find((t) => t.key === 'waist')!.points.map((p) => p.value)).toEqual([86, 84.5]);
  });
});

describe('weekly review', () => {
  const WEEK = '2026-09-28'; // Monday; the week before is 2026-09-21
  async function seed() {
    await call(client, 'set_goals', { kcal: 2000, protein_g: 120, workouts_per_week: 3 });
    // Last week: two logged days. This week: five logged days, 960 g rye = 2006 kcal, 55 g protein.
    for (const d of ['2026-09-22', '2026-09-23']) await call(client, 'log_food', { day: d, items: [{ food_id: RYE, grams: 500 }] });
    for (const d of ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']) await call(client, 'log_food', { day: d, items: [{ food_id: RYE, grams: 960 }] });
    for (const [d, kg] of [['2026-09-22', 84], ['2026-09-24', 84], ['2026-09-26', 83.8], ['2026-09-28', 83.6], ['2026-09-30', 83.2], ['2026-10-02', 83]] as const) await call(client, 'log_body', { day: d, weight_kg: kg });
    await call(client, 'log_body', { day: '2026-09-29', sleep_hours: 6 });
    await call(client, 'log_cardio', { activity_id: 'act:run-10', duration_min: 30, day: '2026-09-30' });
  }

  it('compares the week with the one before and says what to consider', async () => {
    await seed();
    const res = await call(client, 'show_weekly_review', { week_start: WEEK });
    expect(res.isError).toBe(false);
    const r = (res.data as unknown as { review: import('../src/analytics/reviewTypes').WeekReview }).review;
    expect(r).toMatchObject({ weekStart: WEEK, weekEnd: '2026-10-04', inProgress: false, daysCounted: 7 });
    expect(r.nutrition).toMatchObject({ daysLogged: 5, kcalWithin10Pct: 5 });
    expect(r.nutrition.average!.kcal).toBe(2006);
    expect(r.nutrition.previousAverage!.kcal).toBe(1045);
    expect(r.training).toMatchObject({ cardio: 1, strength: 0, previousSessions: 0, goalPerWeek: 3 });
    expect(r.weight.weighIns).toBe(3);
    expect(r.habits.sleepHours).toBe(6);
    const text = r.suggestions.join('\n');
    expect(text).toContain('Protein averaged 56 g'); // 55.7 g
    expect(text).toContain('1 of 3 planned workouts');
    expect(text).toContain('Sleep averaged 6 h');
    // The model gets the same numbers as text; the view gets the structured review.
    expect(res.text).toContain('The weekly review is open.');
  });

  it('lists a new record in Training only, not again under what went well', async () => {
    const bench = 'ex:Barbell_Bench_Press_-_Medium_Grip';
    await call(client, 'log_past_workout', { day: '2026-09-22', exercises: [{ id: bench, sets: [{ reps: 5, weight_kg: 60 }] }] });
    await call(client, 'log_past_workout', { day: '2026-09-30', exercises: [{ id: bench, sets: [{ reps: 5, weight_kg: 65 }] }] });
    const r = ((await call(client, 'show_weekly_review', { week_start: WEEK })).data as unknown as { review: import('../src/analytics/reviewTypes').WeekReview }).review;
    expect(r.training.records).toHaveLength(1);
    expect(r.training.records[0]).toMatchObject({ name: 'Barbell Bench Press - Medium Grip' });
    expect(r.highlights.join('\n')).not.toMatch(/1RM|Bench/);
  });

  it('lists every counted day for the week strip', async () => {
    await seed();
    const r = ((await call(client, 'show_weekly_review', { week_start: WEEK })).data as unknown as { review: import('../src/analytics/reviewTypes').WeekReview }).review;
    expect(r.days.map((d) => d.day)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(r.days[0]).toEqual({ day: '2026-09-28', kcal: 2006, proteinG: 55.7, workout: null, weighIn: 83.6 });
    expect(r.days[2]).toMatchObject({ workout: 'cardio', weighIn: 83.2 });
    expect(r.days[5]).toEqual({ day: '2026-10-03', kcal: null, proteinG: null, workout: null, weighIn: null });
  });

  it('shows the heaviest workout of a day, and every workout in the progress days', async () => {
    const bench = 'ex:Barbell_Bench_Press_-_Medium_Grip';
    await call(client, 'log_cardio', { activity_id: 'act:run-10', duration_min: 20, day: '2026-09-29' });
    await call(client, 'log_past_workout', { day: '2026-09-29', exercises: [{ id: bench, sets: [{ reps: 5, weight_kg: 60 }] }] });
    const r = ((await call(client, 'show_weekly_review', { week_start: WEEK })).data as unknown as { review: import('../src/analytics/reviewTypes').WeekReview }).review;
    expect(r.days[1]!.workout).toBe('strength');
    const p = ((await call(client, 'get_dashboard_data', { days: 90 })).data as unknown as { progress: { training: { days: { day: string; type: string }[] } } }).progress;
    expect(p.training.days.filter((d) => d.day === '2026-09-29').map((d) => d.type).sort()).toEqual(['cardio', 'strength']);
  });

  it('counts the days the protein goal was reached', async () => {
    await seed();
    const r = ((await call(client, 'show_weekly_review', { week_start: WEEK })).data as unknown as { review: import('../src/analytics/reviewTypes').WeekReview }).review;
    expect(r.nutrition.goals.proteinG).toBe(120);
    expect(r.nutrition.proteinReached).toBe(0); // 55 g a day against 120 g
    expect(r.nutrition.daysLogged).toBe(5);
  });

  it('navigates weeks for the view, and rejects non-Mondays and weeks that have not started', async () => {
    const hidden = (await client.listTools()).tools.find((t) => t.name === 'get_review_data')!;
    expect((hidden._meta as { ui?: { visibility?: string[] } }).ui?.visibility).toEqual(['app']);
    expect((await call(client, 'get_review_data', { week_start: WEEK })).isError).toBe(false);
    expect((await call(client, 'show_weekly_review', { week_start: '2026-09-29' })).isError).toBe(true);
    expect((await call(client, 'show_weekly_review', { week_start: '2099-01-05' })).isError).toBe(true);
    expect((await call(client, 'show_weekly_review', {})).isError).toBe(false); // the default week
  });

  it('serves the review and shopping views as self-contained HTML', async () => {
    for (const uri of ['ui://fitwell/review.html', 'ui://fitwell/shopping.html']) {
      const item = (await client.readResource({ uri })).contents[0] as { mimeType?: string; text?: string };
      expect(item.mimeType).toBe('text/html;profile=mcp-app');
      expect(item.text).not.toMatch(/<script[^>]+src=|<link[^>]+stylesheet| style="/);
    }
  });
});

describe('shopping checklist', () => {
  const WEEK = '2026-10-19';
  type Shopping = { weekStart: string; sections: { aisle: string; items: { key: string; name: string; checked: boolean }[] }[]; leftToBuy: number; itemCount: number };
  const open = async (c: Client = client) => ((await c.callTool({ name: 'show_grocery_list', arguments: { week_start: WEEK } })).structuredContent as { shopping: Shopping }).shopping;
  const items = (s: Shopping) => s.sections.flatMap((x) => x.items);

  beforeEach(async () => {
    await call(client, 'save_meal_plan', { week_start: WEEK, items: [{ day: WEEK, slot: 'lunch', food_id: RYE, grams: 200 }, { day: '2026-10-20', slot: 'lunch', food_id: 'frida:754', grams: 300 }] });
  });

  it('opens with every item unticked, remembers ticks, and keeps them when the list is built again', async () => {
    const first = await open();
    expect(first.leftToBuy).toBe(first.itemCount);
    const rye = items(first).find((i) => i.key === RYE)!;
    expect(rye.checked).toBe(false);
    expect((await call(client, 'set_grocery_checked', { week_start: WEEK, key: RYE, checked: true })).data).toMatchObject({ ok: true, ticked: 1 });
    const again = await open();
    expect(items(again).find((i) => i.key === RYE)!.checked).toBe(true);
    expect(again.leftToBuy).toBe(first.leftToBuy - 1);
    const text = (await call(client, 'show_grocery_list', { week_start: WEEK })).text;
    expect(text).toContain('[x] Rye bread');
    await call(client, 'set_grocery_checked', { week_start: WEEK, key: RYE, checked: false });
    expect(items(await open()).every((i) => !i.checked)).toBe(true);
  });

  it('clears all ticks, keeps them private, and hides the tick tool from the model', async () => {
    await call(client, 'set_grocery_checked', { week_start: WEEK, key: RYE, checked: true });
    const bo = await connectAs(env, await signedInUser(env, 'bo@example.com'));
    await call(bo, 'save_meal_plan', { week_start: WEEK, items: [{ day: WEEK, slot: 'lunch', food_id: RYE, grams: 100 }] });
    expect(items(await open(bo)).every((i) => !i.checked)).toBe(true);
    await call(client, 'set_grocery_checked', { week_start: WEEK, clear: true });
    expect(items(await open()).every((i) => !i.checked)).toBe(true);
    expect((await call(client, 'set_grocery_checked', { week_start: WEEK })).isError).toBe(true);
    const tool = (await client.listTools()).tools.find((t) => t.name === 'set_grocery_checked')!;
    expect((tool._meta as { ui?: { visibility?: string[] } }).ui?.visibility).toEqual(['app']);
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM grocery_ticks WHERE user_id = ?').bind(ana.id).first<{ n: number }>();
    expect(left!.n).toBe(0);
  });
});

const RECIPE_PAGE = `<html><head><title>x</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Site"},{"@type":["Recipe"],"name":"Chicken &amp; rice","recipeYield":["4","4 servings"],"totalTime":"PT1H15M",
"recipeIngredient":["600 g chicken breast","280 g rice","1 tbsp olive oil &#8211; for the pan"],
"recipeInstructions":[{"@type":"HowToSection","itemListElement":[{"@type":"HowToStep","text":"Bake the chicken."}]},{"@type":"HowToStep","text":"Boil the <b>rice</b>."}]}]}</script>
</head><body></body></html>`;

describe('recipes from the web', () => {
  it('reads schema.org recipe data, including graphs, sections and escaped text', () => {
    expect(parseRecipePage(RECIPE_PAGE)).toEqual({
      name: 'Chicken & rice',
      servings: 4,
      ingredientLines: ['600 g chicken breast', '280 g rice', '1 tbsp olive oil – for the pan'],
      steps: ['Bake the chicken.', 'Boil the rice.'],
      totalMinutes: 75,
    });
    expect(parseRecipePage('<html><body>no data</body></html>')).toBeNull();
    expect(parseRecipePage('<script type="application/ld+json">{broken</script>')).toBeNull();
  });

  it('only opens public https pages', () => {
    for (const bad of ['http://example.com/r', 'https://localhost/r', 'https://192.168.1.2/r', 'https://user:pw@example.com/r', 'https://example.com:8443/r', 'https://intranet/r', 'https://printer.local/r', 'not a url']) expect(typeof checkRecipeUrl(bad)).toBe('string');
    expect(checkRecipeUrl('https://www.example.com/recipes/1')).toBeInstanceOf(URL);
  });

  const page = (body: string, init: ResponseInit & { url?: string } = {}) => async () => {
    const res = new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });
    if (init.url) Object.defineProperty(res, 'url', { value: init.url });
    return res;
  };

  it('imports a recipe through the tool, then saves it with its steps and source', async () => {
    const c = await connectAs(env, ana, undefined, { fetch: page(RECIPE_PAGE) as unknown as typeof fetch });
    const res = await call(c, 'import_recipe', { url: 'https://www.example.com/chicken' });
    expect(res.isError).toBe(false);
    expect(res.data.recipe).toMatchObject({ name: 'Chicken & rice', servings: 4 });
    const saved = await call(c, 'save_recipe', { name: 'Chicken & rice', servings: 4, ingredients: [{ food_id: RYE, grams: 100 }], steps: ['Bake the chicken.'], source_url: 'https://www.example.com/chicken' });
    expect(saved.isError, saved.text).toBe(false);
    const got = (await call(c, 'get_recipes', { name: 'chicken & rice' })).data.recipe as { steps: string[]; sourceUrl: string };
    expect(got).toMatchObject({ steps: ['Bake the chicken.'], sourceUrl: 'https://www.example.com/chicken' });
  });

  it('explains failures instead of throwing', async () => {
    const none = await connectAs(env, ana, undefined, { fetch: page('<html></html>') as unknown as typeof fetch });
    expect((await call(none, 'import_recipe', { url: 'https://www.example.com/x' })).text).toContain('paste the recipe text');
    expect((await call(none, 'import_recipe', { url: 'http://www.example.com/x' })).text).toContain('https');
    const down = await connectAs(env, ana, undefined, { fetch: page('nope', { status: 503 }) as unknown as typeof fetch });
    expect((await call(down, 'import_recipe', { url: 'https://www.example.com/x' })).text).toContain('503');
    const pdf = await fetchPage(new URL('https://www.example.com/x.pdf'), page('%PDF', { headers: { 'content-type': 'application/pdf' } }) as unknown as typeof fetch, 'test');
    expect(pdf).toBe('That address is not a web page.');
    const redirected = await fetchPage(new URL('https://www.example.com/x'), page('<html></html>', { url: 'http://10.0.0.1/inside' }) as unknown as typeof fetch, 'test');
    expect(redirected).toContain('redirected');
  });
});

describe('what can I cook', () => {
  it('ranks saved recipes by what is at home, ignoring staples, and fits them to the calories left', async () => {
    const pick = async (q: string) => (((await call(client, 'search_foods', { query: q, limit: 1 })).data.foods as { id: string }[])[0]!).id;
    const [chicken, rice, broccoli, egg] = [await pick('chicken breast'), await pick('rice'), await pick('broccoli'), await pick('egg')];
    await call(client, 'save_recipe', { name: 'Chicken and rice', servings: 2, ingredients: [{ food_id: chicken, grams: 300 }, { food_id: rice, grams: 150 }, { food_id: broccoli, grams: 200 }] });
    await call(client, 'save_recipe', { name: 'Omelette', servings: 1, ingredients: [{ food_id: egg, grams: 180 }, { name: 'Olive oil', grams: 10, estimate_per100g: { kcal: 880, protein: 0, carbs: 0, fat: 100 } }] });
    await call(client, 'save_recipe', { name: 'Rye toast', servings: 1, ingredients: [{ food_id: RYE, grams: 100 }] });
    await call(client, 'set_goals', { kcal: 2000 });
    const res = await call(client, 'suggest_meals', { have: ['chicken breast', 'rice', 'eggs'] });
    const recipes = res.data.recipes as { name: string; have: number; of: number; missing: string[]; fitsToday: boolean }[];
    expect(recipes.map((r) => r.name)).toEqual(['Omelette', 'Chicken and rice']); // Rye toast shares nothing
    expect(recipes[0]).toMatchObject({ have: 1, of: 1, missing: [] }); // the oil is a staple
    expect(recipes[1]).toMatchObject({ have: 2, of: 3 });
    expect(recipes[1]!.missing[0]).toContain('roccoli');
    expect(res.data.remaining).toMatchObject({ kcal: 2000 });
  });

  it('matches loosely and leaves out recipes with allergens', () => {
    const items = (names: string[]) => names.map((name) => ({ name, grams: 100, kcal: 100, protein: 5, carbs: 10, fat: 2 }));
    const r = [{ id: '1', name: 'A', servings: 1, items: items(['Chicken, breast, raw', 'Rice, polished, raw']) }];
    expect(rankCookable(r, ['Chicken Breast', 'rice'], null)[0]).toMatchObject({ have: 2, of: 2, fitsToday: null });
    expect(rankCookable(r, ['beans'], null)).toEqual([]);
  });

  it('leaves out a recipe that contains an allergy food', async () => {
    await call(client, 'update_profile', { diet: { allergies: ['rye'] } });
    await call(client, 'save_recipe', { name: 'Rye toast', servings: 1, ingredients: [{ food_id: RYE, grams: 100 }] });
    const res = await call(client, 'suggest_meals', { have: ['rye bread'] });
    expect(res.data.recipes).toEqual([]);
    expect(res.data.leftOutBecauseOfAllergies).toBe(1);
  });
});

describe('invitations from Claude', () => {
  const admin = () => connectAs(env, ana, undefined, { isAdmin: true });

  it('is only offered to the owner', async () => {
    expect((await client.listTools()).tools.some((t) => t.name === 'list_invitations')).toBe(false);
    expect((await (await admin()).listTools()).tools.some((t) => t.name === 'list_invitations')).toBe(true);
  });

  it('adds, lists and removes unused invitations, and will not remove someone who signed in', async () => {
    const c = await admin();
    const added = await call(c, 'add_invitation', { email: ' New.Friend@Example.com ' });
    expect(added.data).toMatchObject({ email: 'new.friend@example.com', invited: true });
    expect(String(added.data.next)).toContain('No email was sent');
    expect((await call(c, 'add_invitation', { email: 'new.friend@example.com' })).data.alreadyInvited).toBe(true);
    const list = (await call(c, 'list_invitations', {})).data.people as { email: string; status: string }[];
    expect(list.find((p) => p.email === 'new.friend@example.com')!.status).toContain('invited');
    expect(list.find((p) => p.email === 'ana@example.com')!.status).toBe('signed in');
    expect((await call(c, 'add_invitation', { email: 'not an address' })).isError).toBe(true);
    expect((await call(c, 'remove_invitation', { email: 'ana@example.com' })).isError).toBe(true);
    await signedInUser(env, 'bo@example.com');
    expect((await call(c, 'remove_invitation', { email: 'bo@example.com' })).text).toContain('already signed in');
    expect((await call(c, 'remove_invitation', { email: 'new.friend@example.com' })).data.removed).toBe(true);
    expect((await call(c, 'remove_invitation', { email: 'new.friend@example.com' })).isError).toBe(true);
  });
});

describe('merged tools', () => {
  it('delete_item needs the right field for its kind', async () => {
    for (const kind of ['food_entry', 'workout', 'workout_template', 'recipe']) expect((await call(client, 'delete_item', { kind })).text).toContain('needs id');
    for (const kind of ['weigh_in', 'measurements', 'daily_metrics']) expect((await call(client, 'delete_item', { kind })).text).toContain('needs day');
    expect((await call(client, 'delete_item', { kind: 'meal_plan' })).text).toContain('needs week_start');
  });

  it('keeps the merged tools merged', async () => {
    const { tools } = await client.listTools();
    for (const gone of ['get_day', 'get_nutrition_summary', 'log_weight', 'log_measurements', 'delete_recipe', 'get_exercise', 'get_last_import', 'list_recipes', 'get_grocery_list']) expect(tools.some((t) => t.name === gone)).toBe(false);
  });

  it('shows food over several days from one tool', async () => {
    await call(client, 'log_food', { day: '2026-10-12', items: [{ food_id: RYE, grams: 100 }] });
    const one = (await call(client, 'get_food_log', { day: '2026-10-12' })).data;
    expect(one.entries).toHaveLength(1);
    const range = (await call(client, 'get_food_log', { day: '2026-10-13', days: 3 })).data;
    expect(range).toMatchObject({ from: '2026-10-11', to: '2026-10-13', daysLogged: 1 });
  });

  it('reads exercise details by id from search_exercises', async () => {
    const detail = await call(client, 'search_exercises', { id: 'ex:Barbell_Squat' });
    expect((detail.data.exercise as { instructions: string[] }).instructions.length).toBeGreaterThan(0);
    expect((await call(client, 'search_exercises', { id: 'ex:Nope' })).isError).toBe(true);
    void jsonInText;
  });
});
