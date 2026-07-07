import { defineConfig } from '@playwright/test';

/**
 * Real-browser GPU tests (G8; G14 grows this into the visual/perf/axe
 * regression suite). SwiftShader keeps it runnable on GPU-less CI —
 * slow but deterministic. Local devs with real GPUs run the same specs
 * faster: `npm run test:gpu`.
 */
export default defineConfig({
  testDir: './test/gpu',
  timeout: 300_000,
  fullyParallel: false,
  use: {
    headless: true,
    launchOptions: {
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=WebGPU',
        '--enable-unsafe-swiftshader',
        '--no-sandbox',
      ],
    },
  },
  webServer: {
    command: 'npx vite dev --port 5197 --strictPort',
    port: 5197,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
