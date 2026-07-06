/**
 * M5 dev harness: adaptive refinement made legible. For every visible tile at
 * a fixed depth it runs the REAL pipeline — M3 simulate → M5 reduce →
 * readback through the table-generated decodeTileReduction (schema check
 * included) — then the same compositeCoherence / decideSplit / computePriority
 * the scheduler uses, and paints one cell per tile: fill = C_tile, border =
 * split/keep/merge, text = impurity / dominant outcome / priority.
 *
 * Served by Vite: `npm run dev:layer2`.
 */
import { initGpu, type GpuContext } from '@/gpu/init.js';
import { createTileBuffers, type TileBuffers } from '@/gpu/buffers.js';
import { buildPipelines, type Pipelines } from '@/gpu/pipelines.js';
import { buildReducePipeline } from '@/gpu/reduce_pipeline.js';
import { dispatchReduce } from '@/gpu/reduce_dispatch.js';
import { readbackReduction } from '@/gpu/reduce_readback.js';
import { packSimUniforms, packTileRequest, type SimUniforms } from '@/gpu/structs.js';
import { visibleTiles } from '@/quadtree/visible.js';
import { tileCentreHalf } from '@/quadtree/tile.js';
import { compositeCoherence } from '@/quadtree/coherence.js';
import { decideSplit, DEFAULT_THRESHOLDS } from '@/quadtree/split.js';
import { computePriority } from '@/quadtree/priority.js';
import { OUTCOME_NAMES } from '@/debug/descriptor_bits.js';
import type { QuadtreeView, TileCacheKey, TileID } from '@/quadtree/types.js';

import {
  SIMULATE_MODULE, RENDER_LAYER0_MODULE, REDUCE_MODULE,
} from './shader_modules.js';

const N = 16;      // samples per tile axis
const M = 8;
const Z_BASE = 2;  // 4×4 visible tiles
const CELL = 128;  // px per tile cell on the 512² canvas

const logPane = document.getElementById('log') as HTMLPreElement;
function log(s: string): void {
  logPane.textContent += `${s}\n`;
  logPane.scrollTop = logPane.scrollHeight;
}

const KEY = {} as TileCacheKey;   // priority/coherence never read the key
const VIEW: QuadtreeView = {
  cacheKey: KEY, uvCentre: [0.5, 0.5], uvHalfWidth: [0.5, 0.5],
  zBase: Z_BASE, zMax: 12, width: 512, height: 512, tilePix: CELL,
};

const UNIFORMS: SimUniforms = {
  m: [1 / 3, 1 / 3, 1 / 3], M_total: 1, G: 1,
  dt_macro: 1e-3, N_max: 64, r_sub: 0.05, gamma_sub: 1.5,
  T_horizon: 20,             // short horizon: harness speed over physics depth
  r_coll: 1e-4, R_esc: 10, k_esc: 8, eps_E: 1e-6, eps_L: 1e-6, r_close: 0.01,
  quality_tier: 1, checkpoint_count: M, samples_per_axis: N,
  mu_max: 5, alpha_min: 0.05, q_max: 2,
};

function dispatchSimulate(
  ctx: GpuContext, bufs: TileBuffers, pl: Pipelines, id: TileID,
): void {
  const { centre, half } = tileCentreHalf(id);
  ctx.device.queue.writeBuffer(bufs.uniforms, 0, packSimUniforms(UNIFORMS));
  ctx.device.queue.writeBuffer(bufs.tileReq, 0, packTileRequest({
    z: id.z, tx: id.tx, ty: id.ty, level: id.z,
    uv_centre: centre, uv_half: half, flags: 0,
  }));
  const enc = ctx.device.createCommandEncoder({ label: 'simulate-tile' });
  const pass = enc.beginComputePass();
  pass.setPipeline(pl.simulate);
  pass.setBindGroup(0, pl.bindGroupCommon);
  pass.setBindGroup(1, pl.bindGroupSim);
  pass.dispatchWorkgroups(Math.ceil(N / 8), Math.ceil(N / 8), 1);
  pass.end();
  ctx.device.queue.submit([enc.finish()]);
}

function heat(c: number): string {
  // c = C_tile in [0,1]: 1 → green, 0 → red.
  const r = Math.round(255 * (1 - c));
  const g = Math.round(200 * c);
  return `rgb(${r},${g},40)`;
}

async function main(): Promise<void> {
  if (!('gpu' in navigator)) {
    log('WebGPU unavailable in this browser.');
    return;
  }
  const ctx = await initGpu();
  const bufs = createTileBuffers(ctx, N, M);
  const pl = await buildPipelines(ctx, bufs, {
    simulate: SIMULATE_MODULE,
    render: RENDER_LAYER0_MODULE,
  });
  const rp = await buildReducePipeline(ctx, bufs, REDUCE_MODULE);

  const g = (document.getElementById('map') as HTMLCanvasElement).getContext('2d')!;
  g.font = '11px monospace';

  const tiles = visibleTiles(VIEW);
  let splits = 0, keeps = 0;
  for (const id of tiles) {
    dispatchSimulate(ctx, bufs, pl, id);
    ctx.device.queue.submit([dispatchReduce(ctx, rp)]);
    const r = await readbackReduction(rp, M);   // ADR-0006 schema check inside

    const { sTile, cTile } = compositeCoherence(r,
      { ftleEnabled: false, ensembleEnabled: false });
    r.coherence_score = sTile;
    const dec = decideSplit(r, {
      level: id.z, maxDepth: VIEW.zMax, visible: true,
      thresholds: DEFAULT_THRESHOLDS,
      ftleEnabled: false, ensembleEnabled: false,
    });
    const pri = computePriority(id, VIEW, r);
    if (dec.action === 'split') splits++; else keeps++;

    const x = id.tx * CELL, y = id.ty * CELL;
    g.fillStyle = heat(cTile);
    g.fillRect(x, y, CELL, CELL);
    g.lineWidth = 4;
    g.strokeStyle = dec.action === 'split' ? '#e33'
                  : dec.action === 'keep' ? '#3c3' : '#888';
    g.strokeRect(x + 2, y + 2, CELL - 4, CELL - 4);
    g.fillStyle = '#000';
    g.fillText(`${id.z}/${id.tx}/${id.ty}`, x + 8, y + 16);
    g.fillText(`imp ${(r.outcome_impurity * 100).toFixed(0)}%`, x + 8, y + 30);
    g.fillText(OUTCOME_NAMES[r.dominant_outcome] ?? '?', x + 8, y + 44);
    g.fillText(`S ${sTile.toFixed(3)}`, x + 8, y + 58);
    g.fillText(`pri ${pri.toFixed(1)}`, x + 8, y + 72);

    log(`tile ${id.z}/${id.tx}/${id.ty}: S=${sTile.toFixed(3)} ` +
        `imp=${r.outcome_impurity.toFixed(2)} dom=${OUTCOME_NAMES[r.dominant_outcome]} ` +
        `→ ${dec.action} (${dec.reason})`);
  }
  log(`done: ${tiles.length}/${tiles.length} tiles reduced — ` +
      `${splits} split / ${keeps} keep (schema v ok)`);
}

void main().catch((e: unknown) => log(`harness failed: ${String(e)}`));
