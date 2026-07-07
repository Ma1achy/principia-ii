import { defineConfig } from '@playwright/test';

/**
 * Real-browser GPU tests (G8 shell smoke; G14 visual/perf/axe regression).
 *
 * Two backends, one active at a time (G14):
 *  - chromium-swiftshader (default): deterministic software WebGPU — the
 *    always-on CI floor. Slow but runs on GPU-less runners.
 *  - chromium-real-webgpu (PW_REAL_GPU=1): the hardware adapter — nightly /
 *    opt-in. The visual + perf regression specs only run here because
 *    fractal-boundary pixels and frame timings are backend-specific
 *    (M3 D3.2: ~37% boundary-pixel disagreement between backends).
 */
const REAL_GPU = process.env['PW_REAL_GPU'] === '1';

const SWIFTSHADER_ARGS = [
  '--enable-unsafe-webgpu',
  '--enable-features=WebGPU',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
];
// Real GPU: drop the swiftshader override so Chromium picks the hardware adapter.
const REAL_GPU_ARGS = [
  '--enable-unsafe-webgpu',
  '--enable-features=WebGPU',
  '--no-sandbox',
];

export default defineConfig({
  testDir: './test/gpu',
  timeout: 300_000,
  fullyParallel: false,
  // ONE worker: every spec contends for the same physical GPU — parallel
  // workers skew the perf gate's timings and starve the compositor.
  workers: 1,
  use: {
    headless: true,
    launchOptions: {
      args: REAL_GPU ? REAL_GPU_ARGS : SWIFTSHADER_ARGS,
    },
  },
  projects: [
    REAL_GPU
      ? { name: 'chromium-real-webgpu' }
      : { name: 'chromium-swiftshader' },
  ],
  webServer: {
    command: 'npx vite dev --port 5197 --strictPort',
    port: 5197,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
