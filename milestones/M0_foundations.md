# M0 — Foundations: project skeleton, math primitives, CI gate

## Goal

A fresh clone runs `npm install && npm test` and lands green, with the
math/decoder/integrator tests that later milestones lean on already in
place.

**Exit criterion (single executable test).**

```bash
npm test -- --run test/unit/math
```

passes with at least 30 unit tests, all of which are green.

## File tree created in this milestone

```
principia/
  package.json
  tsconfig.json
  vitest.config.ts
  .gitignore
  README.md
  src/
    math/
      vec.ts
      scalar.ts
      softmax.ts
      rotate.ts
      types.ts
      constants.ts
      index.ts
  test/
    unit/
      math/
        vec.test.ts
        scalar.test.ts
        softmax.test.ts
        rotate.test.ts
```

## Project bootstrap

### `package.json`

```json
{
  "name": "principia",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "lint": "eslint src test --ext .ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "build": "tsc -p tsconfig.json"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.57.0",
    "typescript": "^5.4.0",
    "vitest": "^1.4.0"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    },
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

### `vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    reporters: 'default',
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
```

### `.gitignore`

```
node_modules
dist
coverage
*.log
.DS_Store
```

## `src/math/types.ts` — shared types

```ts
/**
 * Tuple types for plane and 8D latent vectors. Tuples (rather than
 * `number[]`) give us length-checked arithmetic at compile time.
 */
export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Vec4 = readonly [number, number, number, number];
export type Vec8 = readonly [
  number, number, number, number,
  number, number, number, number,
];

export type Triple<T> = readonly [T, T, T];

/**
 * Trajectory state in the COM frame.
 *
 * Positions and momenta are kept per-body. Masses sum to 1 in the
 * dimensionless system (M = 1, G = 1, I = 1).
 */
export interface TrajState {
  readonly r: Triple<Vec2>;   // positions
  readonly p: Triple<Vec2>;   // momenta
  readonly m: Vec3;           // masses, sum = 1
  readonly t: number;         // simulation time
}

/**
 * Terminal labels, used at decode time and by the integrator's event
 * detection. These are total — every UV pixel ends up in exactly one
 * state (spec §1.6.7, §4).
 */
export type TerminalLabel =
  | { kind: 'NONE' }
  | { kind: 'DEGENERATE'; reason: string }
  | { kind: 'COLLISION_T0'; pair: 0 | 1 | 2 }
  | { kind: 'COLLISION'; pair: 0 | 1 | 2; t: number }
  | { kind: 'ESCAPE'; body: 0 | 1 | 2; t: number }
  | { kind: 'BOUNDED'; T: number }
  | { kind: 'TIMEOUT'; T: number }
  | { kind: 'MAX_SUBSTEPS'; t: number }
  | { kind: 'SIM_FAILED'; reason: string; t: number };
```

## `src/math/constants.ts`

```ts
/** Dimensionless unit system used everywhere except quoted physical examples. */
export const G = 1;
export const M_TOTAL = 1;          // Σ m_i = 1
export const I_GAUGE = 1;           // moment of inertia after the scale gauge

/** Numerical floors and clamps from spec Appendix A. */
export const EPS_DECODE       = 1e-6;     // sigmoid clamp
export const EPS_DEADBAND     = 1e-12;    // mirror rule deadband
export const EPS_ENERGY_FLOOR = 1e-6;     // for relative drift metric
export const EPS_LZ_FLOOR     = 1e-6;
export const EPS_BOLT         = 1e-30;    // virial denominator floor

/** Decode hyperparameters (spec Appendix A defaults). */
export const MU_MAX_DEFAULT     = 5;     // mass logit saturation
export const ALPHA_MIN_DEFAULT  = 0.05;  // hyperspherical buffer (radians)
export const Q_MAX_DEFAULT      = 2;     // free-momentum cap

/** Event thresholds. */
export const R_COLL_DEFAULT     = 1e-4;
export const R_ESC_DEFAULT      = 10;
export const K_ESC_DEFAULT      = 8;     // escape persistence count

/** Substepping. */
export const R_SUB_DEFAULT      = 0.05;
export const GAMMA_SUB_DEFAULT  = 1.5;
export const N_MAX_DEFAULT      = 64;
export const DT_MACRO_DEFAULT   = 1e-3;
export const T_HORIZON_DEFAULT  = 80;    // long enough for Burrau resolution
```

## `src/math/scalar.ts`

```ts
/**
 * Numerically stable sigmoid that avoids `exp` overflow for large negative z.
 *
 * For z >= 0:  σ(z) = 1 / (1 + exp(-z))
 * For z <  0:  σ(z) = exp(z) / (1 + exp(z))
 */
export function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  } else {
    const e = Math.exp(z);
    return e / (1 + e);
  }
}

/**
 * Inverse of sigmoid on (0, 1). Caller is responsible for clamping the
 * input away from the endpoints (use {@link clamp01}).
 */
export function logit(s: number): number {
  return Math.log(s / (1 - s));
}

/**
 * artanh for inputs in (-1, 1). Caller clamps.
 */
export function artanh(x: number): number {
  return 0.5 * Math.log((1 + x) / (1 - x));
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

/**
 * Hermite smoothstep; matches the WGSL `smoothstep` exactly, including the
 * out-of-range plateau behaviour.
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Symmetric log: linear within ±epsilon, log outside. Used for the
 * energy colour palette (spec §5.3.1).
 */
export function symlog(x: number, eps = 1e-3): number {
  if (Math.abs(x) <= eps) return x / eps;
  return Math.sign(x) * (1 + Math.log(Math.abs(x) / eps));
}

/**
 * ε-deadbanded sign: returns 0 inside [-ε, ε], otherwise the sign.
 */
export function signDeadband(x: number, eps: number): -1 | 0 | 1 {
  if (x >  eps) return  1;
  if (x < -eps) return -1;
  return 0;
}
```

## `src/math/vec.ts`

```ts
import type { Vec2, Vec3, Vec8 } from './types.js';

/* ============================================================ */
/*  Vec2                                                         */
/* ============================================================ */

export const ZERO2: Vec2 = [0, 0];

export function v2(x: number, y: number): Vec2 { return [x, y]; }

export function add2(a: Vec2, b: Vec2): Vec2 { return [a[0]+b[0], a[1]+b[1]]; }
export function sub2(a: Vec2, b: Vec2): Vec2 { return [a[0]-b[0], a[1]-b[1]]; }
export function neg2(a: Vec2):          Vec2 { return [-a[0], -a[1]]; }
export function scale2(a: Vec2, s: number): Vec2 { return [a[0]*s, a[1]*s]; }
export function dot2(a: Vec2, b: Vec2): number { return a[0]*b[0] + a[1]*b[1]; }
export function norm2(a: Vec2): number { return Math.hypot(a[0], a[1]); }
export function normSq2(a: Vec2): number { return a[0]*a[0] + a[1]*a[1]; }

/** Planar cross product (z-component). */
export function crossZ(a: Vec2, b: Vec2): number {
  return a[0]*b[1] - a[1]*b[0];
}

/** 90° anti-clockwise rotation: J(x, y) = (-y, x). Used pervasively in
 *  the L_z chart and rotational decompositions. */
export function J(v: Vec2): Vec2 { return [-v[1], v[0]]; }

export function normalize2(a: Vec2): Vec2 {
  const n = norm2(a);
  if (n === 0) return [0, 0];
  return [a[0]/n, a[1]/n];
}

/* ============================================================ */
/*  Vec3 (used for mass triples and Cartesian shape-sphere n)    */
/* ============================================================ */

export const ZERO3: Vec3 = [0, 0, 0];

export function v3(x: number, y: number, z: number): Vec3 { return [x, y, z]; }

export function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
}
export function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
}
export function scale3(a: Vec3, s: number): Vec3 {
  return [a[0]*s, a[1]*s, a[2]*s];
}
export function dot3(a: Vec3, b: Vec3): number {
  return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
}
export function norm3(a: Vec3): number {
  return Math.sqrt(dot3(a, a));
}
export function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0],
  ];
}
export function normalize3(a: Vec3): Vec3 {
  const n = norm3(a);
  if (n === 0) return [0, 0, 1];     // canonical fallback
  return [a[0]/n, a[1]/n, a[2]/n];
}

/* ============================================================ */
/*  Vec8 (latent space)                                          */
/* ============================================================ */

export const ZERO8: Vec8 = [0, 0, 0, 0, 0, 0, 0, 0];

export function v8(...xs: number[]): Vec8 {
  if (xs.length !== 8) throw new Error(`v8 needs 8 components, got ${xs.length}`);
  return xs as unknown as Vec8;
}

export function unitE8(k: number): Vec8 {
  if (k < 0 || k >= 8) throw new Error(`unitE8 index out of range: ${k}`);
  const v = [0, 0, 0, 0, 0, 0, 0, 0];
  v[k] = 1;
  return v as unknown as Vec8;
}

export function add8(a: Vec8, b: Vec8): Vec8 {
  return [
    a[0]+b[0], a[1]+b[1], a[2]+b[2], a[3]+b[3],
    a[4]+b[4], a[5]+b[5], a[6]+b[6], a[7]+b[7],
  ];
}
export function sub8(a: Vec8, b: Vec8): Vec8 {
  return [
    a[0]-b[0], a[1]-b[1], a[2]-b[2], a[3]-b[3],
    a[4]-b[4], a[5]-b[5], a[6]-b[6], a[7]-b[7],
  ];
}
export function scale8(a: Vec8, s: number): Vec8 {
  return [
    a[0]*s, a[1]*s, a[2]*s, a[3]*s,
    a[4]*s, a[5]*s, a[6]*s, a[7]*s,
  ];
}
export function dot8(a: Vec8, b: Vec8): number {
  return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]
       + a[4]*b[4] + a[5]*b[5] + a[6]*b[6] + a[7]*b[7];
}
export function norm8(a: Vec8): number {
  return Math.sqrt(dot8(a, a));
}
export function normalize8(a: Vec8): Vec8 {
  const n = norm8(a);
  if (n === 0) throw new Error('normalize8 of zero vector');
  return scale8(a, 1 / n);
}
```

## `src/math/softmax.ts`

```ts
import type { Vec3 } from './types.js';

/**
 * Reference-logit softmax with hyperbolic-tangent saturation, exactly as
 * specified in spec §1.6.1.
 *
 * The reference logit μ₀ is fixed at 0; μ₁ and μ₂ are saturated through
 * tanh(z_μ) before exponentiation. The output sums to 1 and is positive
 * everywhere.
 */
export function massFromLogits(zMu1: number, zMu2: number, muMax: number): Vec3 {
  const mu1 = muMax * Math.tanh(zMu1);
  const mu2 = muMax * Math.tanh(zMu2);
  // numerically stable softmax: subtract the maximum logit
  const max = Math.max(0, mu1, mu2);
  const e0 = Math.exp(   - max);
  const e1 = Math.exp(mu1 - max);
  const e2 = Math.exp(mu2 - max);
  const Z  = e0 + e1 + e2;
  return [e0 / Z, e1 / Z, e2 / Z];
}

/**
 * Direct simplex parameterisation (spec §1.6.1, alternative path used by
 * the ternary mass chart). Maps (t1, t2) ∈ [0,1]² to the simplex.
 * Caller may apply an interior buffer εₘ.
 *
 * The mapping x = t1, y = (1-t1)·t2, then (m0, m1, m2) = (1-x-y, x, y)
 * is a bijection from [0,1]² onto the simplex (spec ternary-mass map).
 */
export function massFromSimplex(t1: number, t2: number): Vec3 {
  const x = t1;
  const y = (1 - t1) * t2;
  const m0 = 1 - x - y;
  const m1 = x;
  const m2 = y;
  return [m0, m1, m2];
}

/**
 * Inverse of {@link massFromLogits}. Caller is responsible for clamping
 * `m_k / m_0` away from 0 and ∞ before calling.
 */
export function logitsFromMasses(m: Vec3): { mu1: number; mu2: number } {
  return { mu1: Math.log(m[1] / m[0]), mu2: Math.log(m[2] / m[0]) };
}
```

## `src/math/rotate.ts`

```ts
import type { Vec2 } from './types.js';

/**
 * 2x2 rotation matrix as `[c, -s, s, c]` row-major. Multiplies on the left:
 * `applyR(R, v) = R · v`.
 */
export type Mat2 = readonly [number, number, number, number];

export function rotation(theta: number): Mat2 {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c, -s, s, c];
}

export function applyR(R: Mat2, v: Vec2): Vec2 {
  return [R[0]*v[0] + R[1]*v[1], R[2]*v[0] + R[3]*v[1]];
}

/**
 * Reflect across the x-axis: (x, y) -> (x, -y). Used by the canonicaliser's
 * dead-banded mirror rule.
 */
export function reflectX(v: Vec2): Vec2 { return [v[0], -v[1]]; }
```

## `src/math/index.ts`

```ts
export * from './types.js';
export * from './constants.js';
export * from './scalar.js';
export * from './vec.js';
export * from './softmax.js';
export * from './rotate.js';
```

## Tests

### `test/unit/math/scalar.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  sigmoid, logit, artanh, clamp, clamp01, smoothstep, symlog, signDeadband,
} from '@/math/scalar.js';

describe('sigmoid / logit', () => {
  it('round-trips on a sweep of points away from saturation', () => {
    for (let s = 0.05; s < 1; s += 0.05) {
      const z = logit(s);
      expect(sigmoid(z)).toBeCloseTo(s, 12);
    }
  });

  it('is numerically stable for large negative z', () => {
    expect(sigmoid(-1000)).toBeGreaterThan(0);    // not NaN
    expect(sigmoid(-1000)).toBeLessThan(1e-100);
    expect(Number.isFinite(sigmoid(-1000))).toBe(true);
  });

  it('is numerically stable for large positive z', () => {
    expect(sigmoid(1000)).toBeCloseTo(1, 15);
    expect(Number.isFinite(sigmoid(1000))).toBe(true);
  });

  it('hits the half-point exactly at z = 0', () => {
    expect(sigmoid(0)).toBe(0.5);
  });
});

describe('artanh', () => {
  it('round-trips with tanh', () => {
    for (const x of [-0.9, -0.3, 0, 0.3, 0.9]) {
      expect(Math.tanh(artanh(x))).toBeCloseTo(x, 12);
    }
  });
});

describe('clamp / clamp01', () => {
  it('passes values inside the range unchanged', () => {
    expect(clamp(0.4, 0, 1)).toBe(0.4);
    expect(clamp01(0.7)).toBe(0.7);
  });
  it('snaps to bounds outside', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp01(-1e-10)).toBe(0);
    expect(clamp01(1 + 1e-10)).toBe(1);
  });
});

describe('smoothstep', () => {
  it('matches WGSL plateau behaviour outside [edge0, edge1]', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
  });
  it('hits 0.5 at the midpoint', () => {
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 12);
  });
  it('has zero derivative at the endpoints', () => {
    const eps = 1e-6;
    const dLow  = (smoothstep(0, 1, eps)        - smoothstep(0, 1, 0)) / eps;
    const dHigh = (smoothstep(0, 1, 1)          - smoothstep(0, 1, 1-eps)) / eps;
    expect(dLow).toBeLessThan(1e-9);
    expect(dHigh).toBeLessThan(1e-9);
  });
});

describe('symlog', () => {
  it('is linear inside ±ε', () => {
    expect(symlog(1e-4, 1e-3)).toBeCloseTo(0.1, 12);
    expect(symlog(-5e-4, 1e-3)).toBeCloseTo(-0.5, 12);
  });
  it('is monotonic across the boundary', () => {
    const eps = 1e-3;
    const a = symlog(eps,        eps);
    const b = symlog(eps + 1e-9, eps);
    expect(b).toBeGreaterThanOrEqual(a);
  });
});

describe('signDeadband', () => {
  it('returns 0 inside the band', () => {
    expect(signDeadband(0,    1e-12)).toBe(0);
    expect(signDeadband(1e-13, 1e-12)).toBe(0);
  });
  it('returns the sign outside', () => {
    expect(signDeadband(-1,    1e-12)).toBe(-1);
    expect(signDeadband(2e-12, 1e-12)).toBe(1);
  });
});
```

### `test/unit/math/vec.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  ZERO2, add2, sub2, scale2, dot2, norm2, crossZ, J, normalize2,
  ZERO3, dot3, cross3, norm3, normalize3,
  ZERO8, add8, scale8, dot8, norm8, normalize8, unitE8, v8,
} from '@/math/vec.js';

describe('Vec2 algebra', () => {
  it('add2 / sub2 are inverses', () => {
    const a = [3, -2] as const, b = [1, 4] as const;
    expect(sub2(add2(a, b), b)).toEqual(a);
  });

  it('dot2 with self equals norm²', () => {
    const a = [3, 4] as const;
    expect(dot2(a, a)).toBe(25);
    expect(norm2(a)).toBe(5);
  });

  it('crossZ is anti-symmetric', () => {
    const a = [1, 2] as const, b = [3, 4] as const;
    expect(crossZ(a, b)).toBe(-crossZ(b, a));
  });

  it('J ∘ J = -I', () => {
    const v = [3.7, -1.2] as const;
    const Jv = J(v), JJv = J(Jv);
    expect(JJv[0]).toBeCloseTo(-v[0], 15);
    expect(JJv[1]).toBeCloseTo(-v[1], 15);
  });

  it('normalize2 of zero is zero (no NaN)', () => {
    expect(normalize2(ZERO2)).toEqual(ZERO2);
  });
});

describe('Vec3 algebra', () => {
  it('cross3 is right-handed for standard basis', () => {
    expect(cross3([1,0,0], [0,1,0])).toEqual([0, 0, 1]);
  });

  it('cross3(a, a) is zero', () => {
    const a = [2, -3, 7] as const;
    expect(cross3(a, a)).toEqual([0, 0, 0]);
  });

  it('normalize3 preserves direction', () => {
    const u = normalize3([3, 4, 0]);
    expect(u[0]).toBeCloseTo(0.6, 12);
    expect(u[1]).toBeCloseTo(0.8, 12);
    expect(u[2]).toBe(0);
    expect(norm3(u)).toBeCloseTo(1, 12);
  });

  it('normalize3 of zero falls back to (0,0,1)', () => {
    expect(normalize3(ZERO3)).toEqual([0, 0, 1]);
  });
});

describe('Vec8 algebra', () => {
  it('unitE8 has length 1 and the right component set', () => {
    for (let k = 0; k < 8; k++) {
      const e = unitE8(k);
      expect(norm8(e)).toBe(1);
      expect(e[k]).toBe(1);
    }
  });

  it('add8 / scale8 distribute', () => {
    const a = v8(1,2,3,4,5,6,7,8);
    const b = v8(8,7,6,5,4,3,2,1);
    const lhs = scale8(add8(a, b), 2);
    const rhs = add8(scale8(a, 2), scale8(b, 2));
    for (let i = 0; i < 8; i++) expect(lhs[i]).toBeCloseTo(rhs[i], 15);
  });

  it('dot8 of orthogonal basis vectors is zero', () => {
    expect(dot8(unitE8(0), unitE8(3))).toBe(0);
  });

  it('normalize8 of zero throws', () => {
    expect(() => normalize8(ZERO8)).toThrow();
  });
});
```

### `test/unit/math/softmax.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  massFromLogits, massFromSimplex, logitsFromMasses,
} from '@/math/softmax.js';

describe('massFromLogits', () => {
  it('gives equal masses at z = (0, 0)', () => {
    const m = massFromLogits(0, 0, 5);
    expect(m[0]).toBeCloseTo(1/3, 12);
    expect(m[1]).toBeCloseTo(1/3, 12);
    expect(m[2]).toBeCloseTo(1/3, 12);
  });

  it('always sums to 1', () => {
    for (const z1 of [-100, -3, -0.1, 0, 0.5, 7, 1000]) {
      for (const z2 of [-50, 0, 2.2, 1e6]) {
        const m = massFromLogits(z1, z2, 5);
        expect(m[0] + m[1] + m[2]).toBeCloseTo(1, 12);
        expect(m[0]).toBeGreaterThan(0);
        expect(m[1]).toBeGreaterThan(0);
        expect(m[2]).toBeGreaterThan(0);
      }
    }
  });

  it('saturates symmetrically as z_μ1 → ±∞', () => {
    const muMax = 3;
    const mPlus  = massFromLogits(  1e9, 0, muMax);   // tanh saturates at +1
    const mMinus = massFromLogits(- 1e9, 0, muMax);
    // m1 saturates at e^muMax / (1 + e^muMax + 1) when z1→+∞ and z2=0
    const expHi = Math.exp(muMax);
    const Z = 1 + expHi + 1;
    expect(mPlus[1]).toBeCloseTo(expHi / Z, 9);
    // and at e^(-muMax) / (1 + e^(-muMax) + 1) when z1→-∞
    const expLo = Math.exp(-muMax);
    const Z2 = 1 + expLo + 1;
    expect(mMinus[1]).toBeCloseTo(expLo / Z2, 9);
  });

  it('round-trips through logitsFromMasses for non-saturated points', () => {
    for (const z1 of [-1, -0.3, 0, 0.7, 2]) {
      for (const z2 of [-2, 0, 1.5]) {
        const m = massFromLogits(z1, z2, 100);   // muMax large -> tanh ≈ identity
        const { mu1, mu2 } = logitsFromMasses(m);
        // At muMax=100, tanh(z) ≈ z for our z values; mu_k ≈ 100*tanh(z_k) ≈ ...
        // So we round-trip mu, not z. Just check that re-decoding gives the
        // same masses.
        const m2 = massFromLogits(Math.atanh(mu1/100), Math.atanh(mu2/100), 100);
        for (let i = 0; i < 3; i++) expect(m2[i]).toBeCloseTo(m[i], 9);
      }
    }
  });
});

describe('massFromSimplex (direct parameterisation)', () => {
  it('hits the simplex interior for all (t1, t2) ∈ [0,1]²', () => {
    for (let t1 = 0.05; t1 < 1; t1 += 0.1) {
      for (let t2 = 0.05; t2 < 1; t2 += 0.1) {
        const m = massFromSimplex(t1, t2);
        expect(m[0] + m[1] + m[2]).toBeCloseTo(1, 12);
        expect(m[0]).toBeGreaterThan(0);
        expect(m[1]).toBeGreaterThan(0);
        expect(m[2]).toBeGreaterThan(0);
      }
    }
  });

  it('reaches the corners under x = t1, y = (1-t1)·t2', () => {
    // (0,0): x=0, y=0  -> [1, 0, 0]
    expect(massFromSimplex(0, 0)).toEqual([1, 0, 0]);
    // (1,0): x=1, y=0  -> [0, 1, 0]
    expect(massFromSimplex(1, 0)).toEqual([0, 1, 0]);
    // (0,1): x=0, y=1  -> [0, 0, 1]
    expect(massFromSimplex(0, 1)).toEqual([0, 0, 1]);
    // (1,1): x=1, y=0  -> [0, 1, 0]
    expect(massFromSimplex(1, 1)).toEqual([0, 1, 0]);
  });
});
```

### `test/unit/math/rotate.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { rotation, applyR, reflectX } from '@/math/rotate.js';
import { norm2 } from '@/math/vec.js';

describe('rotation', () => {
  it('preserves length', () => {
    const v = [3, 4] as const;
    for (const theta of [0, 0.1, 1, Math.PI/2, Math.PI, 2*Math.PI - 1e-9]) {
      const Rv = applyR(rotation(theta), v);
      expect(norm2(Rv)).toBeCloseTo(5, 12);
    }
  });

  it('R(π/2) maps (1,0) to (0,1)', () => {
    const Rv = applyR(rotation(Math.PI/2), [1, 0]);
    expect(Rv[0]).toBeCloseTo(0, 14);
    expect(Rv[1]).toBeCloseTo(1, 14);
  });

  it('R(-θ) ∘ R(θ) = identity', () => {
    const v = [0.7, -1.3] as const;
    const out = applyR(rotation(-0.4), applyR(rotation(0.4), v));
    expect(out[0]).toBeCloseTo(v[0], 12);
    expect(out[1]).toBeCloseTo(v[1], 12);
  });
});

describe('reflectX', () => {
  it('flips the y component', () => {
    expect(reflectX([2, -3])).toEqual([2, 3]);
  });
  it('is involutive', () => {
    const v = [1.7, -0.4] as const;
    expect(reflectX(reflectX(v))).toEqual(v);
  });
});
```

## Run it

```bash
npm install
npm run typecheck
npm test -- --run
```

Expected: 30+ tests pass across the four math suites.

## Acceptance check

```bash
npm test -- --run test/unit/math
```

If that exit-codes 0, M0 is done. Move on to M1.
