import { describe, it, expect } from 'vitest';
import { detectCapabilities } from '@/gpu/capability.js';

// Real-adapter probe. Skipped on headless CI without WebGPU (mirrors M3).
function hasWebGPU(): boolean {
  const nav = (globalThis as { navigator?: unknown }).navigator;
  return !!nav && typeof nav === 'object' && 'gpu' in nav;
}

describe.skipIf(!hasWebGPU())('capability probe (real adapter)', () => {
  it('reports a supported profile with a tier and sane caps', async () => {
    const p = await detectCapabilities();
    expect(p.supported).toBe(true);
    expect(['preview', 'balanced', 'research']).toContain(p.caps!.tier);
    expect(p.caps!.maxFullRetentionViewport).toBeGreaterThan(0);
    expect(p.limits!.maxStorageBufferBindingSize)
      .toBeGreaterThanOrEqual(128 * 1024 * 1024);
  });
});
