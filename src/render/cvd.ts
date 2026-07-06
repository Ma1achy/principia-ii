import type { Vec3 } from '@/math/types.js';

// Linear-sRGB CVD simulation matrices (Brettel/Viénot/Mollon formulation).
// Applied in linear space only — applying them after gamma encode looks
// visibly wrong (colours too dark).
const PROTAN = [
  0.567, 0.433, 0,
  0.558, 0.442, 0,
  0,     0.242, 0.758,
];
const DEUTAN = [
  0.625, 0.375, 0,
  0.700, 0.300, 0,
  0,     0.300, 0.700,
];
const TRITAN = [
  0.950, 0.050, 0,
  0,     0.433, 0.567,
  0,     0.475, 0.525,
];
const ACHROM = [
  0.299, 0.587, 0.114,
  0.299, 0.587, 0.114,
  0.299, 0.587, 0.114,
];

const MATRICES: Record<string, number[]> = {
  protan: PROTAN, deutan: DEUTAN, tritan: TRITAN, achrom: ACHROM,
};

export function applyCvd(rgb: Vec3, mode: keyof typeof MATRICES | 'none'): Vec3 {
  if (mode === 'none') return rgb;
  const M = MATRICES[mode]!;
  return [
    M[0]!*rgb[0] + M[1]!*rgb[1] + M[2]!*rgb[2],
    M[3]!*rgb[0] + M[4]!*rgb[1] + M[5]!*rgb[2],
    M[6]!*rgb[0] + M[7]!*rgb[1] + M[8]!*rgb[2],
  ];
}
