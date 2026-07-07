import {
  detectCapabilities,
  type CapabilityProfile,
  type DeviceLimits,
} from './capability.js';

/**
 * Typed unsupported-device error (G9): the UI branches on `reason` instead of
 * string-matching a bare Error. Thrown only by initGpu — detectCapabilities
 * itself never throws.
 */
export class UnsupportedError extends Error {
  constructor(public reason: NonNullable<CapabilityProfile['reason']>) {
    super(`WebGPU unsupported: ${reason}`);
    this.name = 'UnsupportedError';
  }
}

export interface GpuContext {
  adapter: GPUAdapter;
  device:  GPUDevice;
  format:  GPUTextureFormat;     // canvas preferred format
  capability: CapabilityProfile; // G9 detection profile (supported: true here)
  limits:  DeviceLimits;
}

/**
 * Acquire a device, consuming a pre-detected CapabilityProfile when given
 * (G2's boot detects once and passes it in) or re-detecting otherwise.
 * Re-detection per call is deliberate for the G7 recovery path: a fallback
 * adapter after a TDR may report different limits, so the profile must not
 * be cached across a device loss.
 */
export async function initGpu(
  canvas?: HTMLCanvasElement,
  profile?: CapabilityProfile,
): Promise<GpuContext> {
  const cap = profile ?? (await detectCapabilities());
  if (!cap.supported || !cap.limits) throw new UnsupportedError(cap.reason ?? 'no-webgpu');

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) throw new UnsupportedError('no-adapter');

  // Request only what the adapter actually reports; never exceed it.
  // requestDevice REJECTS on failure (it never resolves null) — classify
  // that rejection as the typed 'no-device' reason.
  // timestamp-query (G10 perf timing) is opt-in per device: a query set
  // cannot be created later unless the feature was requested HERE. Gate on
  // the live adapter (a post-TDR fallback may not advertise it), never require.
  const requiredFeatures: GPUFeatureName[] =
    adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
  const device = await adapter.requestDevice({
    requiredFeatures,
    requiredLimits: {
      maxStorageBufferBindingSize:
        adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize:
        adapter.limits.maxBufferSize,
    },
  }).catch(() => null);
  if (!device) throw new UnsupportedError('no-device');

  const format =
    canvas?.getContext('webgpu')
      ? navigator.gpu.getPreferredCanvasFormat()
      : 'rgba8unorm';

  return { adapter, device, format, capability: cap, limits: cap.limits };
}
