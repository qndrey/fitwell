import { a11yScan } from '../helpers/a11y';
import { expect, test, type Page } from '@playwright/test';
import { openAddFood } from '../helpers/addFood';

const REPLY = `Here is a workout:
\`\`\`json
{ "fitwell": "workout", "version": 1, "name": "Upper body", "units": "kg",
  "exercises": [
    { "name": "Barbell Bench Press - Medium Grip", "sets": [ { "type": "warmup", "reps": 10, "weight": 40 }, { "reps": 8, "weight": 60 } ] },
    { "name": "Plank", "mode": "time", "load": "bodyweight", "sets": [ { "seconds": 45 } ] },
    { "name": "Zzyzx Machine Thing", "sets": [ { "reps": 12, "weight": 20 } ] }
  ] }
\`\`\`
Have a good session!`;

async function openAi(page: Page) {
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'AI assistant' })).toBeVisible();
}

test.beforeEach(async ({ page, context, browserName }) => {
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']); // the other browsers have no such permission
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('copy a food and workout prompt: you see exactly what is copied', async ({ page, browserName }) => {
  await openAddFood(page);
  const d = page.getByRole('dialog');
  await d.getByLabel('Search foods').fill('banana');
  await d.getByRole('button', { name: /^Banana, raw/ }).first().click();
  await d.getByRole('button', { name: /^Add to/ }).click();
  await d.getByRole('button', { name: 'Done' }).click();

  await openAi(page);
  const box = page.getByLabel('Text that will be copied').first();
  await expect(box).toHaveValue(/FOOD[\s\S]*Banana/);
  await expect(box).toHaveValue(/WORKOUTS/);
  await page.getByRole('radio', { name: 'Food' }).first().check();
  await expect(box).not.toHaveValue(/WORKOUTS/);
  await page.getByRole('button', { name: 'Copy prompt' }).first().click();
  await expect(page.getByText(/Copied\. Paste it|Copying was blocked/)).toBeVisible();
  if (browserName === 'chromium') expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await box.inputValue());
});

test('ask for a workout, paste the reply, check it and add it', async ({ page }) => {
  await openAi(page);
  await page.getByLabel('What are you after?').fill('upper body, 30 minutes');
  const req = page.getByLabel('Text that will be copied').nth(1);
  await expect(req).toHaveValue(/upper body, 30 minutes/);
  await expect(req).toHaveValue(/"fitwell": "workout"/);

  await page.getByLabel('AI reply').fill('nothing useful');
  await page.getByRole('button', { name: 'Check reply' }).click();
  await expect(page.getByText(/No workout found/)).toBeVisible();

  await page.getByLabel('AI reply').fill(REPLY);
  await page.getByRole('button', { name: 'Check reply' }).click();
  const d = page.getByRole('dialog');
  await expect(d.getByRole('heading', { name: 'Check before adding' })).toBeVisible();
  await expect(d.getByRole('region', { name: 'Barbell Bench Press - Medium Grip' }).getByText('Matched')).toBeVisible();
  await expect(d.getByRole('region', { name: 'Zzyzx Machine Thing' }).getByText('New')).toBeVisible();
  await expect(d.getByLabel('Name')).toHaveValue('Upper body');
  // Leave the odd one out, then add.
  await d.getByRole('region', { name: 'Zzyzx Machine Thing' }).getByRole('combobox').selectOption({ label: 'Leave out' });
  await d.getByRole('button', { name: 'Add workout' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Upper body' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /Barbell Bench Press/ })).toBeVisible();
  await expect(page.getByLabel('Set 2 kg')).toHaveValue('60');
  await expect(page.getByRole('heading', { level: 2, name: 'Plank' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /Zzyzx/ })).toHaveCount(0);
});

test('a thing the library does not know can be kept as your own exercise', async ({ page }) => {
  await openAi(page);
  await page.getByLabel('AI reply').fill(REPLY);
  await page.getByRole('button', { name: 'Check reply' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add workout' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Zzyzx Machine Thing' })).toBeVisible();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await expect(page.getByRole('dialog').getByText('Zzyzx Machine Thing').first()).toBeVisible(); // now in "Your exercises"
});

test('the AI screen is accessible and fits a phone, and nothing leaves the device', async ({ page }) => {
  const foreign: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost')) foreign.push(r.url());
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await openAi(page);
  await page.getByLabel('AI reply').fill(REPLY);
  await page.getByRole('button', { name: 'Check reply' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Check before adding' })).toBeVisible();
  expect((await a11yScan(page)).violations.map((v) => v.id)).toEqual([]);
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  expect((await a11yScan(page)).violations.map((v) => v.id)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(foreign).toEqual([]);
});
