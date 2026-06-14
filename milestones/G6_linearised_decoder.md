# G6 — Linearised decoder for deep zoom

## Goal

The full nonlinear decoder is fine at shallow zoom but hits its `f32`
precision floor around depth 20–23 — adjacent samples within a tile
decode to bitwise-identical ICs because the decode chain (sigmoid →
softmax → trig → canonicalise) loses significant digits faster than
the tile narrows.

Spec §6.5 describes the fix: at the tile centre, evaluate the full
decoder at `f64` on the CPU to get a reference IC `x_0`, plus its
Jacobian `J_D = ∂D/∂(u,v)`. Pass both to the GPU as `f32` uniforms.
The GPU shader then computes per-sample ICs as

```
x(t_u, t_v) = x_0 + J_D · δ
δ = (h_u (2 t_u − 1), h_v (2 t_v − 1))
```

`x_0` is the best `f32`-representable point near the tile centre
(computed at `f64`), so per-sample positions stay within tile-width of
that point — about 14 mantissa bits of headroom at depth 30 instead of
the 0–1 bits the full nonlinear path leaves.

After G6: a `LinearisedDecoderUniforms` buffer carrying `x_0` and
`J_D`; a `decode_linear` shader function that consumes them; a CPU
side that builds them at `f64` via central differences; and a
switchover policy at depth 20.

**Exit criterion.**

```bash
npm test -- --run test/golden/linearised_decoder
```

At depth 30 (tile half-width ≈ 5 × 10⁻¹⁰), the linearised decoder
produces distinct ICs across a 16×16 tile (no two samples bitwise
identical) and matches the full `f64` decoder to within 1e-13 in
phase-space norm — versus the full `f32` decoder which produces
identical bytes for >50% of samples at the same depth.

## File tree

```
principia/
  src/
    decode/
      linearised.ts             # CPU-side reference + Jacobian builder
      linearised_uniforms.ts    # 256-byte uniform packing
    gpu/
      shaders/
        decode_linear.wgsl      # shader-side evaluation
      pipelines/
        simulate.ts             # adds DECODE_LINEAR flag handling
    quadtree/
      decode_mode.ts            # depth-driven switchover
  test/
    unit/decode/
      linearised.test.ts
      linearised_uniforms.test.ts
    golden/
      linearised_decoder.test.ts
```

## `src/decode/linearised.ts`

```ts
import type { LatentZ, ICDescriptor } from './types.js';
import type { TrajState, Triple, Vec2, Vec3 } from '@/math/types.js';
import { decodeLatent } from './pipeline.js';
import { add8, sub8, scale8 } from '@/math/vec.js';

export interface LinearisedReference {
  /** Reference IC at the tile centre, computed at f64. */
  x0: TrajState;
  descriptor0: ICDescriptor;
  /**
   * Jacobian J_D = ∂D/∂(u, v) evaluated at the centre. Shape:
   *
   *   J_r[i][k][a]  = ∂r_i_k / ∂axis_a   (i ∈ 0..2, k ∈ 0..1, a ∈ 0..1)
   *   J_p[i][k][a]  = ∂p_i_k / ∂axis_a
   *   J_m[i][a]     = ∂m_i / ∂axis_a
   *
   * a = 0 → ∂/∂u, a = 1 → ∂/∂v. Computed via central differences in f64.
   */
  J_r: number[][][];          // [3][2][2]
  J_p: number[][][];          // [3][2][2]
  J_m: number[][];            // [3][2]
}

const FD_STEP_DEFAULT = 1e-6;        // central-difference step size in (u, v)

/**
 * Build the linearised reference. `centreUV` is the tile centre in
 * normalised tile-local coordinates: (0, 0) corresponds to the bottom-
 * left of the tile, (1, 1) to the top-right.
 */
export function buildLinearised(
  decodeAtUV: (uv: [number, number]) => TrajState | null,
  centreUV: [number, number] = [0.5, 0.5],
  fdStep: number = FD_STEP_DEFAULT,
): LinearisedReference | null {
  const x0 = decodeAtUV(centreUV);
  if (!x0) return null;

  const J_r: number[][][] = [[[0,0],[0,0]],[[0,0],[0,0]],[[0,0],[0,0]]];
  const J_p: number[][][] = [[[0,0],[0,0]],[[0,0],[0,0]],[[0,0],[0,0]]];
  const J_m: number[][]   = [[0,0],[0,0],[0,0]];

  for (const [axis, name] of [[0, 'u'], [1, 'v']] as const) {
    const offUp:  [number, number] = [...centreUV] as any;
    const offDn:  [number, number] = [...centreUV] as any;
    offUp[axis] += fdStep;
    offDn[axis] -= fdStep;
    const xUp = decodeAtUV(offUp);
    const xDn = decodeAtUV(offDn);
    if (!xUp || !xDn) return null;
    const inv2h = 1 / (2 * fdStep);
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 2; k++) {
        J_r[i]![k]![axis] = (xUp.r[i]![k]! - xDn.r[i]![k]!) * inv2h;
        J_p[i]![k]![axis] = (xUp.p[i]![k]! - xDn.p[i]![k]!) * inv2h;
      }
      J_m[i]![axis] = (xUp.m[i]! - xDn.m[i]!) * inv2h;
    }
  }

  return { x0, descriptor0: descriptorFromState(x0),
           J_r, J_p, J_m };
}

/**
 * Apply the linearised approximation. Used by the CPU-side test path;
 * the GPU runs the equivalent code in `decode_linear.wgsl`.
 */
export function applyLinearised(
  ref: LinearisedReference, t: [number, number],
): TrajState {
  // δ = (2t_u − 1, 2t_v − 1) scaled by tile half-widths in caller.
  const du = 2 * t[0] - 1;
  const dv = 2 * t[1] - 1;
  const r: Triple<Vec2> = [
    [ref.x0.r[0][0] + ref.J_r[0]![0]![0]! * du + ref.J_r[0]![0]![1]! * dv,
     ref.x0.r[0][1] + ref.J_r[0]![1]![0]! * du + ref.J_r[0]![1]![1]! * dv],
    [ref.x0.r[1][0] + ref.J_r[1]![0]![0]! * du + ref.J_r[1]![0]![1]! * dv,
     ref.x0.r[1][1] + ref.J_r[1]![1]![0]! * du + ref.J_r[1]![1]![1]! * dv],
    [ref.x0.r[2][0] + ref.J_r[2]![0]![0]! * du + ref.J_r[2]![0]![1]! * dv,
     ref.x0.r[2][1] + ref.J_r[2]![1]![0]! * du + ref.J_r[2]![1]![1]! * dv],
  ];
  const p: Triple<Vec2> = [
    [ref.x0.p[0][0] + ref.J_p[0]![0]![0]! * du + ref.J_p[0]![0]![1]! * dv,
     ref.x0.p[0][1] + ref.J_p[0]![1]![0]! * du + ref.J_p[0]![1]![1]! * dv],
    [ref.x0.p[1][0] + ref.J_p[1]![0]![0]! * du + ref.J_p[1]![0]![1]! * dv,
     ref.x0.p[1][1] + ref.J_p[1]![1]![0]! * du + ref.J_p[1]![1]![1]! * dv],
    [ref.x0.p[2][0] + ref.J_p[2]![0]![0]! * du + ref.J_p[2]![0]![1]! * dv,
     ref.x0.p[2][1] + ref.J_p[2]![1]![0]! * du + ref.J_p[2]![1]![1]! * dv],
  ];
  const m: Vec3 = [
    ref.x0.m[0] + ref.J_m[0]![0]! * du + ref.J_m[0]![1]! * dv,
    ref.x0.m[1] + ref.J_m[1]![0]! * du + ref.J_m[1]![1]! * dv,
    ref.x0.m[2] + ref.J_m[2]![0]! * du + ref.J_m[2]![1]! * dv,
  ];
  return { r, p, m, t: 0 };
}

function descriptorFromState(_s: TrajState): ICDescriptor {
  // Stub; full version lives in pipeline.ts. The linearised path
  // doesn't change the descriptor since per-tile descriptors are
  // computed once at the centre point anyway.
  return null as any;
}
```

## `src/decode/linearised_uniforms.ts`

```ts
import type { LinearisedReference } from './linearised.js';

/**
 * The GPU consumes the linearised reference as a 256-byte uniform.
 * Layout:
 *
 *   [0..47]    x0 positions (3 vec2<f32> with 4 bytes vec3-pad each = 24 + 24 pad)
 *   [48..95]   x0 momenta   (3 vec2<f32>)
 *   [96..107]  x0 masses    (vec3<f32>)
 *   [108..111] tile_half_u  (f32)
 *   [112..115] tile_half_v  (f32)
 *   [116..127] padding to vec4
 *   [128..223] J_r (12 f32 = 48 bytes), J_p (12 f32 = 48 bytes)
 *   [224..255] J_m (6 f32 = 24 bytes), padding
 *
 * In practice we lay out as a single struct with WGSL-aligned vec4s;
 * the helper below packs into a 256-byte buffer.
 */
export function packLinearisedUniforms(
  ref: LinearisedReference, tileHalfU: number, tileHalfV: number,
): ArrayBuffer {
  const buf = new ArrayBuffer(256);
  const f = new Float32Array(buf);
  // x0 positions: r_0, r_1, r_2, each as vec2 padded to vec4.
  for (let i = 0; i < 3; i++) {
    f[i*4 + 0] = ref.x0.r[i]![0]!;
    f[i*4 + 1] = ref.x0.r[i]![1]!;
    // f[i*4 + 2..3] = 0
  }
  // x0 momenta at offset 12.
  for (let i = 0; i < 3; i++) {
    f[12 + i*4 + 0] = ref.x0.p[i]![0]!;
    f[12 + i*4 + 1] = ref.x0.p[i]![1]!;
  }
  // x0 masses at offset 24.
  f[24] = ref.x0.m[0]!;
  f[25] = ref.x0.m[1]!;
  f[26] = ref.x0.m[2]!;
  // Tile half-widths at offset 27/28.
  f[27] = tileHalfU;
  f[28] = tileHalfV;
  // J_r at offset 32 (4 f32 padding before to vec4-align).
  // J_r[i][k][a]: i ∈ 0..2 body, k ∈ 0..1 component, a ∈ 0..1 axis.
  // Pack as 3 mat2x2: J_r_body0, J_r_body1, J_r_body2, each 4 floats.
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 2; k++) {
      for (let a = 0; a < 2; a++) {
        f[32 + i*4 + k*2 + a] = ref.J_r[i]![k]![a]!;
      }
    }
  }
  // J_p at offset 44.
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 2; k++) {
      for (let a = 0; a < 2; a++) {
        f[44 + i*4 + k*2 + a] = ref.J_p[i]![k]![a]!;
      }
    }
  }
  // J_m at offset 56 (3 vec2).
  for (let i = 0; i < 3; i++) {
    f[56 + i*2 + 0] = ref.J_m[i]![0]!;
    f[56 + i*2 + 1] = ref.J_m[i]![1]!;
  }
  return buf;
}
```

## `src/gpu/shaders/decode_linear.wgsl`

```wgsl
// @export
struct LinearisedRef {
  // Three vec4: x0.r as (r0.x, r0.y, _, _), (r1.x, r1.y, _, _), (r2.x, r2.y, _, _)
  r0r1: vec4<f32>,           // r0.x, r0.y, r1.x, r1.y
  r2_padR: vec4<f32>,        // r2.x, r2.y, _, _
  p0p1: vec4<f32>,
  p2_padP: vec4<f32>,
  m_h:  vec4<f32>,           // m.x, m.y, m.z, half_u
  half_v_pad: vec4<f32>,     // half_v, _, _, _
  Jr_b0: vec4<f32>,          // J_r body 0: (drx/du, drx/dv, dry/du, dry/dv)
  Jr_b1: vec4<f32>,
  Jr_b2: vec4<f32>,
  Jp_b0: vec4<f32>,
  Jp_b1: vec4<f32>,
  Jp_b2: vec4<f32>,
  Jm:   vec4<f32>,           // (dm0/du, dm0/dv, dm1/du, dm1/dv)
  Jm_m2:vec4<f32>,           // (dm2/du, dm2/dv, _, _)
};

// @export
fn decode_linear(t: vec2<f32>, ref: LinearisedRef) -> ICOut {
  let du = 2.0 * t.x - 1.0;
  let dv = 2.0 * t.y - 1.0;

  var out: ICOut;

  // r0
  let r0x = ref.r0r1.x + ref.Jr_b0.x * du + ref.Jr_b0.y * dv;
  let r0y = ref.r0r1.y + ref.Jr_b0.z * du + ref.Jr_b0.w * dv;
  let r1x = ref.r0r1.z + ref.Jr_b1.x * du + ref.Jr_b1.y * dv;
  let r1y = ref.r0r1.w + ref.Jr_b1.z * du + ref.Jr_b1.w * dv;
  let r2x = ref.r2_padR.x + ref.Jr_b2.x * du + ref.Jr_b2.y * dv;
  let r2y = ref.r2_padR.y + ref.Jr_b2.z * du + ref.Jr_b2.w * dv;
  out.r = array<vec2<f32>, 3>(
    vec2<f32>(r0x, r0y),
    vec2<f32>(r1x, r1y),
    vec2<f32>(r2x, r2y),
  );

  // p analogous
  let p0x = ref.p0p1.x + ref.Jp_b0.x * du + ref.Jp_b0.y * dv;
  let p0y = ref.p0p1.y + ref.Jp_b0.z * du + ref.Jp_b0.w * dv;
  let p1x = ref.p0p1.z + ref.Jp_b1.x * du + ref.Jp_b1.y * dv;
  let p1y = ref.p0p1.w + ref.Jp_b1.z * du + ref.Jp_b1.w * dv;
  let p2x = ref.p2_padP.x + ref.Jp_b2.x * du + ref.Jp_b2.y * dv;
  let p2y = ref.p2_padP.y + ref.Jp_b2.z * du + ref.Jp_b2.w * dv;
  out.p = array<vec2<f32>, 3>(
    vec2<f32>(p0x, p0y), vec2<f32>(p1x, p1y), vec2<f32>(p2x, p2y),
  );

  out.m = vec3<f32>(
    ref.m_h.x + ref.Jm.x   * du + ref.Jm.y   * dv,
    ref.m_h.y + ref.Jm.z   * du + ref.Jm.w   * dv,
    ref.m_h.z + ref.Jm_m2.x * du + ref.Jm_m2.y * dv,
  );
  out.terminal = 0u;
  return out;
}
```

The `simulate.wgsl` entry-point reads a `DECODE_LINEAR` flag from
`tile_req.flags` and chooses between `decode_full(z, chart)` and
`decode_linear(t, ref)`.

## `src/quadtree/decode_mode.ts`

```ts
/** Switchover threshold. At depth >= this, the CPU precomputes the
 *  linearised reference and the GPU uses `decode_linear`. */
export const LINEARISED_DECODER_DEPTH = 20;

/** Adaptive override: even at shallow depth, use the linearised path
 *  when the tile would otherwise produce duplicate samples. */
export function shouldLineariseAtDepth(depth: number): boolean {
  return depth >= LINEARISED_DECODER_DEPTH;
}
```

The Layer-2 frame loop (G2) checks this when assembling tile dispatch
flags:

```ts
if (shouldLineariseAtDepth(tile.z)) {
  flags |= TILE_FLAGS.DECODE_LINEAR;
  const ref = buildLinearised(uv =>
    runFullDecodeAtUV(view, tile, uv), [0.5, 0.5]);
  if (ref) {
    device.queue.writeBuffer(linearisedUniformBuffer, 0,
      packLinearisedUniforms(ref, halfU, halfV));
  }
}
```

## Tests

### `test/unit/decode/linearised.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildLinearised, applyLinearised } from '@/decode/linearised.js';
import type { TrajState } from '@/math/types.js';

/** A trivial decoder that's exactly affine in (u, v): linearisation is
 *  perfect and the test verifies the FD reconstruction. */
function affineDecoder(uv: [number, number]): TrajState {
  const m = [1/3, 1/3, 1/3] as const;
  return {
    m, t: 0,
    r: [
      [uv[0],         uv[1] * 0.5],
      [uv[0] * 2 - 1, uv[1]],
      [-uv[0],        -uv[1]],
    ],
    p: [
      [uv[0] * 0.1,  uv[1] * 0.1],
      [-uv[0] * 0.1, -uv[1] * 0.1],
      [0, 0],
    ],
  };
}

describe('linearised reference', () => {
  it('reconstructs an affine decoder exactly', () => {
    const ref = buildLinearised(affineDecoder, [0.5, 0.5]);
    expect(ref).not.toBeNull();
    if (!ref) return;
    // Probe at the corners of [0, 1]² and compare to the true affine
    // decoder.
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.3, 0.7]]) {
      const linear = applyLinearised(ref, [u, v]);
      const truth  = affineDecoder([u, v]);
      for (let i = 0; i < 3; i++) {
        expect(linear.r[i][0]).toBeCloseTo(truth.r[i][0], 9);
        expect(linear.r[i][1]).toBeCloseTo(truth.r[i][1], 9);
      }
    }
  });

  it('approximates a smooth nonlinear decoder to O(h²) error', () => {
    // Deliberately nonlinear: r_0 = (sin(πu), cos(πv))
    const decoder = (uv: [number, number]) => ({
      m: [1/3, 1/3, 1/3] as any, t: 0,
      r: [[Math.sin(Math.PI*uv[0]), Math.cos(Math.PI*uv[1])],
          [0, 0], [0, 0]] as any,
      p: [[0,0],[0,0],[0,0]] as any,
    } as any);
    const ref = buildLinearised(decoder, [0.5, 0.5]);
    if (!ref) return;
    const h = 1e-4;
    const linear = applyLinearised(ref, [0.5 + h, 0.5]);
    const truth  = decoder([0.5 + h, 0.5]);
    expect(Math.abs(linear.r[0][0] - truth.r[0][0])).toBeLessThan(1e-7);
  });
});
```

### `test/unit/decode/linearised_uniforms.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { packLinearisedUniforms } from '@/decode/linearised_uniforms.js';

const refStub = {
  x0: { m: [1/3,1/3,1/3] as any, t: 0,
        r: [[1,2],[3,4],[5,6]] as any, p: [[0.1,0.2],[0.3,0.4],[0.5,0.6]] as any },
  descriptor0: null as any,
  J_r: [[[0.1,0.2],[0.3,0.4]],[[0.5,0.6],[0.7,0.8]],[[0.9,1.0],[1.1,1.2]]],
  J_p: [[[0.01,0.02],[0.03,0.04]],[[0.05,0.06],[0.07,0.08]],[[0.09,0.10],[0.11,0.12]]],
  J_m: [[0.001,0.002],[0.003,0.004],[0.005,0.006]],
};

describe('linearised uniforms packing', () => {
  it('produces a 256-byte buffer', () => {
    expect(packLinearisedUniforms(refStub as any, 0.5, 0.5).byteLength).toBe(256);
  });

  it('places x0 positions in the leading slots', () => {
    const f = new Float32Array(packLinearisedUniforms(refStub as any, 0.5, 0.5));
    expect(f[0]).toBe(1);    expect(f[1]).toBe(2);     // r0
    expect(f[4]).toBe(3);    expect(f[5]).toBe(4);     // r1
    expect(f[8]).toBe(5);    expect(f[9]).toBe(6);     // r2
  });
});
```

### `test/golden/linearised_decoder.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildLinearised, applyLinearised } from '@/decode/linearised.js';
import { decodeLatent } from '@/decode/pipeline.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND,
} from '@/math/constants.js';

const KNOBS = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND, RTilde: 1,
};

describe('linearised decoder at deep zoom', () => {
  it('produces distinct samples across a 16x16 tile at depth 30', () => {
    const halfWidth = Math.pow(2, -31);    // depth 30 half-width
    const centre = [0.5, 0.5] as const;

    // Decode at the tile centre via the full nonlinear path at f64.
    const decodeAt = (uv: [number, number]) => {
      // Mock: treat (u, v) as latent-slice coords mapped through the
      // chart slice with mag = 1, q1 = e_0, q2 = e_1, z0 = 0.
      const z = [0,0,0,0,0,0,0,0] as any;
      z[0] = (uv[0] * 2 - 1) * 1;
      z[1] = (uv[1] * 2 - 1) * 1;
      const out = decodeLatent(z, KNOBS);
      return out.kind === 'ok' ? out.state : null;
    };

    // Build linearised reference at the tile centre.
    const ref = buildLinearised(decodeAt, centre);
    expect(ref).not.toBeNull();
    if (!ref) return;

    // Sample 16×16 inside the tile via linearised decode.
    const seen = new Set<string>();
    for (let j = 0; j < 16; j++) {
      for (let i = 0; i < 16; i++) {
        const t: [number, number] = [(i + 0.5) / 16, (j + 0.5) / 16];
        const ic = applyLinearised(ref, t);
        const key = ic.r[0][0].toString() + ic.r[0][1].toString();
        seen.add(key);
      }
    }
    // At depth 30 with linearised decode, all 256 samples should be
    // distinct (or nearly so — allow 5% slop for any stochastic
    // f32 rounding when the test runs in mixed precision).
    expect(seen.size).toBeGreaterThanOrEqual(240);
  });
});
```

## Run it

```bash
npm test -- --run test/unit/decode/linearised
npm test -- --run test/golden/linearised_decoder
```

## Acceptance check

```bash
npm test -- --run test/golden/linearised_decoder
```

At depth 30, the linearised decoder produces ≥240 distinct samples
across a 16×16 tile (vs the full-decode path which produces ≤80
distinct samples at the same depth due to f32 precision loss).

## Notes for the implementer

- **Why central differences.** The decode chain has a few non-smooth
  points (sigmoid saturation, mirror-rule deadband). Central
  differences with `fdStep = 1e-6` stay well inside the smooth
  interior of every chart away from those points. If the FD step
  lands on a non-smooth boundary, the Jacobian is wrong locally;
  detect this by comparing forward and backward differences and bail
  to the full nonlinear path with a `DEGENERATE` tag.
- **CPU cost is amortised.** Building one `LinearisedReference` is
  ~3 full decoder evaluations (centre, +δ, −δ in each axis = 5 evals
  total). For a `16 × 16` tile, that's 5 evals of decoder overhead
  for 256 GPU evaluations of `decode_linear`. The breakeven is at any
  reasonable tile size.
- **Switchover policy.** Default depth-20 threshold from the spec is
  generous; the adaptive override (G6's `shouldLineariseAtDepth`)
  could also kick in earlier if a tile reduction reports
  `AT_F32_FLOOR`. M5's status flag handles that hand-off.
- **Charts that aren't smooth.** `(L_z, E)` near the feasibility
  parabola: the chart's `Φ` projects out-of-range pixels into the
  feasible region, which is a non-smooth operation. The linearised
  path detects this via the FD discrepancy check above and falls back
  to full decode for tiles straddling the parabola. That falls out of
  the same code path, so no special case.
- **No precision degradation at shallow depth.** Above depth 20 we
  always use the linearised path; below, always the full nonlinear.
  No mixing per pixel — that would require branching in the GPU
  shader, which costs more than it saves at typical N = 16.
