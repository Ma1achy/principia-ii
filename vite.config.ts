import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // WGSL imported as ?raw in dev/debug_harness.ts's loadShaders().
  assetsInclude: ['**/*.wgsl'],
});
