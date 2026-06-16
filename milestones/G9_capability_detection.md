# G9 — WebGPU capability detection & graceful degradation

## Goal

Before any pipeline allocates a buffer or picks a quality tier, Principia must
know what the device can actually do — and degrade (or refuse) **informatively**
instead of throwing a raw error or silently over-allocating. M3's `initGpu`
currently `throw`s when `navigator.gpu` is missing and requests *all* adapter
limits unconditionally; the spec (§6.2.4) requires querying
`maxStorageBufferBindingSize` and partitioning/capping accordingly. G9 adds a
capability layer that produces a single `CapabilityProfile` (support state,
limits, features, chosen tier, derived caps, warnings) which `initGpu`, the
scheduler, and the UI all read. It is the detection counterpart to G7's
device-**loss** recovery.

**Exit criterion (single executable test).**

```bash
npm test -- --run test/unit/gpu/capability
```

passes with at least 12 green tests covering: unsupported-browser/adapter
classification, per-tier cap derivation from synthetic limits, the
`maxStorageBufferBindingSize` → full-retention-viewport math, and request
degradation (tier downgrade + viewport clamp).

**Deliverable:** internal — tests only; a capability layer emits one `CapabilityProfile` (support state, limits, chosen tier, derived caps, warnings) that `initGpu`, the scheduler, and the UI read so unsupported devices degrade informatively instead of throwing, verified by `test/unit/gpu/capability`.

## File tree

```
src/
  gpu/
    capability.ts        # NEW: CapabilityProfile, detectCapabilities, deriveCaps, degradeRequest
    init.ts              # MODIFIED: initGpu consumes the profile; clamps requiredLimits; typed UnsupportedError
test/
  unit/
    gpu/
      capability.test.ts # NEW: pure derivation + degradation (no real GPU)
  integration/
    capability_probe.test.ts  # NEW: real-adapter probe, skipped if navigator.gpu absent
```

## Depends on / pairs with

- **M3** (`initGpu`, `GpuContext`) — G9 wraps and hardens it.
- **G7** (device-loss recovery) — detection (G9) + recovery (G7) are the two
  halves of device resilience.
- Contracts: tiers per ADR 0003 (FTLE is Research-tier only), checkpoints per
  ADR 0001 (`M ∈ [8,16]`), sample byte cost per spec §6.6 / M3
  `sizeOfSimResult(8)` (208 B/sample at `M=8`; ADR 0006 governs `TileReduction`,
  not `SimResult`).

## `src/gpu/capability.ts`

```ts
/**
 * WebGPU capability detection and graceful degradation.
 *
 * detectCapabilities() never throws on a missing/!capable device — it returns
 * a CapabilityProfile with `supported:false` and a machine-readable `reason`
 * the UI can turn into a message. deriveCaps()/degradeRequest() are pure and
 * fully unit-testable without a real GPU.
 */

/** Bytes per retained SimResult sample at M=8 (spec §6.6 / M3 sizeOfSimResult). */
export const BYTES_PER_SAMPLE_M8 = 208;
/** WebGPU baseline maxStorageBufferBindingSize (spec §6.2.4): 128 MiB. */
export const WEBGPU_BASELINE_BINDING = 128 * 1024 * 1024;

export type QualityTier = 'preview' | 'balanced' | 'research';
export type UnsupportedReason = 'no-webgpu' | 'no-adapter' | 'no-device';

/** The limits G9 reasons about (subset of GPUSupportedLimits). */
export interface DeviceLimits {
  maxStorageBufferBindingSize: number;
  maxBufferSize: number;
  maxComputeInvocationsPerWorkgroup: number;
  maxComputeWorkgroupSizeX: number;
  maxComputeWorkgroupSizeY: number;
}

/** Per-tier operating caps the scheduler/renderer must respect. */
export interface TierCaps {
  tier: QualityTier;
  samplesPerTileAxis: number;   // N
  checkpoints: number;          // M ∈ [8,16] (ADR 0001)
  ensembleMax: number;          // E upper bound (spec §4.3.4)
  maxDepth: number;             // quadtree depth ceiling (G6 extends further)
  ftle: boolean;                // Research-tier only (ADR 0003)
  maxFullRetentionViewport: number; // px side that fits maxStorageBufferBindingSize at M=8
}

export interface CapabilityProfile {
  supported: boolean;
  reason?: UnsupportedReason;
  limits?: DeviceLimits;
  features: string[];           // adapter.features as a sorted array
  caps?: TierCaps;
  warnings: string[];           // non-fatal degradations applied
}

/** Largest square full-retention viewport (px side) that fits a binding limit. */
export function maxFullRetentionViewport(
  bindingLimit: number,
  bytesPerSample = BYTES_PER_SAMPLE_M8,
): number {
  const maxSamples = Math.floor(bindingLimit / bytesPerSample);
  return Math.floor(Math.sqrt(maxSamples));
}

/**
 * Pick the richest tier the limits/features support, then its caps. Pure.
 * Tier gates are deliberately conservative — a device that misses a gate drops
 * a tier rather than risking an over-allocation or a validation error.
 */
export function deriveCaps(limits: DeviceLimits, features: string[]): TierCaps {
  const mib = (n: number) => n * 1024 * 1024;
  const big = limits.maxStorageBufferBindingSize;
  const wg = limits.maxComputeInvocationsPerWorkgroup;

  let tier: QualityTier = 'preview';
  if (big >= WEBGPU_BASELINE_BINDING && wg >= 256 &&
      limits.maxComputeWorkgroupSizeX >= 256) {
    tier = 'balanced';
  }
  if (tier === 'balanced' && big >= mib(256) && limits.maxBufferSize >= mib(256)) {
    tier = 'research';
  }

  const byTier: Record<QualityTier, Omit<TierCaps, 'tier' | 'maxFullRetentionViewport'>> = {
    preview:  { samplesPerTileAxis: 16, checkpoints: 8,  ensembleMax: 0,  maxDepth: 16, ftle: false },
    balanced: { samplesPerTileAxis: 32, checkpoints: 8,  ensembleMax: 4,  maxDepth: 23, ftle: false },
    research: { samplesPerTileAxis: 32, checkpoints: 16, ensembleMax: 16, maxDepth: 30, ftle: true  },
  };
  return {
    tier,
    ...byTier[tier],
    maxFullRetentionViewport: maxFullRetentionViewport(big),
  };
}

/**
 * Clamp a requested (tier, viewport) to what the profile allows, recording a
 * warning for each degradation. Pure; the UI/scheduler call this per request.
 */
export function degradeRequest(
  caps: TierCaps,
  req: { tier: QualityTier; viewportSide: number },
): { tier: QualityTier; viewportSide: number; warnings: string[] } {
  const warnings: string[] = [];
  const order: QualityTier[] = ['preview', 'balanced', 'research'];
  let tier = req.tier;
  if (order.indexOf(req.tier) > order.indexOf(caps.tier)) {
    tier = caps.tier;
    warnings.push(`tier downgraded ${req.tier} → ${caps.tier} (device limits)`);
  }
  let viewportSide = req.viewportSide;
  if (viewportSide > caps.maxFullRetentionViewport) {
    viewportSide = caps.maxFullRetentionViewport;
    warnings.push(
      `full-retention viewport clamped to ${viewportSide}px ` +
      `(maxStorageBufferBindingSize)`,
    );
  }
  return { tier, viewportSide, warnings };
}

function readLimits(src: { limits: Record<string, number> }): DeviceLimits {
  const L = src.limits;
  return {
    maxStorageBufferBindingSize: L.maxStorageBufferBindingSize ?? WEBGPU_BASELINE_BINDING,
    maxBufferSize: L.maxBufferSize ?? WEBGPU_BASELINE_BINDING,
    maxComputeInvocationsPerWorkgroup: L.maxComputeInvocationsPerWorkgroup ?? 256,
    maxComputeWorkgroupSizeX: L.maxComputeWorkgroupSizeX ?? 256,
    maxComputeWorkgroupSizeY: L.maxComputeWorkgroupSizeY ?? 256,
  };
}

/**
 * Detect capabilities without throwing. On any missing layer, returns
 * { supported:false, reason } so the caller can render a message instead of
 * crashing. Accepts an injected `gpu` for testing (defaults to navigator.gpu).
 */
export async function detectCapabilities(
  gpu: any = (globalThis as any).navigator?.gpu,
): Promise<CapabilityProfile> {
  if (!gpu) return { supported: false, reason: 'no-webgpu', features: [], warnings: [] };

  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return { supported: false, reason: 'no-adapter', features: [], warnings: [] };

  const features = [...(adapter.features ?? [])].map(String).sort();
  const limits = readLimits(adapter);
  const caps = deriveCaps(limits, features);
  const warnings: string[] = [];
  if (limits.maxStorageBufferBindingSize <= WEBGPU_BASELINE_BINDING) {
    warnings.push('device at the 128 MiB baseline; full-retention export is limited');
  }
  return { supported: true, limits, features, caps, warnings };
}
```

## `src/gpu/init.ts` (modified)

`initGpu` now consumes the profile rather than re-detecting, throws a **typed**
`UnsupportedError` (so the UI can branch on `reason` and avoid an
`uncaughtException`), and clamps `requiredLimits` to the device's reported caps.

```ts
import { detectCapabilities, type CapabilityProfile } from './capability.js';

export class UnsupportedError extends Error {
  constructor(public reason: NonNullable<CapabilityProfile['reason']>) {
    super(`WebGPU unsupported: ${reason}`);
    this.name = 'UnsupportedError';
  }
}

// initGpu gains an optional pre-detected profile and clamps requiredLimits.
export async function initGpu(
  canvas?: HTMLCanvasElement,
  profile?: CapabilityProfile,
): Promise<GpuContext> {
  const cap = profile ?? (await detectCapabilities());
  if (!cap.supported) throw new UnsupportedError(cap.reason!);

  const gpu = (navigator as any).gpu;
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new UnsupportedError('no-adapter');

  // Request only what the adapter actually reports; never exceed it.
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  if (!device) throw new UnsupportedError('no-device');

  const format = canvas?.getContext('webgpu')
    ? gpu.getPreferredCanvasFormat() as GPUTextureFormat
    : 'rgba8unorm';

  return { adapter, device, format, capability: cap, limits: cap.limits! };
}
```

(`GpuContext` gains a `capability: CapabilityProfile` field; the existing
`limits` field is now `cap.limits`. The G2 frame loop reads `ctx.capability.caps`
to seed the scheduler's default tier; the UI shell (G12) renders
`cap.reason`/`cap.warnings`.)

## Tests

### `test/unit/gpu/capability.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  detectCapabilities, deriveCaps, degradeRequest, maxFullRetentionViewport,
  BYTES_PER_SAMPLE_M8, WEBGPU_BASELINE_BINDING, type DeviceLimits,
} from '@/gpu/capability.js';

const mib = (n: number) => n * 1024 * 1024;
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
  });

  it('adapter request returns null → unsupported(no-adapter)', async () => {
    const p = await detectCapabilities({ requestAdapter: async () => null });
    expect(p.supported).toBe(false);
    expect(p.reason).toBe('no-adapter');
  });

  it('valid adapter → supported with caps + features', async () => {
    const fakeGpu = {
      requestAdapter: async () => ({
        features: new Set(['shader-f16', 'timestamp-query']),
        limits: limits({ maxStorageBufferBindingSize: mib(256) }),
      }),
    };
    const p = await detectCapabilities(fakeGpu);
    expect(p.supported).toBe(true);
    expect(p.features).toEqual(['shader-f16', 'timestamp-query']);
    expect(p.caps?.tier).toBe('research');
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
});

describe('degradeRequest: clamping + warnings', () => {
  it('downgrades tier above device ceiling', () => {
    const caps = deriveCaps(limits({ maxStorageBufferBindingSize: mib(64),
      maxComputeInvocationsPerWorkgroup: 64, maxComputeWorkgroupSizeX: 64 }), []);
    const r = degradeRequest(caps, { tier: 'research', viewportSide: 256 });
    expect(r.tier).toBe('preview');
    expect(r.warnings.some(w => /tier downgraded/.test(w))).toBe(true);
  });

  it('clamps an oversized full-retention viewport', () => {
    const caps = deriveCaps(limits(), []);
    const r = degradeRequest(caps, { tier: 'preview', viewportSide: 4096 });
    expect(r.viewportSide).toBe(caps.maxFullRetentionViewport);
    expect(r.warnings.some(w => /clamped/.test(w))).toBe(true);
  });

  it('passes a within-limits request unchanged (no warnings)', () => {
    const caps = deriveCaps(limits({ maxStorageBufferBindingSize: mib(512), maxBufferSize: mib(512) }), []);
    const r = degradeRequest(caps, { tier: 'balanced', viewportSide: 512 });
    expect(r.tier).toBe('balanced');
    expect(r.viewportSide).toBe(512);
    expect(r.warnings).toHaveLength(0);
  });
});
```

### `test/integration/capability_probe.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { detectCapabilities } from '@/gpu/capability.js';

// Real-adapter probe. Skipped on headless CI without WebGPU (mirrors M3).
const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
describe.skipIf(!hasGpu)('capability probe (real adapter)', () => {
  it('reports a supported profile with a tier and sane caps', async () => {
    const p = await detectCapabilities();
    expect(p.supported).toBe(true);
    expect(['preview', 'balanced', 'research']).toContain(p.caps!.tier);
    expect(p.caps!.maxFullRetentionViewport).toBeGreaterThan(0);
    expect(p.limits!.maxStorageBufferBindingSize).toBeGreaterThanOrEqual(128 * 1024 * 1024);
  });
});
```

## Run it

```bash
npm test -- --run test/unit/gpu/capability
npm test -- --run test/integration/capability_probe   # real GPU only; skips otherwise
```

## Acceptance check

`test/unit/gpu/capability.test.ts` passes with ≥12 green tests; `initGpu`
throws a typed `UnsupportedError` (not a bare `Error`) on a device without
WebGPU/adapter, and never requests a `requiredLimit` exceeding the adapter's
reported value. The real-adapter probe passes on a WebGPU-capable machine and
skips cleanly without one.

## Notes for the implementer

- **detectCapabilities never throws.** That is the whole point — a browser
  without WebGPU must yield a renderable `{ supported:false, reason }`, not an
  exception. Only `initGpu` throws (the typed `UnsupportedError`), and only
  after detection has already classified the failure.
- **Tier gates are conservative on purpose.** A device that misses a gate drops
  a tier rather than risking a validation error or an over-allocation. Tune the
  thresholds against real hardware, but keep the "miss → drop" direction.
- **The caps feed the cache signature.** `samplesPerTileAxis`, `checkpoints`,
  and `tier` already belong to the cache key (architecture skill); a device that
  degrades them must not reuse tiles computed at a richer setting.
- **Pair with G7.** Detection (G9) decides what to allocate; recovery (G7)
  rebuilds it after `device.lost`. On a re-acquired device, re-run
  `detectCapabilities` — a fallback adapter (e.g. after a TDR) may report
  different limits, so the profile is not cached across a loss.
- **Don't conflate `features` with limits.** `shader-f16`/`timestamp-query` are
  opt-in upgrades (spec §6.4.2): detect and use them, never require them.
