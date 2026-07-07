import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { compareImages, type RasterImage } from '@/regression/image_diff.js';
import { GOLDEN_MANIFEST } from '@/regression/golden_manifest.js';

/**
 * G14 visual regression: one golden PNG per render (colour) mode. Render
 * modes are RENDER-ONLY (spec §7 A4) — the same deterministic frame,
 * recoloured — so the spec boots once per mode, converges, flips the mode
 * through the RenderParamsStore, and compares the compositor screenshot.
 *
 * REAL-GPU ONLY: fractal-boundary pixels are backend-specific (M3 D3.2 —
 * ~37% boundary disagreement between SwiftShader and hardware), so the
 * committed goldens bind only under PW_REAL_GPU=1 on the reference runner.
 * Regenerate: PW_REAL_GPU=1 PW_UPDATE_GOLDENS=1 npx playwright test --headed \
 *   test/gpu/visual_regression.spec.ts
 */

const REAL_GPU = process.env['PW_REAL_GPU'] === '1';
const UPDATE = process.env['PW_UPDATE_GOLDENS'] === '1';
const GOLDEN_DIR = 'test/fixtures/golden';

function toRaster(buf: Buffer): RasterImage {
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
}

async function writePng(path: string, img: RasterImage): Promise<void> {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  await writeFile(path, PNG.sync.write(png));
}

/** True when the screenshot actually carries WebGPU pixels. DG8.7: an
 *  in-page drawImage probe reads the CLEARED current texture even headed,
 *  so the only honest presence check is the compositor screenshot itself —
 *  a runner that never composites produces a (near-)uniform raster. */
function hasPixels(img: RasterImage): boolean {
  const colours = new Set<number>();
  const d = img.data;
  for (let i = 0; i < d.length; i += 64) {
    colours.add(((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!) >>> 0);
    if (colours.size > 2) return true;
  }
  return false;
}

async function bootConverged(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto('/index.html?thorizon=20&n=16');
  await page.waitForFunction(
    () => (window as { __principia?: unknown }).__principia !== undefined,
    null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const p = (window as unknown as {
      __principia: { app: { loop: { lastStats: {
        visible: number; cacheHits: number } | null } } };
    }).__principia;
    const s = p.app.loop.lastStats;
    return !!s && s.visible > 0 && s.cacheHits === s.visible;
  }, null, { timeout: 240_000, polling: 2_000 });
  await page.waitForTimeout(500);
}

for (const entry of GOLDEN_MANIFEST) {
  test(`render mode '${entry.id}' matches golden`, async ({ page }) => {
    test.skip(!REAL_GPU, 'goldens are backend-specific — real-GPU project only');

    await bootConverged(page);

    // RENDER-ONLY mode switch through the RenderParamsStore (group-3 rebind).
    await page.evaluate((mode) => {
      (window as unknown as {
        __principia: { renderStore: {
          update(fn: (p: { colourMode: string }) => object): void } };
      }).__principia.renderStore.update(p => ({ ...p, colourMode: mode }));
    }, entry.id);
    await page.waitForTimeout(400);

    const shot = toRaster(await page.locator('canvas').screenshot());
    test.skip(!hasPixels(shot),
      'compositor never presented WebGPU pixels on this runner (DG8.7)');

    if (UPDATE) {
      await mkdir(GOLDEN_DIR, { recursive: true });
      await writePng(`${GOLDEN_DIR}/${entry.file}`, shot);
      return;
    }

    const golden = toRaster(await readFile(`${GOLDEN_DIR}/${entry.file}`));
    const result = compareImages(shot, golden, {
      tolerance: entry.tolerance, metric: 'channel', ignoreAntialiasing: true,
    });
    if (!result.passed) {
      await writePng(`${GOLDEN_DIR}/${entry.file}.diff.png`, result.diffMask);
    }
    expect(result.passed, `diffRatio=${result.diffRatio}`).toBe(true);
  });
}
