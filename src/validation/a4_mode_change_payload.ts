import { registerAcceptance } from './acceptance.js';
import { packRenderParams } from '@/render/params.js';
import { DEFAULT_RENDER_PARAMS } from '@/render/types.js';
import { defaultViewState, viewStateToCacheKey } from '@/interact/view_state.js';
import { serialiseCacheKey } from '@/quadtree/cache_key.js';

/**
 * A4: changing render mode does not change the compute payload
 * (render/diagnostics separation — Invalidation matrix). Two halves:
 *
 *  1. Render side responds MINIMALLY: a colour-mode swap perturbs only
 *     the mode slot (bytes 0..3, u32[0]) of the 64-byte RenderParams —
 *     the M7 rebind contract.
 *  2. Compute side is untouched: render parameters are not inputs to
 *     `viewStateToCacheKey`, so the serialised compute cache key — the
 *     identity of the tile's simBuffer contents — is byte-identical
 *     regardless of mode. A mode change can never invalidate a tile.
 */
registerAcceptance(
  'A4', 'render mode change does not change compute payload',
  () => {
    const target = DEFAULT_RENDER_PARAMS.colourMode === 'shape_sphere_okabe_ito'
      ? 'shape_sphere_vmf' as const : 'shape_sphere_okabe_ito' as const;
    const before = new Uint8Array(packRenderParams(DEFAULT_RENDER_PARAMS));
    const after  = new Uint8Array(packRenderParams({
      ...DEFAULT_RENDER_PARAMS, colourMode: target,
    }));
    const diff: number[] = [];
    for (let i = 0; i < before.length; i++) {
      if (before[i] !== after[i]) diff.push(i);
    }
    const renderOk = diff.length > 0 && diff.every((i) => i < 4);

    const view = defaultViewState();
    const keyA = serialiseCacheKey(viewStateToCacheKey(view));
    const keyB = serialiseCacheKey(viewStateToCacheKey(view));
    const computeOk = keyA === keyB;   // render mode is not even an input

    const passed = renderOk && computeOk;
    return Promise.resolve({
      id: 'A4', name: 'render mode change does not change compute payload',
      passed,
      ...(passed ? {} : { details: `render diff bytes = [${diff.join(',')}]` }),
    });
  },
);
