import { describe, it, expect } from 'vitest';
import { makeGpuTimer } from '@/perf/gpu_timing.js';

/**
 * Real-device probe: only runs where WebGPU exists. Mirrors G9's
 * capability_probe — skips cleanly on headless CI. On a device without
 * timestamp-query it pins the graceful null; with it, it resolves a
 * non-negative per-pass timing end-to-end.
 */
const hasGpu = typeof navigator !== 'undefined'
  && (navigator as { gpu?: unknown }).gpu !== undefined;

describe.skipIf(!hasGpu)('GpuTimer (real adapter)', () => {
  it('builds only when the feature is present and resolves a timing', async () => {
    const gpu = (navigator as unknown as { gpu: GPU }).gpu;
    const adapter = await gpu.requestAdapter();
    if (!adapter) return;                           // no adapter: covered by G9
    const features = [...adapter.features].map(String);
    const hasTs = features.includes('timestamp-query');
    const device = await adapter.requestDevice(
      hasTs ? { requiredFeatures: ['timestamp-query'] } : {});

    const timer = makeGpuTimer(device, { features });
    if (!hasTs) {
      expect(timer).toBeNull();                     // graceful degradation
      return;
    }
    expect(timer).not.toBeNull();

    const enc = device.createCommandEncoder();
    const tw = timer!.timestampWrites('simulate');
    expect(tw).toBeDefined();
    const pass = enc.beginComputePass({ timestampWrites: tw! });
    pass.end();
    expect(timer!.resolve(enc)).toBe(true);
    device.queue.submit([enc.finish()]);

    const t = await timer!.read();
    expect(typeof t.simulate).toBe('number');
    expect(t.simulate).toBeGreaterThanOrEqual(0);
    expect(t.reduce).toBeUndefined();               // never written → not reported
    timer!.destroy();
    device.destroy();
  });
});
