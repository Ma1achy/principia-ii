import { cacheName, precacheList, RUNTIME_STRATEGY } from '../build/sw.config.js';

/**
 * App-shell offline service worker (G15, OPTIONAL — registered only when
 * VITE_ENABLE_SW=1; see dev/main.ts registerServiceWorker()).
 *
 * Precaches the shell, cache-firsts hashed immutable assets (which is safe
 * because every emitted file is content-addressed — a changed shader gets a
 * new gpu-chunk hash and therefore a new URL), and network-firsts
 * navigations with the cached shell as the offline fallback.
 *
 * Typed structurally instead of `/// <reference lib="webworker" />`: the
 * project compiles with lib DOM (tsconfig is program-wide), and the DOM and
 * WebWorker libs declare conflicting globals. Request/Response/CacheStorage
 * all exist in the DOM lib already; only the SW-specific surface is declared.
 */

interface ExtendableEventLike extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  respondWith(r: Promise<Response> | Response): void;
}
interface SwScope {
  addEventListener(type: 'install' | 'activate', fn: (e: ExtendableEventLike) => void): void;
  addEventListener(type: 'fetch', fn: (e: FetchEventLike) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
}

const sw = self as unknown as SwScope;

// Injected by vite.config.ts `define` as bare identifiers (define does not
// rewrite property accesses); the typeof guards keep dev/tsc runs safe.
declare const __APP_VERSION__: string;
declare const __APP_BASE__: string;
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
const BASE = typeof __APP_BASE__ === 'string' ? __APP_BASE__ : '/';
const CACHE = cacheName(VERSION);

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(precacheList(BASE)))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('fetch', (event: FetchEventLike) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate' && RUNTIME_STRATEGY.navigation === 'network-first') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(BASE).then((r) => r ?? Response.error())),
    );
    return;
  }

  // cache-first for everything else (hashed assets are immutable).
  event.respondWith(
    caches.match(req).then((cached) =>
      cached ?? fetch(req).then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          void caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return resp;
      }),
    ),
  );
});
