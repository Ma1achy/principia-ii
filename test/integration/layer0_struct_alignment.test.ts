import { describe, it, expect } from 'vitest';
import { initGpu } from '@/gpu/init.js';
import { createTileBuffers } from '@/gpu/buffers.js';

function hasWebGPU(): boolean {
  const nav = (globalThis as { navigator?: unknown }).navigator;
  return !!nav && typeof nav === 'object' && 'gpu' in nav;
}

describe('GPU struct alignment', () => {
  it('writes 96 bytes of SimUniforms without an alignment error', async () => {
    if (!hasWebGPU()) {
      console.warn('skipping: WebGPU unavailable in this test runner');
      return;
    }
    const ctx = await initGpu();
    const bufs = createTileBuffers(ctx, 16, 8);
    expect(bufs.uniforms.size).toBe(96);
    expect(bufs.tileReq.size).toBe(48);
    expect(bufs.simResults.size).toBe(208 * 16 * 16);
    expect(bufs.icDesc.size).toBe(64 * 16 * 16);
  });
});
