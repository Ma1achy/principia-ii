export interface GpuContext {
  adapter: GPUAdapter;
  device:  GPUDevice;
  format:  GPUTextureFormat;     // canvas preferred format
  limits:  Record<string, number>;
}

export async function initGpu(
  canvas?: HTMLCanvasElement,
): Promise<GpuContext> {
  if (!('gpu' in navigator)) {
    throw new Error('WebGPU not available in this browser');
  }
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) throw new Error('No GPU adapter');

  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize:
        adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize:
        adapter.limits.maxBufferSize,
    },
  });

  const format =
    canvas?.getContext('webgpu')
      ? navigator.gpu.getPreferredCanvasFormat()
      : 'rgba8unorm';

  return {
    adapter, device, format,
    limits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize:               adapter.limits.maxBufferSize,
      maxComputeWorkgroupSizeX:    adapter.limits.maxComputeWorkgroupSizeX,
      maxComputeWorkgroupSizeY:    adapter.limits.maxComputeWorkgroupSizeY,
    },
  };
}
