import type { ViewState } from '@/interact/view_state.js';
import type { SidecarV1 } from './types.js';

const VERSION = '0.1.0';

export async function sha256(ab: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', ab);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Node fallback.
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(Buffer.from(ab)).digest('hex');
}

export async function makeSidecar(v: ViewState, payload: ArrayBuffer): Promise<SidecarV1> {
  return {
    schema: 'principia.sidecar.v1',
    principiaVersion: VERSION,
    timestamp: new Date().toISOString(),
    view: v,
    sha256: await sha256(payload),
  };
}

export async function verifySidecar(s: SidecarV1, payload: ArrayBuffer): Promise<boolean> {
  return (await sha256(payload)) === s.sha256;
}
