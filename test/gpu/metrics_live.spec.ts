import { test, expect } from '@playwright/test';

// Regression gate for the 'everything looks flat' failure mode: the GPU
// metrics (diffusion always; FTLE in research tier) must produce real,
// varying values in the tile reductions — never the pre-Stage-5 sentinels.
test('tile reductions carry real diffusion + research-tier FTLE', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto('/index.html?thorizon=20&n=16&maxdepth=2');
  await page.waitForFunction(() =>
    (window as never as { __principia?: unknown }).__principia !== undefined,
    null, { timeout: 60_000 });

  interface Red { mean_diffusion: number; spread_diffusion: number;
                  mean_ftle: number; mean_arc_length_n: number;
                  mean_word_length: number }
  const reductions = async (): Promise<Red[]> => page.evaluate(() => {
    const p = (window as never as {
      __principia: { app: { loop: { cache: { entries(): Iterable<{ reduction?: Red | null }> } } } };
    }).__principia;
    const out: Red[] = [];
    for (const t of p.app.loop.cache.entries()) {
      if (t.reduction) {
        out.push({
          mean_diffusion: t.reduction.mean_diffusion,
          spread_diffusion: t.reduction.spread_diffusion,
          mean_ftle: t.reduction.mean_ftle,
          mean_arc_length_n: t.reduction.mean_arc_length_n,
          mean_word_length: t.reduction.mean_word_length,
        });
      }
    }
    return out;
  });

  // Force balanced tier explicitly (boot tier comes from capability
  // detection and may already be research on a beefy host).
  const setTier = (tier: string): Promise<void> => page.evaluate((t) => {
    const p = (window as never as {
      __principia: { app: {
        store: { update(fn: (v: { qualityTier: string }) => object): void };
        loop: { cache: { clear?: () => void } };
      } };
    }).__principia;
    p.app.store.update((v) => ({ ...v, qualityTier: t }));
    // Drop any tiles computed under the previous tier's key — cache entries
    // age out rather than clearing eagerly, and this probe reads them all.
    p.app.loop.cache.clear?.();
  }, tier);
  await setTier('balanced');

  // Wait until some tiles have reductions under the balanced key.
  await expect(async () => {
    expect((await reductions()).length).toBeGreaterThan(0);
  }).toPass({ timeout: 240_000, intervals: [2_000] });

  const balanced = await reductions();
  const withDiff = balanced.filter((r) => r.mean_diffusion >= 0);
  const maxDiff = Math.max(...balanced.map((r) => r.mean_diffusion));
  const maxArc = Math.max(...balanced.map((r) => r.mean_arc_length_n));
  console.log(`[probe] tiles=${balanced.length} withDiffusion=${withDiff.length}`
    + ` maxMeanDiffusion=${maxDiff} maxArc=${maxArc}`
    + ` ftle(balanced)=${Math.max(...balanced.map((r) => r.mean_ftle))}`);
  expect(withDiff.length).toBeGreaterThan(0);      // real fits, not all sentinel
  expect(maxDiff).toBeGreaterThan(0);              // and they VARY (not flat)
  expect(maxArc).toBeGreaterThan(0);               // arc length is real too
  // Free-group words are computed on every tier: some tile has symbols.
  expect(Math.max(...balanced.map((r) => r.mean_word_length))).toBeGreaterThan(0);
  // Balanced tier: FTLE off by design (research-only).
  expect(Math.max(...balanced.map((r) => r.mean_ftle))).toBe(0);

  // Switch to research tier → recompute → FTLE becomes real.
  await setTier('research');
  await expect(async () => {
    const rs = await reductions();
    const maxFtle = Math.max(...rs.map((r) => r.mean_ftle), 0);
    expect(maxFtle).toBeGreaterThan(0);
  }).toPass({ timeout: 300_000, intervals: [3_000] });
  const research = await reductions();
  console.log(`[probe] research maxMeanFtle=${Math.max(...research.map((r) => r.mean_ftle))}`);
});
