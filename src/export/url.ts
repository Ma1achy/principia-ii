import type { ViewState } from '@/interact/view_state.js';

/**
 * URL-safe encode/decode for `ViewState`. Uses base64url over the JSON
 * representation; the output is verbose (~3 KB for a typical state) but
 * round-trips losslessly. Production code may swap in MessagePack
 * + brotli for shorter URLs; the contract here is stability of the
 * encoded form across sessions.
 */
export function encodeViewStateUrl(v: ViewState): string {
  const json = JSON.stringify(v);
  if (typeof btoa !== 'undefined') {
    return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  // Node fallback.
  return Buffer.from(json, 'utf-8')
               .toString('base64')
               .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeViewStateUrl(s: string): ViewState {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
            + '='.repeat((4 - (s.length % 4)) % 4);
  const json = typeof atob !== 'undefined'
             ? atob(b64)
             : Buffer.from(b64, 'base64').toString('utf-8');
  return JSON.parse(json) as ViewState;
}
