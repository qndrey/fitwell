import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * Axe scan with the WCAG 2.2 AA rule set.
 *
 * `target-size` is switched off here on purpose: axe reports a button as "too small" whenever the pinned
 * "Add food" bar covers part of it at the current scroll position, which is how any pinned bar over scrolling
 * content behaves. The real requirement (every tap target is at least 44 × 44 px) is checked directly by the
 * `smallTargets`/size assertions in tests/e2e/mobile.spec.ts and the per-screen phone tests.
 */
export const a11yScan = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).disableRules(['target-size']).analyze();
