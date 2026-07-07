/**
 * Quadtree depth-stress harness: exercises the M4/M5 refinement machinery
 * at higher resolution (N = 32 samples per tile axis, 4× the M5 harness)
 * and real depth — descending the quadtree level by level on the REAL
 * pipeline (simulate → reduce → schema-checked readback → coherence →
 * decideSplit → priority) instead of evaluating a single fixed level.
 *
 * Two descents from the z=2 base grid:
 *   - BOUNDARY chase: recurse into the max-impurity child each level.
 *     Basin boundaries are (near-)fractal, so this path should keep
 *     force-splitting on impurity until the f32 floor guard stops it.
 *   - UNIFORM chase: recurse into the min-impurity child. This should
 *     settle to keep('coherent') within a few levels.
 *
 * The AT_F32_FLOOR status bit is set CPU-side from pyramid.reachedF32Floor
 * (the camera clamp normally prevents requests below the floor; nothing on
 * the GPU sets the bit — this mirrors the scheduler's intended wiring).
 *
 * Also runs a one-tile N=64 hi-res smoke (workgroup grid 8×8) to check the
 * pipeline at a higher per-tile resolution than any prior harness.
 *
 * Served by Vite: `npm run dev:depth`. Headless check:
 * dev/out/depth_stress_check.mjs reads window.__depthStress.
 */
import { initGpu, type GpuContext } from '@/gpu/init.js';
import { createTileBuffers, type TileBuffers } from '@/gpu/buffers.js';
import { buildPipelines, type Pipelines } from '@/gpu/pipelines.js';
import { buildReducePipeline, type ReducePipeline } from '@/gpu/reduce_pipeline.js';
import { dispatchReduce } from '@/gpu/reduce_dispatch.js';
import { readbackReduction } from '@/gpu/reduce_readback.js';
import { packSimUniforms, packTileRequest, type SimUniforms } from '@/gpu/structs.js';
import { tileCentreHalf, tileBounds, children, tileKey } from '@/quadtree/tile.js';
import { reachedF32Floor, Z_MAX_DEFAULT } from '@/quadtree/pyramid.js';
import { effectiveZ } from '@/quadtree/camera.js';
import { compositeCoherence } from '@/quadtree/coherence.js';
import { decideSplit, DEFAULT_THRESHOLDS } from '@/quadtree/split.js';
import { computePriority } from '@/quadtree/priority.js';
import { TILE_STATUS } from '@/quadtree/reduction_types.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';
import { OUTCOME_NAMES } from '@/debug/descriptor_bits.js';
import type { QuadtreeView, TileCacheKey, TileID } from '@/quadtree/types.js';

import {
  SIMULATE_MODULE, RENDER_LAYER0_MODULE, REDUCE_MODULE,
} from './shader_modules.js';

const N = 32;              // 1024 samples per tile — 4× the M5 harness
const N_HIRES = 64;        // one-tile smoke at 4096 samples
const M = 8;
const Z_BASE = 2;
const CELL = 96;

const logPane = document.getElementById('log') as HTMLPreElement;
function log(s: string): void {
  console.log(s);
  logPane.textContent += `${s}\n`;
  logPane.scrollTop = logPane.scrollHeight;
}

const UNIFORMS: SimUniforms = {
  G: 1,
  dt_macro: 1e-3, N_max: 64, r_sub: 0.05, gamma_sub: 1.5,
  T_horizon: 20,
  r_coll: 1e-4, R_esc: 10, k_esc: 8, eps_E: 1e-6, eps_L: 1e-6, r_close: 0.01,
  quality_tier: 1, checkpoint_count: M, samples_per_axis: N,
};

interface LevelRecord {
  key: string;
  z: number;
  impurity: number;
  suspect: number;
  sTile: number;
  cTile: number;
  tau: number;
  action: string;
  reason: string;
  priority: number;
  sampleCount: number;
  dominant: string;
  allFinite: boolean;
  atFloor: boolean;
  ms: number;
}

interface DescentResult {
  mode: 'boundary' | 'uniform';
  levels: LevelRecord[];
  stoppedBecause: string;
}

function shapedTile(
  ctx: GpuContext, bufs: TileBuffers, pl: Pipelines, id: TileID, n: number,
): void {
  const { centre, half } = tileCentreHalf(id);
  ctx.device.queue.writeBuffer(bufs.uniforms, 0,
    packSimUniforms({ ...UNIFORMS, samples_per_axis: n }));
  ctx.device.queue.writeBuffer(bufs.tileReq, 0, packTileRequest({
    z: id.z, tx: id.tx, ty: id.ty, level: id.z,
    uv_centre: centre, uv_half: half, flags: 0,
  }));
  const enc = ctx.device.createCommandEncoder({ label: 'simulate-tile' });
  const pass = enc.beginComputePass();
  pass.setPipeline(pl.simulate);
  pass.setBindGroup(0, pl.bindGroupCommon);
  pass.setBindGroup(1, pl.bindGroupSim);
  pass.dispatchWorkgroups(Math.ceil(n / 8), Math.ceil(n / 8), 1);
  pass.end();
  ctx.device.queue.submit([enc.finish()]);
}

async function computeTile(
  ctx: GpuContext, bufs: TileBuffers, pl: Pipelines, rp: ReducePipeline,
  id: TileID, n: number,
): Promise<{ r: TileReduction; ms: number }> {
  const t0 = performance.now();
  shapedTile(ctx, bufs, pl, id, n);
  ctx.device.queue.submit([dispatchReduce(ctx, rp)]);
  const r = await readbackReduction(rp, M);   // ADR-0006 schema check inside
  return { r, ms: performance.now() - t0 };
}

const FINITE_FIELDS: (keyof TileReduction & string)[] = [
  'mean_t_end', 'mean_d_min', 'mean_energy_drift',
  'spread_n', 'outcome_impurity', 'suspect_fraction',
  'energy_drift_worst', 'mean_word_length', 'word_agreement',
];

function checkFinite(r: TileReduction): boolean {
  return FINITE_FIELDS.every((f) => Number.isFinite(r[f] as number));
}

function heat(c: number): string {
  const red = Math.round(255 * (1 - c));
  const grn = Math.round(200 * c);
  return `rgb(${red},${grn},40)`;
}

function paintCell(
  g: CanvasRenderingContext2D, col: number, row: number, rec: LevelRecord,
): void {
  const x = col * (CELL * 3 + 48), y = row * (CELL * 0.7 + 8);
  const w = CELL * 3, h = CELL * 0.7;
  g.fillStyle = heat(rec.cTile);
  g.fillRect(x, y, w, h);
  g.lineWidth = 3;
  g.strokeStyle = rec.action === 'split' ? '#e33'
                : rec.action === 'keep' ? '#3c3' : '#888';
  g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  g.fillStyle = '#000';
  g.fillText(`${rec.key}  ${rec.dominant}`, x + 6, y + 14);
  g.fillText(`imp ${(rec.impurity * 100).toFixed(1)}%  S ${rec.sTile.toFixed(3)}  τ ${rec.tau.toFixed(2)}`, x + 6, y + 28);
  g.fillText(`${rec.action} (${rec.reason})  pri ${rec.priority.toFixed(1)}  ${rec.ms.toFixed(0)}ms`, x + 6, y + 42);
  if (rec.atFloor) g.fillText('AT_F32_FLOOR', x + 6, y + 56);
}

function makeRecord(
  id: TileID, r: TileReduction, view: QuadtreeView, ms: number,
): LevelRecord {
  const atFloor = reachedF32Floor(id.z, N);
  if (atFloor) r.status_flags |= TILE_STATUS.AT_F32_FLOOR;
  const { sTile, cTile } = compositeCoherence(r,
    { ftleEnabled: false, ensembleEnabled: false });
  r.coherence_score = sTile;
  const dec = decideSplit(r, {
    level: id.z, maxDepth: Z_MAX_DEFAULT, visible: true,
    thresholds: DEFAULT_THRESHOLDS,
    ftleEnabled: false, ensembleEnabled: false,
  });
  const tau = DEFAULT_THRESHOLDS.tau0 + DEFAULT_THRESHOLDS.tauPerLevel * id.z;
  return {
    key: tileKey(id), z: id.z,
    impurity: r.outcome_impurity, suspect: r.suspect_fraction,
    sTile, cTile, tau,
    action: dec.action, reason: dec.reason,
    priority: computePriority(id, view, r),
    sampleCount: r.sample_count,
    dominant: OUTCOME_NAMES[r.dominant_outcome] ?? '?',
    allFinite: checkFinite(r),
    atFloor, ms,
  };
}

/** Children must tile the parent exactly (CPU geometry sanity at depth). */
function childrenCoverParent(id: TileID): boolean {
  const pb = tileBounds(id);
  const [nw, , , se] = children(id);
  const b0 = tileBounds(nw), b3 = tileBounds(se);
  const eps = 1e-12;
  return Math.abs(b0.uMin - pb.uMin) < eps
      && Math.abs(b0.vMin - pb.vMin) < eps
      && Math.abs(b3.uMax - pb.uMax) < eps
      && Math.abs(b3.vMax - pb.vMax) < eps
      && Math.abs((b0.uMax - b0.uMin) * 2 - (pb.uMax - pb.uMin)) < eps;
}

async function descend(
  ctx: GpuContext, bufs: TileBuffers, pl: Pipelines, rp: ReducePipeline,
  g: CanvasRenderingContext2D, view: QuadtreeView,
  start: TileID, mode: 'boundary' | 'uniform', col: number,
): Promise<DescentResult> {
  const levels: LevelRecord[] = [];
  let id = start;
  let stoppedBecause = 'depth_cap';
  let geometryOk = true;

  for (let row = 0; id.z <= 16; row++) {
    const { r, ms } = await computeTile(ctx, bufs, pl, rp, id, N);
    const rec = makeRecord(id, r, view, ms);
    levels.push(rec);
    paintCell(g, col, row, rec);
    log(`[${mode}] ${rec.key}: imp=${rec.impurity.toFixed(3)} S=${rec.sTile.toFixed(3)} ` +
        `τ=${rec.tau.toFixed(2)} → ${rec.action}(${rec.reason}) ${rec.ms.toFixed(0)}ms`);

    if (rec.action !== 'split') { stoppedBecause = rec.reason; break; }

    if (!childrenCoverParent(id)) geometryOk = false;
    // Compute all four children, pick by impurity per the chase mode.
    const kids = children(id);
    let best: { id: TileID; r: TileReduction; ms: number } | null = null;
    for (const kid of kids) {
      const res = await computeTile(ctx, bufs, pl, rp, kid, N);
      if (!best
          || (mode === 'boundary'
              ? res.r.outcome_impurity > best.r.outcome_impurity
              : res.r.outcome_impurity < best.r.outcome_impurity)) {
        best = { id: kid, r: res.r, ms: res.ms };
      }
    }
    id = best!.id;
  }
  if (!geometryOk) stoppedBecause = 'GEOMETRY_MISMATCH';
  return { mode, levels, stoppedBecause };
}

async function main(): Promise<void> {
  if (!('gpu' in navigator)) { log('WebGPU unavailable.'); return; }
  const ctx = await initGpu();
  ctx.device.addEventListener('uncapturederror', (e) => {
    log(`WebGPU uncaptured error: ${(e as GPUUncapturedErrorEvent).error.message}`);
  });

  // Buffers sized for the hi-res case; N<=64 tiles reuse the same buffers
  // (reduce reads exactly sample_count = N² lanes via samples_per_axis).
  const bufs = createTileBuffers(ctx, N_HIRES, M);
  const pl = await buildPipelines(ctx, bufs, {
    simulate: SIMULATE_MODULE,
    render: RENDER_LAYER0_MODULE,
  });
  const rp = await buildReducePipeline(ctx, bufs, REDUCE_MODULE);

  const g = (document.getElementById('map') as HTMLCanvasElement).getContext('2d')!;
  g.font = '11px monospace';

  const KEY = {} as TileCacheKey;
  const view: QuadtreeView = {
    cacheKey: KEY, uvCentre: [0.5, 0.5], uvHalfWidth: [0.5, 0.5],
    zBase: Z_BASE, zMax: Z_MAX_DEFAULT, width: 512, height: 512, tilePix: 128,
  };

  // --- Base sweep at z=2: find the most and least impure tiles. ---
  log(`base sweep: 16 tiles at z=${Z_BASE}, N=${N} (${N * N} samples/tile)`);
  let mostImpure: { id: TileID; imp: number } | null = null;
  let leastImpure: { id: TileID; imp: number } | null = null;
  for (let ty = 0; ty < 4; ty++) {
    for (let tx = 0; tx < 4; tx++) {
      const id: TileID = { z: Z_BASE, tx, ty };
      const { r } = await computeTile(ctx, bufs, pl, rp, id, N);
      if (!mostImpure || r.outcome_impurity > mostImpure.imp)
        mostImpure = { id, imp: r.outcome_impurity };
      if (!leastImpure || r.outcome_impurity < leastImpure.imp)
        leastImpure = { id, imp: r.outcome_impurity };
    }
  }
  log(`boundary start: ${tileKey(mostImpure!.id)} (imp ${mostImpure!.imp.toFixed(3)}); ` +
      `uniform start: ${tileKey(leastImpure!.id)} (imp ${leastImpure!.imp.toFixed(3)})`);

  // --- Two descents. ---
  const boundary = await descend(ctx, bufs, pl, rp, g, view, mostImpure!.id, 'boundary', 0);
  const uniform  = await descend(ctx, bufs, pl, rp, g, view, leastImpure!.id, 'uniform', 1);

  // --- Hi-res one-tile smoke at N=64. ---
  log(`hi-res smoke: 1 tile at z=${Z_BASE}, N=${N_HIRES} (${N_HIRES * N_HIRES} samples)`);
  const hi = await computeTile(ctx, bufs, pl, rp, mostImpure!.id, N_HIRES);
  const hiOk = hi.r.sample_count === N_HIRES * N_HIRES && checkFinite(hi.r);
  log(`hi-res: sample_count=${hi.r.sample_count} imp=${hi.r.outcome_impurity.toFixed(3)} ` +
      `finite=${checkFinite(hi.r)} ${hi.ms.toFixed(0)}ms`);

  // --- CPU camera/floor cross-checks at depth. ---
  const floorZ = (() => { let z = 0; while (!reachedF32Floor(z, N)) z++; return z; })();
  const effAtExtreme = effectiveZ({ ...view, zMax: Z_MAX_DEFAULT }, N);
  log(`f32 floor for N=${N}: z=${floorZ}; effectiveZ clamp check: ${effAtExtreme} <= floor`);

  (window as unknown as Record<string, unknown>)['__depthStress'] = {
    boundary, uniform,
    hiRes: { sampleCount: hi.r.sample_count, ok: hiOk },
    floorZ,
    done: true,
  };
  log(`done: boundary ${boundary.levels.length} levels (stop: ${boundary.stoppedBecause}); ` +
      `uniform ${uniform.levels.length} levels (stop: ${uniform.stoppedBecause})`);
}

void main().catch((e: unknown) => {
  log(`harness failed: ${String(e)}`);
  (window as unknown as Record<string, unknown>)['__depthStress'] =
    { done: true, failed: String(e) };
});
