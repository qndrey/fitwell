// Helpers for the views on the card shell (dashboard, review) run by tests/support/viewHost.ts.
import { expect as pwExpect } from 'playwright/test';
import type { OpenedView } from './viewHost';

/** Taps the strip segment of a card (by its name) and waits until that card is the one in view; returns the card. */
export async function showCard(v: OpenedView, key: string, name: string) {
  const card = v.frame.locator(`section.pcard[data-key="${key}"]`);
  await card.waitFor({ state: 'attached' });
  await v.frame.getByRole('button', { name: new RegExp(`^${name}, \\d+ of \\d+$`) }).click();
  await pwExpect(card).not.toHaveAttribute('inert', '');
  return card;
}
