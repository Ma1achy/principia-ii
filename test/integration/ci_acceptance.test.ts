import { describe, it, expect } from 'vitest';
import '@/validation/index.js';
import { runAllAcceptance } from '@/validation/acceptance.js';

/**
 * The CI acceptance gate (G8): every registered spec §7 check must pass,
 * and the whole battery must stay fast enough to run on every push.
 */
describe('CI acceptance gate', () => {
  it('every §7 check passes within the budget', async () => {
    const t0 = performance.now();
    const results = await runAllAcceptance();
    const elapsed = performance.now() - t0;

    expect(results.length).toBeGreaterThanOrEqual(6);   // A1–A6
    for (const r of results) {
      expect(r.passed, `${r.id}: ${r.details ?? ''}`).toBe(true);
    }
    expect(elapsed).toBeLessThan(30_000);
  }, 60_000);
});
