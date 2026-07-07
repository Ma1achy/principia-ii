import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip, brotliCompress } from 'node:zlib';
import {
  resolveBase, manualChunks, HASH_POLICY, COMPRESSION_POLICY, SITE_OUT_DIR,
  SW_FILE, shouldCompress, type BuildMode,
} from './build/build.config.js';

const gzipP = promisify(gzip);
const brotliP = promisify(brotliCompress);

/**
 * Post-build gzip + brotli pass (G15). Implemented with node:zlib instead
 * of vite-plugin-compression — that plugin targets Vite 2/3 and this repo
 * is on Vite 8; ~30 lines of walk-and-deflate need no compatibility bet.
 * Originals are kept beside the .gz/.br copies (COMPRESSION_POLICY) so any
 * static host can content-negotiate.
 */
function compressionPass(outDir: string): Plugin {
  async function walk(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries.map((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : Promise.resolve([p]);
    }));
    return files.flat();
  }
  return {
    name: 'principia:compress',
    apply: 'build',
    async closeBundle() {
      for (const file of await walk(outDir)) {
        const ext = path.extname(file);
        if (!shouldCompress(ext)) continue;
        const data = await fs.readFile(file);
        if (data.length <= COMPRESSION_POLICY.thresholdBytes) continue;
        await Promise.all([
          gzipP(data).then((buf) => fs.writeFile(`${file}.gz`, buf)),
          brotliP(data).then((buf) => fs.writeFile(`${file}.br`, buf)),
        ]);
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const buildMode: BuildMode = mode === 'production' ? 'production' : 'development';
  const base = resolveBase(buildMode, process.env.VITE_BASE);
  const root = fileURLToPath(new URL('.', import.meta.url));

  return {
    base,
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    // WGSL imported as ?raw in dev/shader_modules.ts and the dev harnesses.
    assetsInclude: ['**/*.wgsl'],
    // Bare-identifier constants for src/env.ts and src/sw.ts. define never
    // rewrites property accesses, and a BARE import.meta.env is not
    // statically populated either — these identifiers are the one env
    // channel into the bundle (applied in build AND dev server).
    define: {
      __APP_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION ?? '0.0.0-dev'),
      __APP_BASE__: JSON.stringify(base),
      __APP_SW_ENABLED__: JSON.stringify(process.env.VITE_ENABLE_SW ?? '0'),
      __APP_PROD__: JSON.stringify(buildMode === 'production'),
    },
    plugins: [compressionPass(path.join(root, SITE_OUT_DIR))],
    build: {
      target: 'esnext',
      minify: 'esbuild' as const,
      sourcemap: buildMode === 'production' ? ('hidden' as const) : true,
      // NOT dist/ — tsc owns that (gpu:check imports its output).
      outDir: SITE_OUT_DIR,
      rollupOptions: {
        input: {
          index: path.join(root, 'index.html'),
          // The service worker is a separate root-scoped entry with a
          // STABLE name — a hashed SW URL could never be found again.
          sw: path.join(root, 'src/sw.ts'),
        },
        treeshake: { moduleSideEffects: 'no-external' as const },
        output: {
          manualChunks,
          entryFileNames: (chunk) =>
            chunk.name === 'sw' ? SW_FILE : HASH_POLICY.entryFileNames,
          chunkFileNames: HASH_POLICY.chunkFileNames,
          assetFileNames: HASH_POLICY.assetFileNames,
        },
      },
    },
  };
});
