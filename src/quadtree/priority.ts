import type { TileID, QuadtreeView } from './types.js';
import type { TileReduction } from './reduction_types.js';
import { tileBounds } from './tile.js';
import { clamp } from '@/math/scalar.js';

export interface PriorityWeights {
  wv: number;     // visibility (dominant)
  wz: number;     // zoom-match
  wc: number;     // complexity
  wf: number;     // focus
}

export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = {
  wv: 10, wz: 2, wc: 3, wf: 1,
};

export function computePriority(
  id: TileID, view: QuadtreeView,
  r: TileReduction | null,
  weights = DEFAULT_PRIORITY_WEIGHTS,
): number {
  const b = tileBounds(id);
  const visible =
    !(b.uMax < view.uvCentre[0] - view.uvHalfWidth[0] ||
      b.uMin > view.uvCentre[0] + view.uvHalfWidth[0] ||
      b.vMax < view.uvCentre[1] - view.uvHalfWidth[1] ||
      b.vMin > view.uvCentre[1] + view.uvHalfWidth[1]);
  const Pv = visible ? 1 : 0;

  const Pz = view.zBase === 0 ? 1
    : clamp(1 - Math.abs(id.z - view.zBase) / view.zBase, 0, 1);

  const Pc = r ? clamp(r.coherence_score / (1 + r.coherence_score), 0, 1) : 0.5;

  const cx = (b.uMin + b.uMax) / 2;
  const cy = (b.vMin + b.vMax) / 2;
  const dist = Math.hypot(cx - view.uvCentre[0], cy - view.uvCentre[1]);
  const Pf = 1 / (1 + dist * 50);

  return weights.wv*Pv + weights.wz*Pz + weights.wc*Pc + weights.wf*Pf;
}
