import { describe, it, expect } from 'vitest';
import {
  detectCapabilities, deriveCaps, degradeRequest, maxFullRetentionViewport,
  BYTES_PER_SAMPLE_M8, WEBGPU_BASELINE_BINDING, type DeviceLimits,
} from '@/gpu/capability.js';
import { initGpu, UnsupportedError } from '@/gpu/init.js';

const mib = (n: number): number => n * 1024 * 1024;
const limits = (over: Partial<DeviceLimits> = {}): DeviceLimits => ({
  maxStorageBufferBindingSize: WEBGPU_BASELINE_BINDING,
  maxBufferSize: mib(256),
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupSizeX: 256,
  maxComputeWorkgroupSizeY: 256,
  ...over,
});

describe('detectCapabilities: graceful classification', () => {
  it('no navigator.gpu → unsupported(no-webgpu), no throw', async () => {
    const p = await detectCapabilities(undefined);
    expect(p.supported).toBe(false);
    expect(p.reason).toBe('no-webgpu');
    expect(p.warnings).toEqual([]);
  });

  it('adapter request returns null → unsupported(no-adapter)', async () => {
    const p = await detectCapabilities({ requestAdapter: async () => null });
    expect(p.supported).toBe(false);
    expect(p.reason).toBe('no-adapter');
  });

  it('valid adapter → supported with caps + sorted features', async () => {
    const fakeGpu = {
      requestAdapter: async () => ({
        features: new Set(['timestamp-query', 'shader-f16']),
        limits: limits({ maxStorageBufferBindingSize: mib(256) }) as
          unknown as Record<string, number>,
      }),
    };
    const p = await detectCapabilities(fakeGpu);
    expect(p.supported).toBe(true);
    expect(p.features).toEqual(['shader-f16', 'timestamp-query']);
    expect(p.caps?.tier).toBe('research');
  });

  it('baseline device carries the full-retention warning', async () => {
    const p = await detectCapabilities({
      requestAdapter: async () => ({
        limits: limits() as unknown as Record<string, number>,
      }),
    });
    expect(p.supported).toBe(true);
    expect(p.warnings.some((w) => /128 MiB baseline/.test(w))).toBe(true);
  });
});

describe('deriveCaps: tier gating', () => {
  it('weak device → preview, no FTLE, no ensemble', () => {
    const c = deriveCaps(limits({
      maxStorageBufferBindingSize: mib(64),
      maxComputeInvocationsPerWorkgroup: 64,
      maxComputeWorkgroupSizeX: 64,
    }), []);
    expect(c.tier).toBe('preview');
    expect(c.ftle).toBe(false);
    expect(c.ensembleMax).toBe(0);
    expect(c.checkpoints).toBe(8);
  });

  it('baseline binding (128 MiB) → balanced, not research', () => {
    const c = deriveCaps(limits({ maxStorageBufferBindingSize: WEBGPU_BASELINE_BINDING }), []);
    expect(c.tier).toBe('balanced');
    expect(c.ftle).toBe(false);
  });

  it('256 MiB binding + buffer → research, FTLE on, M=16', () => {
    const c = deriveCaps(limits({ maxStorageBufferBindingSize: mib(256), maxBufferSize: mib(256) }), []);
    expect(c.tier).toBe('research');
    expect(c.ftle).toBe(true);
    expect(c.checkpoints).toBe(16);
    expect(c.ensembleMax).toBe(16);
  });

  it('checkpoints stay within M ∈ [8,16] (ADR 0001) for every tier', () => {
    for (const big of [mib(64), WEBGPU_BASELINE_BINDING, mib(512)]) {
      const c = deriveCaps(limits({ maxStorageBufferBindingSize: big, maxBufferSize: big }), []);
      expect(c.checkpoints).toBeGreaterThanOrEqual(8);
      expect(c.checkpoints).toBeLessThanOrEqual(16);
    }
  });
});

describe('maxFullRetentionViewport: §6.2.4 math', () => {
  it('128 MiB at 208 B/sample → 803px side', () => {
    const side = maxFullRetentionViewport(WEBGPU_BASELINE_BINDING, BYTES_PER_SAMPLE_M8);
    // floor(sqrt(floor(134217728/208))) = floor(sqrt(645277)) = 803
    expect(side).toBe(803);
    expect(side * side * BYTES_PER_SAMPLE_M8).toBeLessThanOrEqual(WEBGPU_BASELINE_BINDING);
  });

  it('larger binding → larger viewport (monotone)', () => {
    expect(maxFullRetentionViewport(mib(256))).toBeGreaterThan(
      maxFullRetentionViewport(mib(128)));
  });

  it('a binding smaller than one sample → 0 (never negative/NaN)', () => {
    expect(maxFullRetentionViewport(0)).toBe(0);
    expect(maxFullRetentionViewport(BYTES_PER_SAMPLE_M8 - 1)).toBe(0);
  });
});

describe('degradeRequest: clamping + warnings', () => {
  it('downgrades tier above device ceiling', () => {
    const caps = deriveCaps(limits({ maxStorageBufferBindingSize: mib(64),
      maxComputeInvocationsPerWorkgroup: 64, maxComputeWorkgroupSizeX: 64 }), []);
    const r = degradeRequest(caps, { tier: 'research', viewportSide: 256 });
    expect(r.tier).toBe('preview');
    expect(r.warnings.some((w) => /tier downgraded/.test(w))).toBe(true);
  });

  it('clamps an oversized full-retention viewport', () => {
    const caps = deriveCaps(limits(), []);
    const r = degradeRequest(caps, { tier: 'preview', viewportSide: 4096 });
    expect(r.viewportSide).toBe(caps.maxFullRetentionViewport);
    expect(r.warnings.some((w) => /clamped/.test(w))).toBe(true);
  });

  it('passes a within-limits request unchanged (no warnings)', () => {
    const caps = deriveCaps(limits({ maxStorageBufferBindingSize: mib(512), maxBufferSize: mib(512) }), []);
    const r = degradeRequest(caps, { tier: 'balanced', viewportSide: 512 });
    expect(r.tier).toBe('balanced');
    expect(r.viewportSide).toBe(512);
    expect(r.warnings).toHaveLength(0);
  });
});

describe('initGpu: typed refusal', () => {
  it('throws UnsupportedError (not a bare Error) without WebGPU', async () => {
    // Node has a global navigator without `gpu`, so detection classifies
    // this environment as no-webgpu and initGpu must refuse typed-ly.
    const err = await initGpu().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(UnsupportedError);
    expect((err as UnsupportedError).name).toBe('UnsupportedError');
    expect((err as UnsupportedError).reason).toBe('no-webgpu');
  });

  it('a pre-detected unsupported profile short-circuits with its reason', async () => {
    const err = await initGpu(undefined, {
      supported: false, reason: 'no-adapter', features: [], warnings: [],
    }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(UnsupportedError);
    expect((err as UnsupportedError).reason).toBe('no-adapter');
  });
});
