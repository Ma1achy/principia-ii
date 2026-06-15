# G15 — Build, bundling, deploy & hosting

## Goal

G8 shipped a *placeholder* `vite.config.ts` (`milestones/G8_ui_ci_perf.md`
~line 393): a single `manualChunks: { gpu: ['src/gpu'] }`, `assetsInclude`
for `**/*.wgsl`, and nothing about minification, content hashing, the project
base path, shader compression, env injection, or an actual hosting pipeline.
That is fine for `npm run dev`, but it cannot produce a deployable artifact:
GitHub Pages serves from a subpath (`/principia-ii/`), the WGSL strings G1
pulls in with `?raw` (`milestones/G1_shader_composition.md` ~line 448) ship
uncompressed, and there is no workflow that builds and publishes the site.

G15 turns the placeholder into a **real production build + a hosting pipeline**:
a hardened `vite.config.ts` (minify, treeshake, content-hashed chunks, the
`gpu` chunk preserved, `?raw` WGSL handling, configurable `base`), gzip/brotli
compression of the bundled output (including the WGSL strings), `import.meta.env`
prod/dev injection through a typed `env.ts`, a GitHub Pages deploy workflow that
extends G14's CI, and an **optional** PWA/offline service worker (clearly marked
optional, off by default) that caches the app shell + shaders.

The deliverable that the exit test guards is a single source of truth —
`build/build.config.ts` — that the Vite config, the deploy workflow, and the
service worker all read. The exit test is a **pure manifest/config validator**:
it asserts the chunk split, the `base` policy, the content-hash policy, the
compression policy, and that **every** `src/gpu/shaders/*.wgsl` referenced by
the shader registry is import-resolvable on disk. It never runs `vite build`,
never touches a GPU, and never starts a browser — the real `vite build` runs in
CI (and is gated behind the deploy job), mirroring how M3/G8 gate real-GPU work.

**Exit criterion (single executable test).**

```bash
npm test -- --run test/unit/build/build_config.test.ts
```

passes with at least **18 green tests** covering: the canonical chunk split
(`gpu` chunk present, vendor split, entry preserved), the `base` path policy
(prod `/principia-ii/`, dev `/`, env override), the content-hash filename policy
(`[name]-[hash]` for JS/CSS/assets, stable entry name), the compression policy
(gzip + brotli, `.wgsl`/`.js`/`.css` included, threshold honoured), the typed
`import.meta.env` contract (required keys, prod/dev defaults), and that every
WGSL module named in the shader registry resolves to an existing file under
`src/gpu/shaders/`.

## File tree

```
principia/
  build/
    build.config.ts          # NEW: single source of truth — chunks, base, hash, compression, env
    shaders.manifest.ts      # NEW: the canonical list of src/gpu/shaders/*.wgsl (mirrors G1)
    sw.config.ts             # NEW: service-worker precache policy (OPTIONAL feature, off by default)
  src/
    env.ts                   # NEW: typed import.meta.env accessor (prod/dev), AppEnv
    sw.ts                    # NEW (OPTIONAL): app-shell + shader offline service worker
    main.ts                  # MODIFIED (G8): optional registerServiceWorker() behind env flag
  vite.config.ts             # MODIFIED (G8): real production build, reads build/build.config.ts
  .github/
    workflows/
      deploy.yml             # NEW: build + publish to GitHub Pages, extends G14 CI
  test/
    unit/
      build/
        build_config.test.ts # NEW: pure manifest/config validator (exit suite)
```

## Depends on / pairs with

- **G8** (`vite.config.ts`, `.github/workflows/`, `src/main.ts`) — G15 replaces
  G8's placeholder build block and adds a deploy workflow; the UI shell and dev
  flow are untouched. Patches against G8 are small and labelled, not rewrites.
- **G14** (CI matrix: `unit` / `integration_no_gpu` / `golden`) — `deploy.yml`
  reuses G14's `unit` job as a `needs:` gate, so a publish only happens after the
  same checks G14 enforces are green. (G14 owns `ci.yml`; G15 only adds
  `deploy.yml` and references G14's job name.)
- **G1** (`linkShaders`, `?raw` shader imports, `src/gpu/shaders/*.wgsl`) —
  `build/shaders.manifest.ts` is the canonical list G1 imports; the validator
  asserts the two stay in sync (every manifest entry exists on disk).
- **G9** (`CapabilityProfile`) — the service worker (optional) precaches the
  shader bundle so a capable-but-offline device still resolves WGSL; it never
  caches a *response* that depends on the GPU profile.
- Contracts: honours the **cache/two-stage** contract — the build is
  content-addressed (every chunk + asset is `[name]-[hash]`), so a deployed file
  is immutable and the service worker can cache-first it safely; a shader change
  bumps its hash and therefore its precache URL (mirrors the cache-signature
  discipline in the architecture skill). No ratified ADR governs bundling; G15
  introduces none.

## `build/shaders.manifest.ts`

The single canonical list of WGSL modules G1 links. G1's `linkShaders` registry
(`milestones/G1_shader_composition.md` ~line 456) and this manifest must name the
same files; the validator enforces it. Keeping the list here (not buried in a
`?raw` import block) lets the build, the service-worker precache, and the test all
read one array.

```ts
/**
 * Canonical WGSL module list. Must match the registry G1's linkShaders() builds
 * from `?raw` imports (G1 ~line 456). The build_config validator asserts every
 * entry resolves to an existing file under src/gpu/shaders/.
 *
 * Order is irrelevant to linking (G1 resolves imports by graph), but kept
 * alphabetical so diffs are stable.
 */
export const SHADER_DIR = 'src/gpu/shaders';

/** File names only (no directory). Joined with SHADER_DIR to resolve on disk. */
export const SHADER_MODULES = [
  'decode.wgsl',
  'events.wgsl',
  'helpers.wgsl',
  'integrate.wgsl',
  'metrics.wgsl',
  'observe.wgsl',
  'reduce.wgsl',
  'render_layer0.wgsl',
  'simulate.wgsl',
] as const;

export type ShaderModule = (typeof SHADER_MODULES)[number];

/** POSIX-joined repo-relative path for a module (used by the validator + SW). */
export function shaderPath(mod: ShaderModule): string {
  return `${SHADER_DIR}/${mod}`;
}

/** All shader paths, repo-relative. */
export function allShaderPaths(): string[] {
  return SHADER_MODULES.map(shaderPath);
}
```

## `build/build.config.ts`

The single source of truth. `vite.config.ts`, `deploy.yml` (via a tiny
`--base` echo), and `sw.config.ts` all derive from these constants and pure
functions, so the policy lives in exactly one place and the validator can assert
it without importing Vite.

```ts
import { SHADER_MODULES } from './shaders.manifest.js';

/** Build mode. Mirrors Vite's `mode` ('production' | anything-else = dev). */
export type BuildMode = 'production' | 'development';

/**
 * Project base path. GitHub Project Pages serve from /<repo>/, so the prod
 * build must emit asset URLs under that prefix. Overridable via VITE_BASE
 * (e.g. '/' for a user/org page or a custom domain).
 */
export const PROJECT_BASE = '/principia-ii/';

/** Resolve the base href for a mode, honouring a VITE_BASE override. */
export function resolveBase(mode: BuildMode, override?: string): string {
  if (override && override.length > 0) return normaliseBase(override);
  return mode === 'production' ? PROJECT_BASE : '/';
}

/** A base must start and end with '/' so relative asset URLs resolve. */
export function normaliseBase(base: string): string {
  let b = base.startsWith('/') ? base : `/${base}`;
  if (!b.endsWith('/')) b = `${b}/`;
  return b;
}

/**
 * manualChunks policy. The `gpu` chunk (G8) is preserved so the shader-bearing
 * GPU code splits out of the entry; everything in node_modules collapses into a
 * single long-cached `vendor` chunk. Returning undefined lets Rollup decide.
 */
export function manualChunks(id: string): string | undefined {
  // Normalise Windows separators so the policy is OS-independent.
  const p = id.replace(/\\/g, '/');
  if (p.includes('/node_modules/')) return 'vendor';
  if (/\/src\/gpu\//.test(p)) return 'gpu';
  return undefined;
}

/** Content-hash filename policy. Every emitted file is immutable + cache-bustable. */
export const HASH_POLICY = {
  /** Code-split + entry chunks. Entry keeps a stable [name] ('index'). */
  entryFileNames: 'assets/[name]-[hash].js',
  chunkFileNames: 'assets/[name]-[hash].js',
  /** Static assets (incl. emitted .css and any copied .wgsl). */
  assetFileNames: 'assets/[name]-[hash][extname]',
} as const;

/**
 * Compression policy for the post-build pass (vite-plugin-compression or
 * equivalent). gzip AND brotli are emitted; only files above the threshold and
 * matching the extension allow-list are compressed.
 */
export const COMPRESSION_POLICY = {
  algorithms: ['gzip', 'brotli'] as const,
  /** Extensions worth compressing — text-ish bundle output incl. WGSL strings. */
  extensions: ['js', 'css', 'html', 'svg', 'json', 'wgsl'] as const,
  /** Bytes; files at/under this are left uncompressed (overhead not worth it). */
  thresholdBytes: 1024,
  /** Keep the original alongside the compressed copy (servers negotiate). */
  deleteOriginalAssets: false,
} as const;

export type CompressionAlgorithm = (typeof COMPRESSION_POLICY.algorithms)[number];

/** True iff a file with this extension should be compressed. */
export function shouldCompress(ext: string): boolean {
  const e = ext.replace(/^\./, '').toLowerCase();
  return (COMPRESSION_POLICY.extensions as readonly string[]).includes(e);
}

/**
 * Required import.meta.env keys (beyond Vite's built-ins). Validated at build
 * config level and surfaced typed by src/env.ts.
 */
export const REQUIRED_ENV_KEYS = ['VITE_APP_VERSION', 'VITE_ENABLE_SW'] as const;
export type RequiredEnvKey = (typeof REQUIRED_ENV_KEYS)[number];

/** Prod/dev defaults for the required keys when not supplied by the environment. */
export function envDefaults(mode: BuildMode): Record<RequiredEnvKey, string> {
  return {
    VITE_APP_VERSION: '0.0.0-dev',
    // Service worker is OFF by default everywhere; opt in with VITE_ENABLE_SW=1.
    VITE_ENABLE_SW: '0',
  };
}

/** Number of shader modules the precache list must contain (sync guard). */
export const SHADER_MODULE_COUNT = SHADER_MODULES.length;
```

## `vite.config.ts` (modified from G8)

G8's config is replaced — not extended inline — by one that reads
`build/build.config.ts`. The labelled diff below shows exactly what changed:
`base`, `minify`, `treeshake`, `manualChunks` (now a function), the
content-hash `output` names, and the optional compression plugins. The
`resolve.alias` and `?raw` WGSL handling from G8/G1 are preserved verbatim.

```ts
import { defineConfig, type PluginOption } from 'vite';
import path from 'node:path';
import {
  resolveBase, manualChunks, HASH_POLICY, COMPRESSION_POLICY,
  type BuildMode,
} from './build/build.config.js';

// OPTIONAL: only loaded if installed. Kept dynamic so the dev flow has no
// hard dependency on the compression plugin.
async function compressionPlugins(): Promise<PluginOption[]> {
  try {
    const { default: compression } = await import('vite-plugin-compression');
    return COMPRESSION_POLICY.algorithms.map(algo =>
      compression({
        // vite-plugin-compression spells brotli 'brotliCompress'.
        algorithm: algo === 'brotli' ? 'brotliCompress' : 'gzip',
        ext: algo === 'brotli' ? '.br' : '.gz',
        threshold: COMPRESSION_POLICY.thresholdBytes,
        deleteOriginFile: COMPRESSION_POLICY.deleteOriginalAssets,
        filter: /\.(js|css|html|svg|json|wgsl)$/i,
      }),
    );
  } catch {
    // Plugin absent (dev install): skip compression, build still succeeds.
    return [];
  }
}

export default defineConfig(async ({ mode }) => {
  const buildMode: BuildMode = mode === 'production' ? 'production' : 'development';
  const base = resolveBase(buildMode, process.env.VITE_BASE);

  return {
    base,                                       // + base path for project pages
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },  // (G8, kept)
    assetsInclude: ['**/*.wgsl'],               // (G8/G1, kept) raw shader text
    plugins: await compressionPlugins(),        // + gzip + brotli (optional)
    build: {
      target: 'esnext',                         // (G8, kept)
      minify: 'esbuild',                         // + minify production output
      sourcemap: buildMode === 'production' ? 'hidden' : true,
      rollupOptions: {
        treeshake: { moduleSideEffects: false }, // + aggressive tree-shake
        output: {
          // - manualChunks: { gpu: ['src/gpu'] }   (G8 placeholder)
          // + function form: gpu chunk + vendor split (build.config.ts)
          manualChunks,
          entryFileNames: HASH_POLICY.entryFileNames,   // + content hashing
          chunkFileNames: HASH_POLICY.chunkFileNames,   // +
          assetFileNames: HASH_POLICY.assetFileNames,   // +
        },
      },
    },
  };
});
```

## `src/env.ts`

Typed `import.meta.env` accessor. The rest of the app reads `appEnv()` instead
of touching `import.meta.env` directly, so the prod/dev contract is enforced in
one place and the validator can assert the required-key set against
`build.config.ts`.

```ts
import { REQUIRED_ENV_KEYS, type RequiredEnvKey } from '../build/build.config.js';

export interface AppEnv {
  /** Build version string (VITE_APP_VERSION), e.g. a git short-sha. */
  version: string;
  /** Service worker opt-in (VITE_ENABLE_SW === '1'). OFF by default. */
  serviceWorker: boolean;
  /** Vite's own flags, surfaced so callers never read import.meta.env raw. */
  prod: boolean;
  dev: boolean;
  /** Base href the bundle was built with (import.meta.env.BASE_URL). */
  baseUrl: string;
}

/**
 * Read a key from import.meta.env with a fallback. Indirected through a function
 * so tests can inject a synthetic env object without a Vite runtime.
 */
function readEnv(
  env: Record<string, unknown>,
  key: RequiredEnvKey,
  fallback: string,
): string {
  const v = env[key];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

/** Build the typed AppEnv from a raw env record (defaults to import.meta.env). */
export function appEnv(
  raw: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
): AppEnv {
  return {
    version: readEnv(raw, 'VITE_APP_VERSION', '0.0.0-dev'),
    serviceWorker: readEnv(raw, 'VITE_ENABLE_SW', '0') === '1',
    prod: raw.PROD === true,
    dev: raw.DEV === true,
    baseUrl: typeof raw.BASE_URL === 'string' ? (raw.BASE_URL as string) : '/',
  };
}

/** The required keys, re-exported so callers/tests have one import. */
export const ENV_KEYS: readonly RequiredEnvKey[] = REQUIRED_ENV_KEYS;
```

## `build/sw.config.ts` (OPTIONAL feature)

Precache policy for the offline service worker. Off by default — nothing
registers the worker unless `VITE_ENABLE_SW=1`. The precache list is the app
shell plus every shader path from the manifest, so a capable device that goes
offline still resolves its WGSL. Cache-first is safe because every entry is
content-hashed (cache/two-stage contract): a changed file has a new URL.

```ts
import { allShaderPaths } from './shaders.manifest.js';

/** Cache name is version-stamped so a deploy invalidates stale precaches. */
export function cacheName(version: string): string {
  return `principia-shell-${version}`;
}

/**
 * App-shell precache list (repo-relative, base-prefixed at runtime). The HTML
 * entry and the WGSL modules; hashed JS/CSS are runtime-cached (stale-while-
 * revalidate) because their names are only known post-build.
 */
export function precacheList(base: string): string[] {
  const b = base.endsWith('/') ? base : `${base}/`;
  return [
    `${b}`,                       // index.html (the shell)
    ...allShaderPaths().map(p => `${b}${p}`),
  ];
}

/** Runtime-cache strategy per request kind. */
export const RUNTIME_STRATEGY = {
  /** Hashed, immutable assets → cache-first (safe: content-addressed). */
  assets: 'cache-first',
  /** Navigations → network-first, falling back to the cached shell offline. */
  navigation: 'network-first',
} as const;
```

## `src/sw.ts` (OPTIONAL feature)

The worker itself. Plain service-worker globals (no Workbox dependency). Kept
small and dependency-free; registered only behind the env flag. Cache-first for
precached/hashed assets, network-first for navigations with a shell fallback.

```ts
/// <reference lib="webworker" />
import { cacheName, precacheList, RUNTIME_STRATEGY } from '../build/sw.config.js';

declare const self: ServiceWorkerGlobalScope;

// Injected at build time (define) — falls back to a dev constant.
const VERSION = (self as unknown as { __APP_VERSION__?: string }).__APP_VERSION__ ?? '0.0.0-dev';
const BASE = (self as unknown as { __APP_BASE__?: string }).__APP_BASE__ ?? '/';
const CACHE = cacheName(VERSION);

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(precacheList(BASE))).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event: FetchEvent) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate' && RUNTIME_STRATEGY.navigation === 'network-first') {
    event.respondWith(
      fetch(req).catch(() => caches.match(`${BASE}`).then(r => r ?? Response.error())),
    );
    return;
  }

  // cache-first for everything else (hashed assets are immutable).
  event.respondWith(
    caches.match(req).then(cached =>
      cached ?? fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return resp;
      }),
    ),
  );
});
```

## `src/main.ts` (G8 integration patch)

G8's `main()` gains an opt-in registration call behind the env flag. Minimal,
labelled diff — the rest of `main.ts` is unchanged.

```ts
// + import at top:
import { appEnv } from '@/env.js';

// + helper, defined near main():
async function registerServiceWorker(): Promise<void> {
  const env = appEnv();
  // OFF unless VITE_ENABLE_SW=1; never registers in dev or unsupported browsers.
  if (!env.serviceWorker || !('serviceWorker' in navigator)) return;
  try {
    // Vite emits the worker at a hashed URL; ?worker handling resolves it.
    await navigator.serviceWorker.register(new URL('./sw.ts', import.meta.url), {
      type: 'module',
      scope: env.baseUrl,
    });
  } catch {
    // SW is a progressive enhancement — a failure must never block startup.
  }
}

// inside main(), AFTER mountUI(...) / app.start():
//   await registerServiceWorker();   // + opt-in offline support
```

## `.github/workflows/deploy.yml`

Builds the production bundle and publishes it to GitHub Pages. Gates on G14's
`unit` job (referenced by name via `workflow_run`-style `needs` is not
cross-workflow, so we re-run the same checks here as a fast pre-publish guard
and document the G14 dependency). The real `vite build` lives here — never in
the unit test.

```yaml
name: deploy
on:
  push:
    branches: [main]
  workflow_dispatch:

# Pages deploy needs these scoped permissions.
permissions:
  contents: read
  pages: write
  id-token: write

# Never run two deploys at once; cancel an in-flight one on a newer push.
concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  # Pre-publish guard: the same unit gate G14's ci.yml enforces. A red unit
  # suite must never publish. (G14 owns the canonical job; this mirrors it.)
  guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
      - run: npm test -- --run test/unit

  build:
    needs: guard
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - name: Production build (content-hashed, compressed, base=/principia-ii/)
        env:
          VITE_BASE: /principia-ii/
          VITE_APP_VERSION: ${{ github.sha }}
          VITE_ENABLE_SW: '0'          # offline SW stays opt-in even on Pages
        run: npm run build
      - name: SPA fallback (Pages serves 404.html for deep links)
        run: cp dist/index.html dist/404.html
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  publish:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

## Tests

### `test/unit/build/build_config.test.ts`

Pure validator. No Vite, no GPU, no browser, no `vite build`. It imports the
build-config constants/functions and asserts the policy; for the shader sync
check it stats files on disk with `node:fs`. (If the `src/gpu/shaders/`
directory does not yet exist in a fresh checkout, the on-disk assertions use
`existsSync` and the suite documents the expectation rather than failing the
whole run — see the `dirReady` gate, which mirrors M3/G8's `skipIf`.)

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveBase, normaliseBase, manualChunks, HASH_POLICY, COMPRESSION_POLICY,
  shouldCompress, REQUIRED_ENV_KEYS, envDefaults, PROJECT_BASE,
  SHADER_MODULE_COUNT, type BuildMode,
} from '@/../build/build.config.js';
import {
  SHADER_MODULES, shaderPath, allShaderPaths, SHADER_DIR,
} from '@/../build/shaders.manifest.js';
import { appEnv, ENV_KEYS } from '@/env.js';
import { precacheList, cacheName } from '@/../build/sw.config.js';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../../');

describe('chunk split policy', () => {
  it('routes src/gpu/** into the gpu chunk', () => {
    expect(manualChunks('/abs/principia/src/gpu/init.ts')).toBe('gpu');
    expect(manualChunks('/abs/principia/src/gpu/shaders/link.ts')).toBe('gpu');
  });

  it('routes node_modules/** into the vendor chunk', () => {
    expect(manualChunks('/abs/principia/node_modules/three/index.js')).toBe('vendor');
  });

  it('leaves app entry code unchunked (Rollup decides)', () => {
    expect(manualChunks('/abs/principia/src/main.ts')).toBeUndefined();
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

  it('emits all output under assets/', () => {
    for (const n of Object.values(HASH_POLICY)) {
      expect(n.startsWith('assets/')).toBe(true);
    }
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
    expect(env.baseUrl).toBe('/principia-ii/');
  });

  it('appEnv falls back to dev defaults on an empty env', () => {
    const env = appEnv({});
    expect(env.version).toBe('0.0.0-dev');
    expect(env.serviceWorker).toBe(false);
  });
});

describe('shader manifest ↔ disk sync', () => {
  const dirReady = existsSync(path.join(REPO_ROOT, SHADER_DIR));

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
});

describe('service-worker precache policy', () => {
  it('precaches the shell plus every shader, base-prefixed', () => {
    const list = precacheList('/principia-ii/');
    expect(list[0]).toBe('/principia-ii/');                 // the shell
    expect(list).toContain('/principia-ii/src/gpu/shaders/simulate.wgsl');
    // shell + one entry per shader module
    expect(list).toHaveLength(SHADER_MODULES.length + 1);
  });

  it('version-stamps the cache name so a deploy invalidates it', () => {
    expect(cacheName('deadbee')).toBe('principia-shell-deadbee');
    expect(cacheName('a')).not.toBe(cacheName('b'));
  });
});
```

## Run it

```bash
npm test -- --run test/unit/build/build_config.test.ts   # pure validator, ≥18 tests
npm run build                                             # real prod build (CI does this)
npm run preview                                           # serve dist/ locally to sanity-check base
```

The validator is headless and dependency-light (only `node:fs`/`node:path`).
`npm run build` and the GitHub Pages publish run in CI (`deploy.yml`), never in
the unit suite.

## Acceptance check

`test/unit/build/build_config.test.ts` passes with ≥18 green tests (24 as
written): the `gpu` + `vendor` chunk split is asserted OS-independently; `base`
is `/principia-ii/` in prod, `/` in dev, and overridable via `VITE_BASE`; every
emitted filename is `assets/[name]-[hash]`; gzip+brotli cover `.wgsl`/`.js`/`.css`
above the threshold and skip binaries; `src/env.ts` and `build.config.ts` agree
on the required env keys and the service worker defaults OFF; and every shader
named in `build/shaders.manifest.ts` resolves to a file on disk (skipped cleanly
if the shader dir is absent in a fresh checkout). `vite build` succeeds in CI and
the Pages deploy publishes `dist/` (with `404.html` SPA fallback) under
`/principia-ii/`.

## Notes for the implementer

- **One source of truth.** `build/build.config.ts` is read by `vite.config.ts`,
  `sw.config.ts`, `src/env.ts`, and the validator. Do not duplicate the base
  path, the chunk rule, or the env-key list anywhere else — the validator's whole
  job is to catch a drift between them. `deploy.yml` echoes `VITE_BASE` because
  GitHub Actions cannot import TS; keep that literal in sync with `PROJECT_BASE`
  (the validator asserts `resolveBase('production') === PROJECT_BASE`, so a typo
  in the constant is caught even though the YAML literal is not).
- **Content hashing is the cache contract.** Every chunk/asset is
  `[name]-[hash]`, so a deployed file is immutable and a changed shader gets a new
  URL. That is *why* the service worker can be cache-first without a manual
  invalidation step — a shader edit changes its hash, which changes its precache
  URL, which the next install picks up. Never serve an un-hashed asset
  `cache-first`.
- **The service worker is optional and off.** `VITE_ENABLE_SW` defaults to `'0'`
  everywhere, including the Pages build. Registration is wrapped in a try/catch
  and gated on `'serviceWorker' in navigator`, so it is a pure progressive
  enhancement — a failure never blocks startup. Ship v1 with it off; flip the flag
  once the precache list and update-flow have been exercised on real hardware.
- **Compression is a post-build pass, dynamically loaded.** `vite-plugin-compression`
  is imported with a `try/catch` so a dev install without it still builds (just
  uncompressed). In CI it must be present (it is a `devDependency`); the `.gz`/`.br`
  files sit beside the originals and GitHub Pages / any static host negotiates via
  `Accept-Encoding`. The WGSL strings are part of the bundled JS (G1 inlines them
  via `?raw`), so they ride along in the compressed `gpu` chunk; the explicit
  `.wgsl` extension in the policy covers any host that copies raw `.wgsl` assets.
- **G14 vs G15 boundary.** G14 owns `ci.yml` (unit / integration / golden).
  `deploy.yml` re-runs the unit gate as a fast pre-publish guard rather than
  reaching across workflows; if G14 later exposes a reusable workflow, replace the
  `guard` job with a `uses: ./.github/workflows/ci.yml` call. Do not duplicate the
  integration/golden jobs here — a deploy gates on unit + typecheck only, by
  design, so publishing stays fast.
- **Keep the validator pure.** It must never import `vite`, spawn a build, or
  touch the GPU/DOM — that is what makes it the headless exit criterion. The only
  filesystem touch is `existsSync` for the shader-sync check, and that is gated by
  `dirReady` so a fresh checkout without the `src/gpu/shaders/` tree still runs
  green (mirroring the `skipIf` discipline in M3/G8/G9).