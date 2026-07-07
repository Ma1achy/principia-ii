import type { GpuContext } from '@/gpu/init.js';
import type { GpuDispatcher, RenderPlan } from './types.js';
import type { ViewState } from '@/interact/view_state.js';
import type { TileID } from '@/quadtree/types.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';
import type { SimUniforms, TileRequest } from '@/gpu/structs.js';
import {
  packSimUniforms, packTileRequest, TILE_REQUEST_FLAGS,
  sizeOfSimResult, sizeOfICDescriptor,
} from '@/gpu/structs.js';
import { createTileBuffers, createTileBindGroups, packTileWindow } from '@/gpu/buffers.js';
import { buildLayouts } from '@/gpu/layouts.js';
import { buildPipelines } from '@/gpu/pipelines.js';
import { buildReducePipeline } from '@/gpu/reduce_pipeline.js';
import { dispatchReduce } from '@/gpu/reduce_dispatch.js';
import { readbackReduction } from '@/gpu/reduce_readback.js';
import { packChartUniforms } from '@/gpu/chart_uniforms.js';
import { packLinearisedUniforms } from '@/gpu/linearised_uniforms.js';
import { packEnsembleOffsets } from '@/gpu/ensemble.js';
import { jitterOffsets, ENSEMBLE_E_MAX } from '@/quadtree/ensemble_jitter.js';
import { shouldLineariseAtDepth } from '@/quadtree/decode_mode.js';
import { buildLinearised } from '@/decode/linearised.js';
import { buildRenderGraph, type RenderGraph } from '@/render/pipeline.js';
import { packRenderParams } from '@/render/params.js';
import { DEFAULT_RENDER_PARAMS, type RenderParams } from '@/render/types.js';
import { getChart } from '@/chart_atlas/index.js';
import type { ChartView } from '@/chart_atlas/types.js';
import { tileBounds, tileCentreHalf, tileKey } from '@/quadtree/tile.js';
import { runInspector } from '@/inspector/run.js';
import type { TrajState } from '@/math/types.js';
import {
  R_COLL_DEFAULT, R_ESC_DEFAULT, K_ESC_DEFAULT,
  R_SUB_DEFAULT, GAMMA_SUB_DEFAULT,
  MU_MAX_DEFAULT, ALPHA_MIN_DEFAULT, Q_MAX_DEFAULT, EPS_DEADBAND,
} from '@/math/constants.js';

/** Staging capacity: the richest tier's caps (G9). */
const N_STAGING = 32;
const M_STAGING = 8;          // SimResult carries 8 checkpoint lanes (fixed)
const RETAINED_TILE_CAP = 512;

const TIER_INDEX = { preview: 0, balanced: 1, research: 2 } as const;

interface RetainedTile {
  sim: GPUBuffer;
  ic:  GPUBuffer;
  perTileBg: GPUBindGroup;
}

interface WindowSlot {
  buf: GPUBuffer;
  bg:  GPUBindGroup;
}

export interface RealDispatcher extends GpuDispatcher {
  /** Palette / mode swap: rewrites ONLY the 64-byte RenderParams buffer
   *  (M7's rebind contract) — no recompute, no pipeline rebuild. */
  setRenderParams(p: RenderParams): void;
  dispose(): void;
}

function chartViewOf(view: ViewState): ChartView {
  return {
    chartParams: view.chartParams,
    z0: view.z0, q1: view.q1, q2: view.q2, mag: view.mag,
    alphaMin: ALPHA_MIN_DEFAULT, muMax: MU_MAX_DEFAULT, qMax: Q_MAX_DEFAULT,
    rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND,
  };
}

function simUniformsOf(view: ViewState): SimUniforms {
  return {
    G: 1,
    dt_macro: view.dtMacro,
    N_max: view.NMax,
    r_sub: R_SUB_DEFAULT, gamma_sub: GAMMA_SUB_DEFAULT,
    T_horizon: view.THorizon,
    r_coll: R_COLL_DEFAULT, R_esc: R_ESC_DEFAULT, k_esc: K_ESC_DEFAULT,
    eps_E: 1e-6, eps_L: 1e-6, r_close: 0.01,
    quality_tier: TIER_INDEX[view.qualityTier],
    // SimResult carries 8 checkpoint lanes; a richer tier clamps here
    // until the struct grows (three-place change, out of G8 scope).
    checkpoint_count: Math.min(view.checkpoints, M_STAGING),
    samples_per_axis: Math.min(view.samplesPerAxis, N_STAGING),
  };
}

/**
 * The production GpuDispatcher (G8): M3 simulate + M5/G7 reduce feed
 * per-tile retained buffers; M7's render graph composites the frame
 * loop's RenderPlan as windowed quads (self tiles and stretched
 * ancestor subrects); M9's inspector answers `inspect`.
 *
 * One staging TileBuffers set is reused for every compute job — jobs
 * are serialised on an internal promise chain (the GPU queue is serial
 * anyway, and the reduction readback maps a shared buffer). Results are
 * copied into small per-tile retained buffers that the renderer binds.
 */
export async function makeRealDispatcher(
  ctx: GpuContext,
  getTarget: () => GPUTextureView,
  shaders: { simulate: string; renderLayer0: string; reduce: string; renderGraph: string },
): Promise<RealDispatcher> {
  const { device } = ctx;
  const layouts = buildLayouts(device);
  const staging = createTileBuffers(ctx, N_STAGING, M_STAGING, ENSEMBLE_E_MAX);
  const pl = await buildPipelines(ctx, staging,
    { simulate: shaders.simulate, render: shaders.renderLayer0 });
  const rp = await buildReducePipeline(ctx, staging, shaders.reduce);
  const graph: RenderGraph = await buildRenderGraph(ctx, staging, shaders.renderGraph);
  device.queue.writeBuffer(graph.paramsBuffer, 0,
    packRenderParams(DEFAULT_RENDER_PARAMS));

  const retained = new Map<string, RetainedTile>();
  const windowPool: WindowSlot[] = [];
  let chain: Promise<unknown> = Promise.resolve();

  function retainedKey(view: ViewState, id: TileID): string {
    // Tile payloads are keyed by tile AND chart identity — a chart/slice
    // change must not let stale buffers render. (The CPU TileCache keys
    // the full 19-field TileCacheKey; the renderer only needs enough to
    // avoid cross-view aliasing, and the frame loop only asks for tiles
    // that are 'ready' under the CURRENT key.)
    return `${view.chartType}|${view.z0.join(',')}|${view.q1.join(',')}|${view.q2.join(',')}|${view.mag}|${tileKey(id)}`;
  }

  function evictRetained(): void {
    while (retained.size > RETAINED_TILE_CAP) {
      const oldest = retained.keys().next().value;
      if (oldest === undefined) return;
      const t = retained.get(oldest)!;
      t.sim.destroy(); t.ic.destroy();
      retained.delete(oldest);
    }
  }

  function windowSlot(i: number): WindowSlot {
    while (windowPool.length <= i) {
      const buf = device.createBuffer({
        label: `principia.window.${windowPool.length}`,
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const bg = device.createBindGroup({
        label: `principia.bg.window.${windowPool.length}`,
        layout: layouts.render,
        entries: [
          { binding: 0, resource: { buffer: graph.paramsBuffer } },
          { binding: 1, resource: { buffer: buf } },
        ],
      });
      windowPool.push({ buf, bg });
    }
    return windowPool[i]!;
  }

  async function runTile(tileId: TileID, view: ViewState): Promise<TileReduction> {
    const uniforms = simUniformsOf(view);
    const N = uniforms.samples_per_axis;
    const { centre, half } = tileCentreHalf(tileId);
    const chart = getChart(view.chartType as Parameters<typeof getChart>[0]);
    const cView = chartViewOf(view);

    // G7 ensemble: E jittered copies when the view asks for them.
    const E = Math.max(1, Math.min(view.ensembleCount, ENSEMBLE_E_MAX));
    const patternId = E >= 2 ? 1 : 0;   // stratified

    // G6 decode-mode switchover: past the depth threshold, linearise on
    // the CPU at f64 and let the GPU decode via decode_linear. A kinked
    // tile (buildLinearised → null) falls back to the full decoder.
    let flags = 0;
    let linearised = null;
    if (shouldLineariseAtDepth(tileId.z)) {
      const b = tileBounds(tileId);
      linearised = buildLinearised(([lu, lv]) => {
        const out = chart.decode(
          [b.uMin + lu * (b.uMax - b.uMin), b.vMin + lv * (b.vMax - b.vMin)],
          cView);
        return out.kind === 'ok' ? out.state : null;
      });
      if (linearised) flags |= TILE_REQUEST_FLAGS.DECODE_LINEAR;
    }

    const tile: TileRequest = {
      z: tileId.z, tx: tileId.tx, ty: tileId.ty, level: tileId.z,
      uv_centre: centre, uv_half: half, flags,
      ensemble_e: E, sample_pattern_id: patternId,
    };

    device.queue.writeBuffer(staging.uniforms, 0, packSimUniforms(uniforms));
    device.queue.writeBuffer(staging.tileReq, 0, packTileRequest(tile));
    device.queue.writeBuffer(staging.chart, 0,
      packChartUniforms(chart.chartUniforms(cView)));
    device.queue.writeBuffer(staging.ensemble, 0,
      packEnsembleOffsets(jitterOffsets(patternId, E)));
    if (linearised) {
      device.queue.writeBuffer(staging.linearised, 0,
        packLinearisedUniforms(linearised, half[0], half[1]));
    }

    // Retained per-tile buffers the renderer will bind.
    const simBytes = sizeOfSimResult(M_STAGING) * N * N * E;
    const icBytes = sizeOfICDescriptor() * N * N * E;
    const sim = device.createBuffer({
      label: `principia.retained.sim.${tileKey(tileId)}`,
      size: simBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const ic = device.createBuffer({
      label: `principia.retained.ic.${tileKey(tileId)}`,
      size: icBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const enc = device.createCommandEncoder({ label: 'tile-job' });
    {
      const pass = enc.beginComputePass({ label: 'simulate' });
      pass.setPipeline(pl.simulate);
      pass.setBindGroup(0, pl.bindGroupCommon);
      pass.setBindGroup(1, pl.bindGroupSim);
      pass.dispatchWorkgroups(Math.ceil(N / 8), Math.ceil(N / 8), E);
      pass.end();
    }
    enc.copyBufferToBuffer(staging.simResults, 0, sim, 0, simBytes);
    enc.copyBufferToBuffer(staging.icDesc, 0, ic, 0, icBytes);
    device.queue.submit([enc.finish()]);

    // M5 reduce (+ G7 spreads second pass) then readback.
    device.queue.submit([dispatchReduce(ctx, rp)]);
    const reduction = await readbackReduction(rp, M_STAGING);

    const perTileBg = device.createBindGroup({
      label: `principia.bg.retained.${tileKey(tileId)}`,
      layout: layouts.perTile,
      entries: [
        { binding: 0, resource: { buffer: sim } },
        { binding: 1, resource: { buffer: ic } },
      ],
    });
    const key = retainedKey(view, tileId);
    const old = retained.get(key);
    if (old) { old.sim.destroy(); old.ic.destroy(); }
    retained.delete(key);
    retained.set(key, { sim, ic, perTileBg });
    evictRetained();
    return reduction;
  }

  return {
    dispatchTile(tileId: TileID, view: ViewState): Promise<TileReduction> {
      const job = chain.then(() => runTile(tileId, view));
      chain = job.catch(() => undefined);   // a failed job never wedges the queue
      return job;
    },

    cancel(): void {
      // WebGPU work cannot be aborted; cancellation is logical and lives
      // in the JobLedger (results discarded on completion).
    },

    render(plan: RenderPlan): void {
      const view = plan.view;
      const u0 = view.uvCentre[0] - view.uvHalfWidth[0];
      const v0 = view.uvCentre[1] - view.uvHalfWidth[1];
      const w = 2 * view.uvHalfWidth[0];
      const h = 2 * view.uvHalfWidth[1];

      // The fragment shader reads uniforms.samples_per_axis; keep it in
      // step with the view before drawing.
      device.queue.writeBuffer(staging.uniforms, 0,
        packSimUniforms(simUniformsOf(view)));

      interface DrawItem { slot: WindowSlot; bg: GPUBindGroup }
      const items: DrawItem[] = [];
      for (const entry of plan.entries) {
        const sourceTile = entry.source === 'ancestor' ? entry.ancestor! : entry.tile;
        const rt = retained.get(retainedKey(view, sourceTile));
        if (!rt) continue;                     // not computed yet — skip
        const b = tileBounds(entry.tile);
        const rect: [number, number, number, number] = [
          (b.uMin - u0) / w, (b.vMin - v0) / h,
          (b.uMax - u0) / w, (b.vMax - v0) / h,
        ];
        const uv: [number, number, number, number] =
          entry.source === 'ancestor' && entry.subrect
            ? entry.subrect : [0, 0, 1, 1];
        const slot = windowSlot(items.length);
        device.queue.writeBuffer(slot.buf, 0, packTileWindow(rect, uv));
        items.push({ slot, bg: rt.perTileBg });
      }

      const bgs = createTileBindGroups(ctx, layouts, staging);
      const enc = device.createCommandEncoder({ label: 'frame-render' });
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: getTarget(),
          clearValue: { r: 0.04, g: 0.05, b: 0.07, a: 1 },
          loadOp: 'clear', storeOp: 'store',
        }],
      });
      pass.setPipeline(graph.pipeline);
      pass.setBindGroup(0, bgs.frame);
      pass.setBindGroup(2, bgs.reduction);
      for (const item of items) {
        pass.setBindGroup(1, item.bg);
        pass.setBindGroup(3, item.slot.bg);
        pass.draw(6, 1);
      }
      pass.end();
      device.queue.submit([enc.finish()]);
    },

    inspect(_view: ViewState, ic: TrajState) {
      return Promise.resolve(runInspector(ic));
    },

    setRenderParams(p: RenderParams): void {
      device.queue.writeBuffer(graph.paramsBuffer, 0, packRenderParams(p));
    },

    dispose(): void {
      for (const t of retained.values()) { t.sim.destroy(); t.ic.destroy(); }
      retained.clear();
    },
  };
}
