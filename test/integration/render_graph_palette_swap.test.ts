import { describe, it, expect } from 'vitest';
import { packRenderParams } from '@/render/params.js';
import { DEFAULT_RENDER_PARAMS } from '@/render/types.js';

/**
 * Palette swap should change the contents of the 64-byte RenderParams
 * uniform but leave every other resource untouched. We can't dispatch a
 * real GPU pass in Node, but we can pin the contract at the packing
 * layer: a palette swap changes EXACTLY the palette_id lane (bytes
 * 16..19), and packing is deterministic, so two renders that differ only
 * in palette differ only in that one 64-byte uniform — the sim-result
 * storage and tile uniforms are never re-packed at all (the real-GPU
 * side of this contract is exercised by the dev:render harness check).
 */
describe('palette swap touches only RenderParams', () => {
  it('changes exactly the palette_id bytes [16..19]', () => {
    const a = new Uint8Array(packRenderParams(DEFAULT_RENDER_PARAMS));
    const b = new Uint8Array(packRenderParams({
      ...DEFAULT_RENDER_PARAMS, palette: 'cubehelix',
    }));
    expect(b).not.toEqual(a);
    for (let i = 0; i < 64; i++) {
      if (i >= 16 && i < 20) continue;      // palette_id lane
      expect(b[i], `byte ${i}`).toBe(a[i]!);
    }
    // And the lane itself did change.
    const laneA = new Uint32Array(packRenderParams(DEFAULT_RENDER_PARAMS))[4];
    const laneB = new Uint32Array(packRenderParams({
      ...DEFAULT_RENDER_PARAMS, palette: 'cubehelix',
    }))[4];
    expect(laneA).not.toBe(laneB);
  });

  it('packing is deterministic — identical params give identical bytes', () => {
    const a = packRenderParams(DEFAULT_RENDER_PARAMS);
    const b = packRenderParams({ ...DEFAULT_RENDER_PARAMS });
    expect(new Uint8Array(a)).toEqual(new Uint8Array(b));
  });

  it('the packed buffer is exactly 64 bytes with an untouched reserved tail', () => {
    const a = packRenderParams(DEFAULT_RENDER_PARAMS);
    expect(a.byteLength).toBe(64);
    const bytes = new Uint8Array(a);
    for (let i = 56; i < 64; i++) expect(bytes[i]).toBe(0);
  });
});
