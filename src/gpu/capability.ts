/**
 * WebGPU capability detection and graceful degradation (G9).
 *
 * detectCapabilities() never throws on a missing/incapable device — it returns
 * a CapabilityProfile with `supported: false` and a machine-readable `reason`
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
  ensembleMax: number;          // E upper bound (spec §4.3.4, G7 ENSEMBLE_E_MAX)
  maxDepth: number;             // quadtree depth ceiling (G6 extends further)
  ftle: boolean;                // Research-tier only (ADR 0003)
  maxFullRetentionViewport: number; // px side that fits the binding limit at M=8
}

export interface CapabilityProfile {
  supported: boolean;
  reason?: UnsupportedReason;
  limits?: DeviceLimits;
  features: string[];           // adapter.features as a sorted array
  caps?: TierCaps;
  warnings: string[];           // non-fatal degradations applied
}

/** Structural slice of navigator.gpu that detection needs (injectable). */
export interface GpuLike {
  requestAdapter(options?: {
    powerPreference?: 'low-power' | 'high-performance';
  }): Promise<{
    features?: Iterable<unknown>;
    limits: Record<string, number>;
  } | null>;
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
 * Pick the richest tier the limits support, then its caps. Pure.
 * Tier gates are deliberately conservative — a device that misses a gate drops
 * a tier rather than risking an over-allocation or a validation error.
 * `features` never gates a tier: shader-f16/timestamp-query are opt-in
 * upgrades (spec §6.4.2) — detected and reported, never required.
 */
export function deriveCaps(limits: DeviceLimits, features: string[]): TierCaps {
  void features;
  const mib = (n: number): number => n * 1024 * 1024;
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
 * { supported: false, reason } so the caller can render a message instead of
 * crashing. Accepts an injected `gpu` for testing (defaults to navigator.gpu).
 */
export async function detectCapabilities(
  gpu: GpuLike | undefined = (globalThis as { navigator?: { gpu?: GpuLike } })
    .navigator?.gpu,
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
