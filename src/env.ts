import { REQUIRED_ENV_KEYS, type RequiredEnvKey } from '../build/build.config.js';

/**
 * Typed import.meta.env accessor (G15). The rest of the app reads appEnv()
 * instead of touching import.meta.env directly, so the prod/dev contract is
 * enforced in one place and the validator can assert the required-key set
 * against build.config.ts.
 */
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

// NOT import.meta.env: Vite only statically replaces `import.meta.env.KEY`
// property accesses — a bare `import.meta.env` survives the build verbatim
// and is undefined at runtime (verified on the emitted bundle), so every
// field would silently fall back. Instead vite.config.ts `define` injects
// these bare identifiers (build AND dev server); the typeof guards keep
// plain tsc / Node / vitest runs safe, where they fall back to dev values.
declare const __APP_VERSION__: string;
declare const __APP_BASE__: string;
declare const __APP_SW_ENABLED__: string;
declare const __APP_PROD__: boolean;

function rawEnv(): Record<string, unknown> {
  const prod = typeof __APP_PROD__ === 'boolean' ? __APP_PROD__ : false;
  return {
    VITE_APP_VERSION: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : undefined,
    VITE_ENABLE_SW: typeof __APP_SW_ENABLED__ === 'string' ? __APP_SW_ENABLED__ : undefined,
    PROD: prod,
    DEV: !prod,
    BASE_URL: typeof __APP_BASE__ === 'string' ? __APP_BASE__ : '/',
  };
}

/** Read a required key with a fallback; empty strings count as unset. */
function readEnv(
  env: Record<string, unknown>,
  key: RequiredEnvKey,
  fallback: string,
): string {
  const v = env[key];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

/** Build the typed AppEnv from a raw env record (defaults to import.meta.env). */
export function appEnv(raw: Record<string, unknown> = rawEnv()): AppEnv {
  return {
    version: readEnv(raw, 'VITE_APP_VERSION', '0.0.0-dev'),
    serviceWorker: readEnv(raw, 'VITE_ENABLE_SW', '0') === '1',
    prod: raw['PROD'] === true,
    dev: raw['DEV'] === true,
    baseUrl: typeof raw['BASE_URL'] === 'string' ? raw['BASE_URL'] : '/',
  };
}

/** The required keys, re-exported so callers/tests have one import. */
export const ENV_KEYS: readonly RequiredEnvKey[] = REQUIRED_ENV_KEYS;
