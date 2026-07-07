import type { Vec2, Vec3, Vec8, TerminalLabel, TrajState } from '@/math/types.js';
import type { ICDescriptor } from '@/decode/types.js';
import type { ChartUniforms } from '@/gpu/chart_uniforms.js';

export type ChartId =
  | 'latent_slice'
  | 'lz_e' | 'lz_k'
  | 'shape_sphere'
  | 'mass_simplex'
  | 'burrau_euclid'
  | 'mixed_axis';

export type ChartKind = 'affine' | 'invariant' | 'sphere' | 'mass_simplex' | 'mixed';

/** Each chart declares the compatibility flags downstream code reads. */
export interface ChartFlags {
  forbids_energy_normalisation: boolean;
  has_redundant_hemisphere:     boolean;
  requires_per_pixel_mass:      boolean;
}

export interface ChartDecodeOk {
  kind: 'ok';
  state: TrajState;
  descriptor: ICDescriptor;
}

export interface ChartDecodeTerminal {
  kind: 'terminal';
  terminal: TerminalLabel;
  descriptor: ICDescriptor;
}

export type ChartDecodeOut = ChartDecodeOk | ChartDecodeTerminal;

export type ValidationResult =
  | { kind: 'pass' }
  | { kind: 'project'; pixel: { s: number; t: number }; reason: string }
  | { kind: 'clamp';   pixel: { s: number; t: number }; reason: string }
  | { kind: 'reject';  reason: string };

export interface EncodeResult {
  kind: 'exact' | 'projected' | 'rejected';
  pixel?: { s: number; t: number };
  reason?: string;
  z?:    Vec8;
  clamped?: boolean;
}

export interface Chart {
  id:    ChartId;
  kind:  ChartKind;
  flags: ChartFlags;
  /** Map a tile-local (u, v) ∈ [0, 1]² to a physical IC. */
  decode(uv: Vec2, view: ChartView): ChartDecodeOut;
  /** Project a physical IC back to chart pixel space. */
  inverseEncode(ic: TrajState): EncodeResult;
  /** Validate (uv) is a representable point in the chart for this view. */
  validate(uv: Vec2, view: ChartView): ValidationResult;
  /** Per-chart decoder knobs for the GPU (G4): packed into the
   *  ChartUniforms buffer at group(0) binding(3) on dispatch. */
  chartUniforms(view: ChartView): ChartUniforms;
  /** Optional: chart-specific WGSL fragment to inline at dispatch time. */
  wgsl?: string;
}

/** Chart-aware subset of ViewState that decode/validate need. */
export interface ChartView {
  chartParams: Record<string, unknown>;
  z0:          Vec8;
  q1:          Vec8;
  q2:          Vec8;
  mag:         number;
  m?:          Vec3;
  alphaMin:    number;
  muMax:       number;
  qMax:        number;
  rColl:       number;
  deltaLambda: number;
}
