import { test, expect, type Page } from '@playwright/test';

/**
 * G8 shell smoke on a real (or SwiftShader) WebGPU device: the dev
 * shell boots, tiles converge onto the canvas, and pan / zoom / lock
 * all work end-to-end through the real dispatcher.
 *
 * The URL knobs (?thorizon=20&n=16) shorten the physics horizon for CI —
 * SwiftShader is ~100× slower than hardware and the spec-true horizon
 * (T = 80) is a minutes-long first paint there.
 */

interface PrincipiaWindow {
  __principia: {
    app: {
      store: { snapshot(): { uvCentre: number[]; uvHalfWidth: number[] } };
      loop: { lastStats: {
        visible: number; cacheHits: number; ancestorFalls: number;
      } | null };
    };
  };
}

/** Distinct opaque colours on the WebGPU canvas (via a 2D copy). */
async function canvasColours(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return -1;
    const c2 = document.createElement('canvas');
    c2.width = canvas.width; c2.height = canvas.height;
    const g = c2.getContext('2d');
    if (!g) return -1;
    g.drawImage(canvas, 0, 0);
    const d = g.getImageData(0, 0, c2.width, c2.height).data;
    const colours = new Set<number>();
    for (let i = 0; i < d.length; i += 16) {
      if (d[i + 3] === 0) continue;                       // never presented
      colours.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    }
    return colours.size;
  });
}

async function converged(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const s = (window as unknown as PrincipiaWindow)
      .__principia.app.loop.lastStats;
    return !!s && s.visible > 0 && s.cacheHits === s.visible;
  });
}

test('the shell boots, renders tiles, and answers pan/zoom/lock', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/index.html?thorizon=20&n=16');
  await page.waitForFunction(
    () => (window as { __principia?: unknown }).__principia !== undefined,
    null, { timeout: 60_000 });

  // Tiles land asynchronously; converge to a fully-drawn frontier.
  await expect(async () => {
    expect(await converged(page)).toBe(true);
  }).toPass({ timeout: 240_000, intervals: [2_000] });

  // Pixel probe: best-effort. Headless Chromium never composites the
  // WebGPU canvas (the known presentation glitch every dev harness works
  // around), and even headed, drawImage from a WebGPU canvas can read the
  // cleared current texture rather than the presented frame — so colour
  // assertions bind only when the 2D copy actually sees pixels. The human
  // proof is the compositor screenshot below; automated pixel correctness
  // is pinned offscreen by the M7 render check.
  const presenting = (await canvasColours(page)) > 0;
  if (presenting) {
    // The M3 latent slice is a fractal boundary — a healthy render has
    // many distinct colours.
    await expect(async () => {
      expect(await canvasColours(page)).toBeGreaterThan(3);
    }).toPass({ timeout: 60_000, intervals: [1_000] });
  } else {
    console.log('[shell.spec] headless presentation unavailable — pixel checks skipped');
  }

  // Zoom in about the canvas centre (viewport zoom — no slice recompute).
  const box = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -240);
  await page.waitForFunction(() => {
    const p = (window as unknown as PrincipiaWindow).__principia;
    return p.app.store.snapshot().uvHalfWidth[0]! < 0.5;
  });
  // The zoomed frontier redraws (self tiles or stretched ancestors).
  await expect(async () => {
    const p = await page.evaluate(() => {
      const s = (window as unknown as PrincipiaWindow)
        .__principia.app.loop.lastStats;
      return s ? s.cacheHits + s.ancestorFalls : 0;
    });
    expect(p).toBeGreaterThan(0);
    if (presenting) expect(await canvasColours(page)).toBeGreaterThan(3);
  }).toPass({ timeout: 240_000, intervals: [2_000] });

  // Drag-pan: the centre must move.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  const centre = await page.evaluate(() =>
    (window as unknown as PrincipiaWindow).__principia.app.store.snapshot().uvCentre);
  expect(centre[0]).not.toBeCloseTo(0.5, 6);

  // Click (no drag) locks a pixel and surfaces the inspector panel.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.inspector')).toBeVisible();
  await expect(page.locator('.inspector .outcome')).not.toHaveText('', { timeout: 120_000 });

  // Unlock hides it again.
  await page.locator('.inspector .unlock').click();
  await expect(page.locator('.inspector')).toBeHidden();

  // G18 dev HUD: default-hidden, `~` reveals it with live perf numbers,
  // `~` again hides it. Read-only — toggling must not disturb the view.
  await expect(page.locator('.devhud')).toBeHidden();
  const beforeHud = await page.evaluate(() =>
    (window as unknown as PrincipiaWindow).__principia.app.store.snapshot());
  await page.keyboard.press('Shift+`');
  await expect(page.locator('.devhud')).toBeVisible();
  await expect(page.locator('.devhud-perf')).toContainText('cpu');
  await page.locator('.devhud button[data-tab="errors"]').click();
  await expect(page.locator('.devhud-errors')).toContainText('failed tiles');
  // Live capture button (DG18.4 follow-up): the dispatcher has dispatched
  // real tiles by now, so a click must yield a REPLAYABLE snapshot with a
  // JSON download link.
  await page.locator('.devhud button[data-tab="capture"]').click();
  await expect(page.locator('.devhud-capture')).toContainText('no captured frame');
  await page.locator('.devhud-capture-take').click();
  await expect(page.locator('.devhud-capture')).toContainText('replayable');
  await expect(page.locator('.devhud-capture-download')).toHaveAttribute(
    'download', /principia-capture-/);
  await page.keyboard.press('Shift+`');
  await expect(page.locator('.devhud')).toBeHidden();
  const afterHud = await page.evaluate(() =>
    (window as unknown as PrincipiaWindow).__principia.app.store.snapshot());
  expect(afterHud).toEqual(beforeHud);

  // G13 a11y: the canvas is an application region, the polite status region
  // exists, and a CVD swap announces itself while leaving ViewState (and so
  // the cache key) untouched — the render-only invariant, live.
  await expect(page.locator('canvas')).toHaveAttribute('role', 'application');
  await expect(page.locator('.a11y-status')).toHaveAttribute('aria-live', 'polite');
  const beforeCvd = await page.evaluate(() =>
    (window as unknown as PrincipiaWindow).__principia.app.store.snapshot());
  await page.locator('#cvd').selectOption('deutan');
  await expect(page.locator('.a11y-status')).toContainText('Deuteranopia');
  const afterCvd = await page.evaluate(() =>
    (window as unknown as PrincipiaWindow).__principia.app.store.snapshot());
  expect(afterCvd).toEqual(beforeCvd);
  await page.locator('#cvd').selectOption('none');

  // Escape dismisses the open gallery (consumed) rather than falling through.
  await page.keyboard.press('p');
  await expect(page.locator('.gallery')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.gallery')).toBeHidden();

  expect(errors).toEqual([]);

  // Let the zoomed/panned frontier finish before the keepsake screenshots
  // (fast on hardware; bounded so SwiftShader CI never hangs here).
  await expect(async () => {
    expect(await converged(page)).toBe(true);
  }).toPass({ timeout: 120_000, intervals: [2_000] });
  await page.waitForTimeout(500);
  await page.locator('canvas').screenshot({ path: 'dev/out/g8_shell.png' });
  await page.screenshot({ path: 'dev/out/g8_shell_full.png' });
});
