import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveBase, normaliseBase, manualChunks, HASH_POLICY, COMPRESSION_POLICY,
  shouldCompress, REQUIRED_ENV_KEYS, envDefaults, PROJECT_BASE,
  SHADER_MODULE_COUNT, SITE_OUT_DIR, SW_FILE, type BuildMode,
} from '@/../build/build.config.js';
import {
  SHADER_MODULES, shaderPath, allShaderPaths, SHADER_DIR,
} from '@/../build/shaders.manifest.js';
import { appEnv, ENV_KEYS } from '@/env.js';
import { precacheList, cacheName, RUNTIME_STRATEGY } from '@/../build/sw.config.js';

/**
 * G15 exit suite: pure manifest/config validator. No Vite import, no
 * `vite build`, no GPU, no DOM — the only filesystem touch is the
 * shader-manifest↔disk sync check (node:fs), gated by dirReady so a
 * fresh checkout without the shader tree still runs green.
 */

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../../');

describe('chunk split policy', () => {
  it('routes src/gpu/** into the gpu chunk', () => {
    expect(manualChunks('/abs/principia/src/gpu/init.ts')).toBe('gpu');
    expect(manualChunks('/abs/principia/src/gpu/shaders/simulate.wgsl')).toBe('gpu');
  });

  it('routes node_modules/** into the vendor chunk', () => {
    expect(manualChunks('/abs/principia/node_modules/three/index.js')).toBe('vendor');
  });

  it('leaves app entry code unchunked (Rollup decides)', () => {
    expect(manualChunks('/abs/principia/dev/main.ts')).toBeUndefined();
    expect(manualChunks('/abs/principia/src/ui/App.ts')).toBeUndefined();
  });

  it('is OS-path-independent (handles Windows separators)', () => {
    expect(manualChunks('C:\\repo\\src\\gpu\\init.ts')).toBe('gpu');
    expect(manualChunks('C:\\repo\\node_modules\\x\\i.js')).toBe('vendor');
  });
});

describe('base path policy', () => {
  it('prod base is the project-pages subpath', () => {
    expect(resolveBase('production')).toBe('/principia-ii/');
    expect(resolveBase('production')).toBe(PROJECT_BASE);
  });

  it('dev base is root', () => {
    expect(resolveBase('development')).toBe('/');
  });

  it('VITE_BASE override wins and is normalised', () => {
    expect(resolveBase('production', '/custom')).toBe('/custom/');
    expect(resolveBase('production', 'custom/')).toBe('/custom/');
    expect(resolveBase('development', '/principia-ii/')).toBe('/principia-ii/');
  });

  it('normaliseBase enforces leading + trailing slash', () => {
    expect(normaliseBase('foo')).toBe('/foo/');
    expect(normaliseBase('/foo/')).toBe('/foo/');
  });
});

describe('content-hash filename policy', () => {
  it('entry, chunk, and asset names all carry a content hash', () => {
    expect(HASH_POLICY.entryFileNames).toMatch(/\[hash\]/);
    expect(HASH_POLICY.chunkFileNames).toMatch(/\[hash\]/);
    expect(HASH_POLICY.assetFileNames).toMatch(/\[hash\]/);
  });

  it('keeps a stable [name] segment for long-term caching', () => {
    expect(HASH_POLICY.entryFileNames).toMatch(/\[name\]-\[hash\]/);
    expect(HASH_POLICY.assetFileNames).toMatch(/\[name\]-\[hash\]\[extname\]/);
  });

  it('emits all hashed output under assets/', () => {
    for (const n of Object.values(HASH_POLICY)) {
      expect(n.startsWith('assets/')).toBe(true);
    }
  });

  it('the service worker is the one stable, un-hashed, root-scoped file', () => {
    // A hashed SW URL could never be found again across deploys; a nested
    // one could not claim the site scope.
    expect(SW_FILE).toBe('sw.js');
    expect(SW_FILE).not.toMatch(/\[hash\]/);
    expect(SW_FILE.includes('/')).toBe(false);
  });

  it('the site build never targets tsc-owned dist/', () => {
    // dist/ holds `npm run build` (tsc) output that gpu:check imports;
    // Vite's emptyOutDir would clobber it.
    expect(SITE_OUT_DIR).not.toBe('dist');
    expect(SITE_OUT_DIR.length).toBeGreaterThan(0);
  });
});

describe('compression policy', () => {
  it('emits both gzip and brotli', () => {
    expect([...COMPRESSION_POLICY.algorithms]).toEqual(['gzip', 'brotli']);
  });

  it('compresses text-ish bundle output including WGSL strings', () => {
    expect(shouldCompress('js')).toBe(true);
    expect(shouldCompress('.css')).toBe(true);
    expect(shouldCompress('wgsl')).toBe(true);
    expect(shouldCompress('.WGSL')).toBe(true);
  });

  it('does not compress already-compressed binary assets', () => {
    expect(shouldCompress('png')).toBe(false);
    expect(shouldCompress('woff2')).toBe(false);
  });

  it('keeps the original alongside the compressed copy', () => {
    expect(COMPRESSION_POLICY.deleteOriginalAssets).toBe(false);
    expect(COMPRESSION_POLICY.thresholdBytes).toBeGreaterThan(0);
  });
});

describe('import.meta.env contract', () => {
  it('env.ts and build.config.ts agree on the required keys', () => {
    expect([...ENV_KEYS]).toEqual([...REQUIRED_ENV_KEYS]);
  });

  it('service worker defaults OFF in every mode', () => {
    for (const mode of ['production', 'development'] as BuildMode[]) {
      expect(envDefaults(mode).VITE_ENABLE_SW).toBe('0');
    }
  });

  it('appEnv reads a synthetic env without a Vite runtime', () => {
    const env = appEnv({
      VITE_APP_VERSION: 'abc123', VITE_ENABLE_SW: '1',
      PROD: true, DEV: false, BASE_URL: '/principia-ii/',
    });
    expect(env.version).toBe('abc123');
    expect(env.serviceWorker).toBe(true);
    expect(env.prod).toBe(true);
    expect(env.dev).toBe(false);
    expect(env.baseUrl).toBe('/principia-ii/');
  });

  it('appEnv falls back to dev defaults on an empty env', () => {
    const env = appEnv({});
    expect(env.version).toBe('0.0.0-dev');
    expect(env.serviceWorker).toBe(false);
    expect(env.baseUrl).toBe('/');
  });

  it('appEnv treats empty strings as unset', () => {
    const env = appEnv({ VITE_APP_VERSION: '', VITE_ENABLE_SW: '' });
    expect(env.version).toBe('0.0.0-dev');
    expect(env.serviceWorker).toBe(false);
  });
});

describe('shader manifest ↔ disk sync', () => {
  const shaderDirAbs = path.join(REPO_ROOT, SHADER_DIR);
  const dirReady = existsSync(shaderDirAbs);

  it('manifest count matches build.config SHADER_MODULE_COUNT', () => {
    expect(SHADER_MODULES.length).toBe(SHADER_MODULE_COUNT);
  });

  it('every manifest path is SHADER_DIR-prefixed and .wgsl', () => {
    for (const m of SHADER_MODULES) {
      expect(shaderPath(m)).toBe(`${SHADER_DIR}/${m}`);
      expect(m.endsWith('.wgsl')).toBe(true);
    }
    expect(allShaderPaths()).toHaveLength(SHADER_MODULES.length);
  });

  it.skipIf(!dirReady)('every shader module resolves to a file on disk', () => {
    for (const p of allShaderPaths()) {
      expect(existsSync(path.join(REPO_ROOT, p)), `${p} must exist`).toBe(true);
    }
  });

  it.skipIf(!dirReady)('every *.wgsl on disk appears in the manifest (completeness)', () => {
    const onDisk = readdirSync(shaderDirAbs)
      .filter((f) => f.endsWith('.wgsl'))
      .sort();
    expect(onDisk).toEqual([...SHADER_MODULES]);
  });
});

describe('service-worker precache policy', () => {
  it('precaches the shell only — production has no raw WGSL files', () => {
    // G1 inlines every shader into the gpu chunk via ?raw; a precache
    // entry for src/gpu/shaders/*.wgsl would 404 and reject the install.
    const list = precacheList('/principia-ii/');
    expect(list).toEqual(['/principia-ii/']);
    for (const url of list) expect(url).not.toMatch(/\.wgsl$/);
  });

  it('normalises a base without a trailing slash', () => {
    expect(precacheList('/principia-ii')).toEqual(['/principia-ii/']);
  });

  it('version-stamps the cache name so a deploy invalidates it', () => {
    expect(cacheName('deadbee')).toBe('principia-shell-deadbee');
    expect(cacheName('a')).not.toBe(cacheName('b'));
  });

  it('hashed assets are cache-first, navigations network-first', () => {
    expect(RUNTIME_STRATEGY.assets).toBe('cache-first');
    expect(RUNTIME_STRATEGY.navigation).toBe('network-first');
  });
});
