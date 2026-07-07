# G15 — Build, bundling, deploy & hosting

*(Folded back as-built. The original plan predated several landed facts — the
`build`/`build:web` script split, the `dev/main.ts` boot home, the `?raw`
WGSL inlining that makes raw-shader precache impossible, and the Vite 8
upgrade — see the reconciliation notes and `docs/build-decisions-ledger.md`
DG15.x.)*

## Goal

G8 shipped a *placeholder* `vite.config.ts`: alias + `assetsInclude` for
`**/*.wgsl` and nothing else — fine for `npm run dev`, but it cannot produce
a deployable artifact: GitHub Pages serves from a subpath
(`/principia-ii/`), the bundle ships uncompressed, and no workflow builds
and publishes the site.

G15 turned the placeholder into a **real production build + a hosting
pipeline**: a hardened `vite.config.ts` (minify, content-hashed chunks, the
`gpu` chunk preserved, configurable `base`), a zero-dependency gzip/brotli
post-build pass, `import.meta.env` injection through a typed `src/env.ts`,
a GitHub Pages deploy workflow, and an **optional** offline service worker
(off by default) that precaches the app shell.

The single source of truth is `build/build.config.ts` — the Vite config,
the deploy workflow, and the service worker all read it. The exit test is a
**pure manifest/config validator**: it never runs `vite build`, never
touches a GPU, never starts a browser — the real `vite build` runs in CI's
deploy workflow, mirroring how M3/G8 gate real-GPU work.

**Exit criterion (single executable test).**

```bash
npm test -- --run test/unit/build/build_config.test.ts
```

passes with at least **18 green tests** (30 as landed) covering: the
canonical chunk split, the `base` path policy, the content-hash filename
policy, the compression policy, the typed `import.meta.env` contract, the
shader manifest ↔ disk sync (both directions), and the service-worker
precache policy.

**Deliverable:** a deployable site — a hardened production `vite build`
(hashed chunks, gzip+brotli output, configurable `base`) published to
GitHub Pages at `/principia-ii/` by `deploy.yml` on push to
`webgpu-rewrite`, with an optional offline service worker; the
`build/build.config.ts` source of truth is pinned by
`test/unit/build/build_config.test.ts`.

## File tree (as landed)

```
principia/
  build/
    build.config.ts          # NEW: single source of truth — chunks, base, hash, compression, env
    shaders.manifest.ts      # NEW: the canonical list of src/gpu/shaders/*.wgsl (all 16)
    sw.config.ts             # NEW: service-worker precache policy (OPTIONAL, off by default)
  src/
    env.ts                   # NEW: typed import.meta.env accessor (safe structural cast)
    sw.ts                    # NEW (OPTIONAL): app-shell offline service worker
  dev/
    main.ts                  # MODIFIED (G8 boot): registerServiceWorker() behind env flag
  vite.config.ts             # MODIFIED (G8): real production build, reads build/build.config.ts
  .github/workflows/
    deploy.yml               # NEW: build + publish to GitHub Pages (webgpu-rewrite, NEVER main)
  test/unit/build/
    build_config.test.ts     # NEW: pure manifest/config validator (exit suite, 30 tests)
```

## Reconciliations against the landed codebase

The original doc was written before several facts landed. Each defect below
was reconciled with evidence, not silently patched (ledger DG15.1–DG15.6):

1. **`npm run build` is `tsc`, not Vite.** The landed `build` script is
   `tsc -p tsconfig.json`, and `npm run gpu:check` + the `dev/out/*.mjs`
   page checks import its `dist/` output. The site build is the (already
   landed) `build:web` script, and it emits to **`dist-web/`**
   (`SITE_OUT_DIR`) — Vite's `emptyOutDir` on a shared `dist/` would
   clobber the tsc output gpu:check needs.
2. **`src/main.ts` does not exist.** The shell boot is `dev/main.ts`
   (outside tsconfig's include, because the `?raw` shader imports have no
   d.ts and `src/` must stay tsc-clean — G1 convention). The SW
   registration patch lives there.
3. **The doc's `deploy.yml` triggered on `main` — forbidden.** `main` is
   the untouchable historical PoC (CLAUDE.md branch policy). The workflow
   triggers on `webgpu-rewrite`.
4. **Raw-WGSL precache would brick the SW install.** G1 inlines every
   shader into the `gpu` chunk via `?raw`; production `dist-web/` contains
   **no** `src/gpu/shaders/*.wgsl`, and `cache.addAll` of a 404 rejects the
   whole install. `precacheList` is the shell only; the WGSL rides inside
   the hashed gpu chunk, which the runtime cache-first strategy captures.
5. **The doc's 9-module manifest was stale.** `src/gpu/shaders/` holds
   **16** WGSL files. The manifest lists all 16, and the validator checks
   **both directions** (manifest→disk and disk→manifest via `readdirSync`
   equality), so the manifest can never silently drift.
6. **`vite-plugin-compression` targets Vite 2/3; the repo is on Vite 8.**
   The compression pass is ~30 lines of `node:zlib` in `vite.config.ts`
   (walk `dist-web/`, gzip+brotli files matching `COMPRESSION_POLICY`),
   with zero new dependencies.

## `build/shaders.manifest.ts`

The canonical WGSL module list (all 16 on-disk files, alphabetical). G1 has
no central registry — `wgslLink` is a per-entry linker fed an explicit
sources map (`dev/shader_modules.ts`) — so this manifest is the build's own
source of truth, and the validator's two-directional disk sync is the drift
guard. Exports: `SHADER_DIR`, `SHADER_MODULES`, `shaderPath()`,
`allShaderPaths()`.

## `build/build.config.ts`

The single source of truth. Landed surface:

- `PROJECT_BASE = '/principia-ii/'`, `resolveBase(mode, override?)`,
  `normaliseBase(base)` — prod base is the project-pages subpath, dev is
  `/`, `VITE_BASE` overrides (normalised to leading+trailing slash).
- `SITE_OUT_DIR = 'dist-web'` — never `dist/` (tsc owns it, see above).
- `manualChunks(id)` — `node_modules` → `vendor`, `src/gpu/**` → `gpu`
  (the shader-bearing chunk), else Rollup decides. OS-path-independent.
- `HASH_POLICY` — `assets/[name]-[hash]` for entry/chunk/asset names.
- `SW_FILE = 'sw.js'` — the one **un-hashed** emission: a hashed SW URL
  could never be found again across deploys.
- `COMPRESSION_POLICY` + `shouldCompress(ext)` — gzip + brotli over
  `js/css/html/svg/json/wgsl` above 1024 bytes; originals kept.
- `REQUIRED_ENV_KEYS = ['VITE_APP_VERSION', 'VITE_ENABLE_SW']` +
  `envDefaults(mode)` — SW defaults `'0'` in every mode.
- `SHADER_MODULE_COUNT` — manifest count pin.

## `vite.config.ts` (as landed)

Reads `build/build.config.ts`; G8's alias + `assetsInclude` kept verbatim.

- `base` from `resolveBase(mode, process.env.VITE_BASE)`.
- `define`: `__APP_VERSION__` / `__APP_BASE__` / `__APP_SW_ENABLED__` /
  `__APP_PROD__` as **bare identifiers** — the one env channel into the
  bundle, consumed by `src/env.ts` and `src/sw.ts` (define never rewrites
  property accesses, and bare `import.meta.env` is never populated — the
  doc's patterns for both would have silently produced dev defaults).
- `build.outDir = SITE_OUT_DIR`; `minify: 'esbuild'`; sourcemaps `hidden`
  in production.
- `rollupOptions.input`: `index.html` **plus `src/sw.ts` as a second
  entry**, with `entryFileNames` a function that emits the sw chunk as the
  stable root-scoped `sw.js` and everything else hashed.
- `treeshake.moduleSideEffects: 'no-external'` — NOT the doc's `false`,
  which would have dropped the side-effect `import '@/ui/styles.css'` and
  shipped an unstyled shell.
- `principia:compress` plugin — the zlib walk in `closeBundle`.

## `src/env.ts`

Typed accessor: `appEnv(raw?) → AppEnv { version, serviceWorker, prod,
dev, baseUrl }` with empty-string-counts-as-unset fallbacks, plus
`ENV_KEYS` re-export. The default source is **NOT `import.meta.env`**:
Vite only statically replaces `import.meta.env.KEY` property accesses — a
bare `import.meta.env` survives the build verbatim and is `undefined` at
runtime (verified on the emitted bundle: the flag-on build silently never
registered the SW until this was fixed). Instead, `vite.config.ts`
`define` injects `__APP_VERSION__` / `__APP_BASE__` / `__APP_SW_ENABLED__`
/ `__APP_PROD__` as bare identifiers (build AND dev server), and `rawEnv()`
reads them behind `typeof` guards so plain tsc / Node / vitest runs fall
back to dev values. The `raw` parameter keeps the accessor testable
without any Vite runtime.

## `build/sw.config.ts` + `src/sw.ts` (OPTIONAL feature)

Off by default — nothing registers the worker unless `VITE_ENABLE_SW=1`.

- `cacheName(version)` — version-stamped so a deploy invalidates stale
  precaches. `precacheList(base)` — **the shell only** (see reconciliation
  4). `RUNTIME_STRATEGY` — hashed assets cache-first (safe: every emitted
  file is content-addressed and immutable), navigations network-first with
  the cached shell as offline fallback.
- `src/sw.ts` is typed **structurally** (local `ExtendableEventLike` /
  `FetchEventLike` / `SwScope` interfaces) instead of
  `/// <reference lib="webworker" />` — lib references are program-wide and
  the DOM and WebWorker libs declare conflicting globals. Only `resp.ok`
  responses are runtime-cached. Version/base arrive via the `define`
  identifiers with `typeof` guards for dev/tsc runs.
- Registration (`dev/main.ts`): `navigator.serviceWorker.register(
  `${env.baseUrl}sw.js`, { scope: env.baseUrl })` behind the env flag, in a
  try/catch — a pure progressive enhancement that never blocks startup.

## `.github/workflows/deploy.yml`

`on: push: branches: [webgpu-rewrite]` + `workflow_dispatch`; Pages
permissions; `concurrency: pages` with cancel-in-progress. Jobs:

- **guard** — mirrors G8's canonical unit gate (lint → typecheck →
  `npm test -- --run test/unit`); a red suite must never publish (`needs:`
  cannot reach across workflows, so it is re-run here).
- **build** — `npm run build:web` with `VITE_BASE=/principia-ii/`,
  `VITE_APP_VERSION=${{ github.sha }}`, `VITE_ENABLE_SW='0'`; copies
  `index.html` → `404.html` (SPA fallback); uploads `dist-web/`.
- **publish** — `actions/deploy-pages@v4` into the `github-pages`
  environment.

## Tests

`test/unit/build/build_config.test.ts` — 30 tests: chunk split (4), base
policy (4), hash policy incl. `SW_FILE`/`SITE_OUT_DIR` pins (5),
compression (4), env contract (5), shader manifest ↔ disk **both
directions** (4, disk checks `skipIf`-gated on the shader dir existing),
SW precache policy (4). Pure: the only filesystem touch is
`existsSync`/`readdirSync` for the shader sync.

## Run it

```bash
npm test -- --run test/unit/build/build_config.test.ts  # pure validator, 30 tests
npm run build:web                                        # real prod build → dist-web/
npm run preview                                          # serve dist-web/ under /principia-ii/
node dev/out/g15_site_check.mjs                          # boot the BUILT bundle on a real GPU
```

## Acceptance check

30/30 validator tests green (gate ≥18). Verified beyond the gate, on Metal:
`npm run build:web` emits hashed entry + `gpu` chunk + stable `sw.js` +
`.gz`/`.br` pairs; `vite preview` serves the shell, gpu chunk, and sw.js
(200s) under `/principia-ii/`; the **built production bundle** boots headed
on a real GPU, converges the frontier at research tier with zero console
errors; with `VITE_ENABLE_SW=1` the worker registers at
`/principia-ii/sw.js` with the correct scope and the version-stamped
precache appears. Full regression battery green: 715 unit tests, unpiped
lint, typecheck, gpu:check, all four page checks, headless test:gpu floor,
and the full `PW_REAL_GPU=1` headed suite 10/10.

## Notes for the implementer

- **One source of truth.** `build/build.config.ts` is read by
  `vite.config.ts`, `sw.config.ts`, `src/env.ts`, and the validator.
  `deploy.yml` echoes `VITE_BASE` because Actions cannot import TS; the
  validator asserts `resolveBase('production') === PROJECT_BASE` so a typo
  in the constant is caught even though the YAML literal is not.
- **Content hashing is the cache contract.** Every chunk/asset is
  `[name]-[hash]`, so a deployed file is immutable and a changed shader
  gets a new gpu-chunk URL. That is *why* the SW can be cache-first without
  manual invalidation. Never serve an un-hashed asset cache-first — the SW
  itself (`sw.js`) is deliberately un-hashed and therefore **never**
  runtime-cached by the cache-first arm on a fresh install (the browser's
  SW update machinery owns its freshness).
- **The service worker is optional and off.** `VITE_ENABLE_SW` defaults to
  `'0'` everywhere including the Pages build. Ship v1 with it off; flip the
  flag once the update flow has been exercised on real hardware.
- **`build/` sits outside tsconfig's include but inside the program** —
  tsc follows the `src/env.ts` → `../build/build.config.js` import. The
  inferred rootDir was already the repo root (include spans `src/` and
  `test/`), so `dist/` layout is unchanged and gpu:check is unaffected.
- **Keep the validator pure.** It must never import `vite`, spawn a build,
  or touch the GPU/DOM. The `skipIf(dirReady)` gate mirrors the M3/G8/G9
  discipline so a fresh checkout still runs green.
