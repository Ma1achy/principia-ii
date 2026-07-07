import { SHADER_MODULES } from './shaders.manifest.js';

/** Build mode. Mirrors Vite's `mode` ('production' | anything-else = dev). */
export type BuildMode = 'production' | 'development';

/**
 * Project base path. GitHub Project Pages serve from /<repo>/, so the prod
 * build must emit asset URLs under that prefix. Overridable via VITE_BASE
 * (e.g. '/' for a user/org page or a custom domain).
 */
export const PROJECT_BASE = '/principia-ii/';

/**
 * Where `vite build` emits the site. NOT `dist/` — that directory is owned
 * by `npm run build` (tsc), whose output `npm run gpu:check` and the
 * dev/out/*.mjs page checks import. Vite's emptyOutDir would clobber it.
 */
export const SITE_OUT_DIR = 'dist-web';

/** Resolve the base href for a mode, honouring a VITE_BASE override. */
export function resolveBase(mode: BuildMode, override?: string): string {
  if (override !== undefined && override.length > 0) return normaliseBase(override);
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
 * GPU code (including the `?raw`-inlined WGSL strings) splits out of the
 * entry; anything from node_modules collapses into a single long-cached
 * `vendor` chunk. Returning undefined lets Rollup decide.
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
 * The service worker is the one un-hashed emission: its URL must be stable
 * across deploys or the browser can never find the update.
 */
export const SW_FILE = 'sw.js';

/**
 * Compression policy for the post-build pass (a zlib walk in vite.config.ts).
 * gzip AND brotli are emitted; only files above the threshold and matching
 * the extension allow-list are compressed.
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
  void mode; // identical in both modes today; the mode param is the contract
  return {
    VITE_APP_VERSION: '0.0.0-dev',
    // Service worker is OFF by default everywhere; opt in with VITE_ENABLE_SW=1.
    VITE_ENABLE_SW: '0',
  };
}

/** Number of shader modules the manifest must contain (sync guard). */
export const SHADER_MODULE_COUNT = SHADER_MODULES.length;
