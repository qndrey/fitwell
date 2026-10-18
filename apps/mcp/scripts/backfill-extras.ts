// Entries logged before migration 0010 have no fibre, sugars, saturated fat or salt. For the ones that came from a Frida food
// this writes the SQL that fills them in from the dataset (scaled to the logged grams). Entries from other sources are left alone.
// Run:  npx tsx scripts/backfill-extras.ts > /tmp/backfill.sql
//       npx wrangler d1 execute fitwell --local --file /tmp/backfill.sql      (or --remote for the live database)
import { loadBundledFoods } from '@fitwell/core/data/bundledFoods';
import { EXTRA_KEYS } from '@fitwell/core/domain/nutrition';

const { foods } = await loadBundledFoods();
for (const f of foods) {
  if (!f.extras) continue;
  const parts = EXTRA_KEYS.filter((k) => f.extras![k] !== undefined).map((k) => `'${k}', ROUND(grams * ${f.extras![k]} / 100, 1)`);
  if (!parts.length) continue;
  console.log(`UPDATE food_entries SET extras = json_object(${parts.join(', ')}) WHERE food_ref = '${f.ref.id}' AND extras IS NULL;`);
}
