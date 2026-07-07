import { test, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { checkPerf, type PerfBaseline } from '@/regression/perf_gate.js';
import type { PerfSnapshot } from '@/perf/perf_monitor.js';

/**
 * G14 perf regression: capture G10's live PerfSnapshot after the frontier
 * converges and judge it against the committed baseline with the pure
 * checkPerf gate. REAL-GPU ONLY — the baseline is captured on the reference
 * hardware runner; SwiftShader is ~100× slower and would always "regress".
 * Regenerate: PW_REAL_GPU=1 PW_UPDATE_PERF=1 npx playwright test --headed \
 *   test/gpu/perf_capture.spec.ts
 */

const REAL_GPU = process.env['PW_REAL_GPU'] === '1';
const UPDATE = process.env['PW_UPDATE_PERF'] === '1';
const BASELINE_PATH = 'test/fixtures/perf/baseline.json';

test('frame-loop perf does not regress vs baseline', async ({ page }) => {
  test.skip(!REAL_GPU, 'baseline is runner-specific — real-GPU project only');

  await page.goto('/index.html?thorizon=20&n=16');
  await page.waitForFunction(
    () => (window as { __principia?: unknown }).__principia !== undefined,
    null, { timeout: 60_000 });
  // Converge, then keep the loop running a moment so the rolling window warms.
  await page.waitForFunction(() => {
    const p = (window as unknown as {
      __principia: { app: { loop: { lastStats: {
        visible: number; cacheHits: number } | null } } };
    }).__principia;
    const s = p.app.loop.lastStats;
    return !!s && s.visible > 0 && s.cacheHits === s.visible;
  }, null, { timeout: 240_000, polling: 2_000 });
  await page.waitForTimeout(3_000);

  const snapshot = await page.evaluate(() =>
    (window as unknown as {
      __principia: { app: { loop: { perf: { snapshot(): unknown } } } };
    }).__principia.app.loop.perf.snapshot()) as PerfSnapshot;

  if (UPDATE) {
    const baseline: PerfBaseline = {
      cpuP95Ms: Math.round(snapshot.cpuP95Ms * 100) / 100,
      gpuP95Ms: Object.fromEntries(Object.entries(snapshot.gpuP95Ms)
        .filter((kv): kv is [string, number] => typeof kv[1] === 'number')
        .map(([k, v]) => [k, Math.round(v * 100) / 100])),
      budget: snapshot.budget,
    };
    await mkdir('test/fixtures/perf', { recursive: true });
    await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    return;
  }

  const baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8')) as PerfBaseline;
  // 2× ceiling: the reference "runner" is a dev laptop whose convergence-window
  // GPU p95 jitters ±50% run-to-run. Still catches the 3× disasters this gate
  // exists for; tighten toward the checkPerf default (+25%) on a dedicated
  // self-hosted runner.
  const result = checkPerf(snapshot, baseline, { allowedRegression: 1.0 });
  expect(result.passed, JSON.stringify(result.regressions)).toBe(true);
});
