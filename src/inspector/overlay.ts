import type { InspectorResult } from './types.js';

/**
 * UI contract for the locked-pixel inspector overlay. The view is
 * implementation-agnostic (HTML/Canvas/WebGL); this module only describes
 * the data slots.
 */
export interface OverlaySlots {
  shapeSpherePanel:  { trajectory: { x: number; y: number; z: number }[];
                       landmarks: ('BC' | 'Euler' | 'Lagrange')[]; };
  realSpacePanel:    { bodies: { positions: (readonly [number, number])[];
                                 trail: (readonly [number, number])[] }[]; };
  icSummary:         { masses: number[]; positions: any[]; momenta: any[];
                       chartUv?: readonly [number, number]; outcome: string; };
  diagnostics:       { energyDrift: number[]; lzDrift: number[];
                       freqDiffusion?: number; ftle?: number; encounters: number; };
  freeGroupWord:     string;
  validationPanel?:  { gpuOutcomeAgrees: boolean; gpuFtleDelta: number;
                       gpuWordAgrees: boolean; flagged: boolean; };
}

export function inspectorToOverlay(r: InspectorResult): OverlaySlots {
  return {
    shapeSpherePanel: { trajectory: r.nShape,
                        landmarks: ['BC', 'Euler', 'Lagrange'] },
    realSpacePanel: {
      bodies: [0, 1, 2].map(i => ({
        positions: r.r.map(s => s[i as 0 | 1 | 2]),
        trail:     r.r.map(s => s[i as 0 | 1 | 2]),
      })),
    },
    icSummary: {
      masses: [r.ic.m[0], r.ic.m[1], r.ic.m[2]],
      positions: [...r.ic.r], momenta: [...r.ic.p],
      // Conditional spread: exactOptionalPropertyTypes forbids
      // `chartUv: undefined`.
      ...(r.chartUv ? { chartUv: r.chartUv } : {}),
      outcome: r.outcome,
    },
    diagnostics: {
      energyDrift: r.energy.map(E => E - r.energy[0]!),
      lzDrift:     r.lz.map(L => L - r.lz[0]!),
      ftle:        r.ftle,
      encounters:  0,    // populated when a metrics tick is wired in
    },
    freeGroupWord: r.freeGroupWord,
    ...(r.validation
      ? { validationPanel: { ...r.validation,
            flagged: !r.validation.gpuOutcomeAgrees
                  || Math.abs(r.validation.gpuFtleDelta) > 0.1
                  || !r.validation.gpuWordAgrees } }
      : {}),
  };
}
