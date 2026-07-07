import type { Vec2, TrajState, Triple } from '@/math/types.js';

export interface RK45Opts {
  hMin:    number;     // minimum step size (abort if forced below this)
  hMax:    number;     // maximum step size
  hInit:   number;     // initial step size
  epsRel:  number;     // relative error tolerance per step
  epsAbs:  number;     // absolute error tolerance per step
  THorizon: number;    // total integration horizon
  rColl:   number;
  REsc:    number;
  kEsc:    number;
  /** When true, log every accepted step (large InspectorResult). When
   *  false, log only at fixed checkpoint times for the M-checkpoint
   *  shape-sphere trace. */
  fullTrace: boolean;
  checkpointCount: number;
  /** Wall-clock cap in ms: the run loop stops (outcome 'timeout') when
   *  exceeded and returns the partial trajectory. Absent = uncapped. The
   *  hover-streamline runs the inspector on the main thread and relies on
   *  this to stay inside a frame budget. */
  budgetMs?: number;
}

export const RK45_DEFAULTS: RK45Opts = {
  hMin: 1e-10, hMax: 1e-2, hInit: 1e-4,
  epsRel: 1e-10, epsAbs: 1e-12,
  THorizon: 80, rColl: 1e-4, REsc: 10, kEsc: 8,
  fullTrace: true, checkpointCount: 32,
};

export interface InspectorResult {
  /** Full trajectory at every accepted step (when `fullTrace`). */
  t: number[];
  r: Triple<Vec2>[];
  p: Triple<Vec2>[];
  /** Shape-sphere trace (always populated). */
  nShape: { x: number; y: number; z: number }[];

  /** Derived series. */
  energy: number[];
  lz:     number[];

  /** Summary scalars. */
  outcome:     'escape' | 'collision' | 'bounded' | 'timeout' | 'failed';
  tEnd:        number;
  dMin:        number;
  deltaEMax:   number;
  ftle:        number;
  freeGroupWord: string;

  /** Symbolic / metadata. */
  ic: { m: TrajState['m']; r: TrajState['r']; p: TrajState['p'] };
  chartUv?: readonly [number, number];
  nSteps:   number;
  nReject:  number;
  cpuMs:    number;

  /** Validation panel: comparison vs GPU. */
  validation?: {
    gpuOutcomeAgrees: boolean;
    gpuFtleDelta:     number;
    gpuWordAgrees:    boolean;
  };
}
