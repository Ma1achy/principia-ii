import { describe, it, expect } from 'vitest';
import { makeSidecar, verifySidecar, sha256 } from '@/export/sidecar.js';
import { defaultViewState } from '@/interact/view_state.js';

describe('sidecar reproducibility', () => {
  it('verifies for a matching payload', async () => {
    const view = defaultViewState();
    const payload = new TextEncoder().encode('canonical bytes').buffer as ArrayBuffer;
    const sc = await makeSidecar(view, payload);
    expect(await verifySidecar(sc, payload)).toBe(true);
  });

  it('fails for a mutated payload', async () => {
    const view = defaultViewState();
    const payload = new TextEncoder().encode('canonical bytes').buffer as ArrayBuffer;
    const sc = await makeSidecar(view, payload);
    const mutated = new TextEncoder().encode('canonical bytes!').buffer as ArrayBuffer;
    expect(await verifySidecar(sc, mutated)).toBe(false);
  });

  it('hashes are stable across calls', async () => {
    const ab = new TextEncoder().encode('hello').buffer as ArrayBuffer;
    const a = await sha256(ab);
    const b = await sha256(ab);
    expect(a).toBe(b);
  });
});
