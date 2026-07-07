import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * G14 a11y gate: axe-core scan over the mounted G12/G13 shell. Runs on BOTH
 * backends — the DOM is identical under SwiftShader, so this is part of the
 * always-on floor, not the nightly ceiling. Serious/critical violations fail;
 * G13's ARIA layer is what makes this pass.
 */
test('G12/G13 shell has no serious a11y violations', async ({ page }) => {
  await page.goto('/index.html?thorizon=20&n=16');
  await page.waitForSelector('.shell', { timeout: 60_000 });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  const serious = results.violations.filter(
    v => v.impact === 'serious' || v.impact === 'critical');
  expect(
    serious,
    JSON.stringify(serious.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), null, 2),
  ).toEqual([]);
});
