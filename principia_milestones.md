# Principia — implementation milestones

A step-by-step build plan derived from `principia_spec_revised.tex`. Each
milestone is sized to land in roughly a working week, has a single exit
criterion, and composes cleanly with the milestones before it. The order is
load-bearing: later milestones rely on data contracts established earlier.

## Conventions used throughout

- **Language assumption.** TypeScript for the host (browser main thread, scheduler,
  cache, UI), WGSL for the GPU compute and fragment shaders, and a pure-Python or
  pure-TS reference implementation for the CPU validator (whichever you prefer to
  test against; pseudocode below uses TS-style syntax for both).
- **Filesystem layout.** A reasonable target is:

  ```
  src/
    math/            # vectors, matrices, sigmoid/softmax/atan2 helpers
    decode/          # mass, configuration, momentum decoders + canonicaliser
    integrate/       # KDK / Yoshida4 / Yoshida6 / RK45
    metrics/         # shape sphere, diffusion, FTLE, free-group word
    chart/           # latent slice, (Lz,E), (Lz,K), shape sphere, mass simplex, burrau, mixed
    gpu/             # WebGPU init, bind groups, buffer pools, dispatch
      shaders/       # WGSL: simulate.wgsl, reduce.wgsl, render.wgsl, helpers.wgsl
    quadtree/        # tile, lifecycle, priority queue, eviction
    cache/           # TileCacheKey, payload versioning, invalidation
    render/          # colour nodes, brightness nodes, combiner, post
    interact/        # microscope, lock, lookup, tilt, named directions
    inspector/       # CPU f64 RK45, overlay
    chart_atlas/     # registry, validation, compatibility flags
    burrau/          # Euclid family, Pythagorean triples, charts
    export/          # static, animated, live, data API
    validation/      # acceptance gates, golden references
  test/
    unit/
    golden/          # known-input/known-output regression
    integration/     # end-to-end pixel pipeline
    perf/            # microbenchmarks, frame-rate gates
  ```

- **Test taxonomy.**
  - **Unit:** one function, no side effects (math identities, sigmoid round-trip).
  - **Golden:** known input → known output, byte- or float-exact (Burrau rest start
    after T=80 in dimensionless units, primitive Pythagorean triple shapes).
  - **Integration:** one tile dispatched end-to-end through GPU and reduction,
    compared against CPU reference at f64.
  - **Performance:** wall-clock budget gates (60fps interactive, 8ms hover-streamline
    cap, etc.). Measured but not always hard-failed.
  - **Acceptance:** the spec's architectural validation checklist
    (§7 of the spec) — checked at the end of each milestone.

- **Pseudocode conventions.** `f64`/`f32` make precision explicit. Mass-weighted
  inner product is `<a, b>_m = Σᵢ mᵢ aᵢ·bᵢ`. The 90° rotation in the plane is
  `J(x, y) = (-y, x)`. Indices `i, j, k ∈ {0, 1, 2}` for bodies (0-indexed throughout
  except inside the Burrau classical-notation section).

- **Per-milestone exit criterion.** Each milestone has a single, executable
  acceptance test. If that test passes, the milestone is done. Pass-through tests
  (cosmetic, perf) are recorded but don't gate the gate.

---

## M0 — Project skeleton, math primitives, CI gate

**Why first.** Before any physics: a working build, a test runner, and the
primitive types every later milestone consumes. A botched precision policy at
M0 will manifest as drift in M3 that's annoying to debug.

**Scope.**
- Toolchain: TypeScript, Vitest (or Jest), a WebGPU-capable test environment
  (Playwright + Chrome) plus a headless CPU-only path for unit tests that don't
  need GPU.
- Math primitives: 2-vec, 3-vec, 4-vec, 8-vec; 2x2 and 3x3 matrices; planar cross
  product `(a × b)_z`; sigmoid, softmax with reference logit, atan2, smoothstep,
  clamp.
- Float types: thin wrappers `F64` and `F32` purely for documentation (no runtime
  cost, but readers can grep for them).
- Constants and unit conventions: `G = 1`, `M_total = 1`, `I = 1`.
- CI gate: lint + typecheck + unit tests on every push.

**Pseudocode.**

```ts
// src/math/vec.ts
export type Vec2  = readonly [number, number];
export type Vec3  = readonly [number, number, number];
export type Vec8  = readonly [number, number, number, number,
                              number, number, number, number];

export function dot2(a: Vec2, b: Vec2): number { return a[0]*b[0] + a[1]*b[1]; }
export function crossZ(a: Vec2, b: Vec2): number { return a[0]*b[1] - a[1]*b[0]; }
export function J(v: Vec2): Vec2 { return [-v[1], v[0]]; }       // 90° rotation
export function norm2(a: Vec2): number { return Math.hypot(a[0], a[1]); }

export function sigmoid(z: number): number { return 1 / (1 + Math.exp(-z)); }
export function logit(s: number): number { return Math.log(s / (1 - s)); }

// Mass-weighted inner product over three bodies in the plane.
export function dotM(
  m: Vec3, a: readonly [Vec2, Vec2, Vec2], b: readonly [Vec2, Vec2, Vec2],
): number {
  return m[0]*dot2(a[0], b[0]) + m[1]*dot2(a[1], b[1]) + m[2]*dot2(a[2], b[2]);
}
```

```ts
// src/math/softmax.ts — reference-logit softmax with saturation
export function massFromLogits(z1: number, z2: number, muMax: number): Vec3 {
  const mu1 = muMax * Math.tanh(z1);
  const mu2 = muMax * Math.tanh(z2);
  const e0 = 1, e1 = Math.exp(mu1), e2 = Math.exp(mu2);
  const Z = e0 + e1 + e2;
  return [e0/Z, e1/Z, e2/Z];
}
```

**Tests.**

| ID | Type | Description |
|----|------|-------------|
| M0.U1 | unit | `dot2`, `crossZ`, `J(J(v)) = -v` |
| M0.U2 | unit | `sigmoid(logit(s)) ≈ s` for `s ∈ (0,1)`, error < 1e-12 |
| M0.U3 | unit | `massFromLogits(0,0,5)` = `(1/3, 1/3, 1/3)` (equal masses) |
| M0.U4 | unit | `massFromLogits(z, 0, 5)` saturates at `(0, 1, 0)` as `z → ∞` |
| M0.U5 | unit | for any `(z1, z2)`, `m0 + m1 + m2 = 1` to within 1e-15 |

**Exit criterion.** `npm run test` and `npm run lint` both pass; CI is green on
a fresh clone.

---

## M1 — CPU reference integrator (single trajectory, f64)

**Why next.** The CPU integrator is the ground truth that every later GPU
result is checked against. It also unblocks the locked-pixel inspector (M9)
without waiting for the WebGPU stack.

**Scope.**
- Pairwise gravitational force evaluator.
- KDK leapfrog macro-step with adaptive substepping (`r_min` driven).
- Optional Yoshida-4 and Yoshida-6 compositions (drop-in: the same KDK call
  with weighted step sizes).
- Per-macro-step COM projection (§4.1.5 in the spec).
- Energy and `L_z` invariant tracking.
- Terminal-event detection: collision (`r_min < r_coll`), escape (three-gate
  persistence counter, §4.2), timeout, NaN/Inf.
- Ground-truth golden trajectory: the classical Burrau 3-4-5 rest start at
  `T = 80` in dimensionless units.

**Pseudocode.**

```ts
// src/integrate/forces.ts
export function forces(
  m: Vec3, r: readonly [Vec2, Vec2, Vec2],
): readonly [Vec2, Vec2, Vec2] {
  const F: [Vec2, Vec2, Vec2] = [[0,0], [0,0], [0,0]];
  for (let i = 0; i < 3; i++) {
    for (let j = i+1; j < 3; j++) {
      const dx = r[j][0] - r[i][0], dy = r[j][1] - r[i][1];
      const r2 = dx*dx + dy*dy;
      const r3 = r2 * Math.sqrt(r2);
      const f  = m[i] * m[j] / r3;        // G = 1
      F[i] = [F[i][0] + f*dx, F[i][1] + f*dy];
      F[j] = [F[j][0] - f*dx, F[j][1] - f*dy];
    }
  }
  return F;
}
```

```ts
// src/integrate/kdk.ts — single macro step with adaptive substepping
export function kdkMacroStep(
  state: TrajState, dtMacro: number, params: SubstepParams,
): TrajState {
  const rMin = minPairSeparation(state.r);
  const Nsub = Math.min(
    params.NMax,
    Math.max(1, Math.ceil((params.rSub / rMin) ** params.gammaSub)),
  );
  const dt = dtMacro / Nsub;

  let { r, p, m } = state;
  for (let s = 0; s < Nsub; s++) {
    let F = forces(m, r);
    p = kick(p, F, dt/2);
    r = drift(r, p, m, dt);
    F = forces(m, r);
    p = kick(p, F, dt/2);
  }
  // COM projection runs once per macro step, not per substep.
  const projected = projectCOM(r, p, m);
  return { r: projected.r, p: projected.p, m, t: state.t + dtMacro };
}
```

```ts
// src/integrate/escape.ts — three-gate persistence detector
export function tickEscapeGates(
  s: TrajState, ctr: EscapeCounter, params: EscapeParams,
): EscapeStatus {
  for (const k of [0, 1, 2]) {
    const [i, j] = otherPair(k);                      // the inner pair
    const lambda = outerJacobi(s.r, s.m, k);
    const vLambda = outerJacobiVel(s.r, s.p, s.m, k);
    const muOut  = s.m[k] * (s.m[i] + s.m[j]);
    const Eout = (norm2(scale(vLambda, muOut))**2)/(2*muOut)
               - (s.m[k]*(s.m[i]+s.m[j])) / norm2(lambda);
    const distGate    = norm2(lambda) > params.Resc;
    const outwardGate = dot2(lambda, vLambda) > 0;
    const energyGate  = Eout > 0;
    const allOn = distGate && outwardGate && energyGate;
    ctr[k] = allOn ? Math.min(ctr[k] + 1, params.kEsc)
                   : Math.max(ctr[k] - 1, 0);
    if (ctr[k] >= params.kEsc) return { kind: 'escape', body: k };
  }
  return { kind: 'continue' };
}
```

**Tests.**

| ID | Type | Description |
|----|------|-------------|
| M1.U1 | unit | Two-body Kepler closed orbit: energy conserved to `1e-8` over `T=100` at `dt=1e-3` (tighter than the f32 acceptance budget) |
| M1.G1 | golden | Burrau 3-4-5 rest start: position of body 0 at `t = 60` matches reference to 6 decimals |
| M1.G2 | golden | Burrau 3-4-5: escape body identity at `t = T_esc` matches the literature (body 1 escapes; bodies 0 and 2 form the binary) |
| M1.U2 | unit | Three identical bodies on a Lagrange equilateral with rotation give a closed 1-period orbit; energy drift `< 1e-9` |
| M1.U3 | unit | `tickEscapeGates` returns `escape` only after `kEsc` consecutive frames with all gates on |
| M1.U4 | unit | COM projection is idempotent: `projectCOM(projectCOM(s)) === projectCOM(s)` to f64 precision |

**Exit criterion.** `M1.G1` and `M1.G2` both pass; energy drift on the Burrau
golden run stays below `1e-7` over `T = 80`. (No GPU yet.)

---

## M2 — Decoder atlas, canonicaliser, inverse paths

**Why next.** Every chart in the rest of the system funnels through one
decoder, one canonicaliser, and one inverse encoder. Establishing this contract
before the GPU stack means the GPU shader will be chart-agnostic from day one.

**Scope.**
- Mass decode: softmax with logit saturation (default chart) + direct-simplex
  alternative for the ternary mass chart.
- Configuration decode: hyperspherical mass-weighted Jacobi
  (canonical-frame variant). The corrected formula from `principia_spec_revisions.md`
  applies — verify against landmark positions in M6.
- Momentum decode: free Jacobi 4-DOF.
- Canonicaliser: rotation gauge, dead-banded mirror rule, scale gauge, no-holes
  enforcement (`DEGENERATE` and `COLLISION_T0` terminal labels).
- Inverse paths for lookup: mass, configuration, free-momentum, with clamping.

**Pseudocode.**

```ts
// src/decode/configuration.ts
export interface ConfigDecodeOut {
  rho_tilde: Vec2; lambda_tilde: Vec2;     // mass-weighted Jacobi
  alpha: number;   beta: number;
}

export function decodeConfigCanonical(
  zAlpha: number, zBeta: number, alphaMin: number,
): ConfigDecodeOut {
  const alpha = alphaMin + (Math.PI/2 - 2*alphaMin) * sigmoid(zAlpha);
  const beta  = Math.PI * sigmoid(zBeta);             // [0, π]
  // R_tilde = 1 (scale gauge)
  return {
    rho_tilde:    [Math.cos(alpha), 0],
    lambda_tilde: [Math.sin(alpha) * Math.cos(beta),
                   Math.sin(alpha) * Math.sin(beta)],
    alpha, beta,
  };
}
```

```ts
// src/decode/jacobi_to_particle.ts
export function jacobiToParticle(
  rho: Vec2, lambda: Vec2, m: Vec3,
): readonly [Vec2, Vec2, Vec2] {
  const M01 = m[0] + m[1];
  const r01 = scale(lambda, -m[2]);                   // -m_2 λ
  const r2  = scale(lambda, M01);
  const r0  = sub(r01, scale(rho, m[1]/M01));
  const r1  = add(r01, scale(rho, m[0]/M01));
  return [r0, r1, r2];
}
```

```ts
// src/decode/momentum_free.ts
export function decodeFreeJacobiMomenta(
  zq: readonly [number, number, number, number], qMax: number,
): { pRho: Vec2; pLambda: Vec2 } {
  const q = zq.map(z => qMax * (2*sigmoid(z) - 1));
  return { pRho: [q[0], q[1]], pLambda: [q[2], q[3]] };
}

export function jacobiMomentumToParticle(
  pRho: Vec2, pLambda: Vec2, m: Vec3,
): readonly [Vec2, Vec2, Vec2] {
  const M01 = m[0] + m[1];
  const p0 = sub(neg(pRho), scale(pLambda, m[0]/M01));
  const p1 = sub(pRho,       scale(pLambda, m[1]/M01));
  const p2 = pLambda;
  return [p0, p1, p2];
}
```

```ts
// src/decode/canonicalise.ts
export function canonicalise(
  r: readonly [Vec2, Vec2, Vec2], p: readonly [Vec2, Vec2, Vec2],
  m: Vec3, opts: { deltaLambda: number; rColl: number },
): { state: TrajState; terminal?: TerminalLabel } {
  // 1. translate to COM (already in COM frame after Jacobi reconstruction,
  //    but reapply at f64 precision to absorb round-off)
  const [rC, pC] = projectCOM(r, p, m);

  // 2. rotation gauge: rotate so rho is on +x. (No-op if canonical-frame decode
  //    was used; do it anyway as a guard for non-canonical entry points.)
  const phi = Math.atan2(rC[1][1] - rC[0][1], rC[1][0] - rC[0][0]);
  const Rmat = rotationMatrix(-phi);
  const rRot = rC.map(v => apply(Rmat, v));
  const pRot = pC.map(v => apply(Rmat, v));

  // 3. dead-banded mirror rule: enforce lambda_y >= 0
  const lambdaY = lambdaFrom(rRot, m)[1];
  const reflect = lambdaY < -opts.deltaLambda;
  const rOut = reflect ? rRot.map(v => [v[0], -v[1]] as Vec2) : rRot;
  const pOut = reflect ? pRot.map(v => [v[0], -v[1]] as Vec2) : pRot;

  // 4. no-holes guard
  const rMin = minPairSeparation(rOut);
  if (rMin < opts.rColl) {
    return { state: { r: rOut, p: pOut, m, t: 0 }, terminal: 'COLLISION_T0' };
  }
  return { state: { r: rOut, p: pOut, m, t: 0 } };
}
```

```ts
// src/decode/inverse.ts — round-trip identity check used by lookup
export function inverseEncode(s: TrajState): { z: Vec8; clamped: boolean } {
  const m = s.m;
  // Mass: μ_k = log(m_k / m_0); clamp to (1-ε)μ_max before artanh.
  const mu1 = clamp(Math.log(m[1]/m[0]), -muMax*(1-εμ),  muMax*(1-εμ));
  const mu2 = clamp(Math.log(m[2]/m[0]), -muMax*(1-εμ),  muMax*(1-εμ));
  const zμ1 = artanh(mu1 / muMax);
  const zμ2 = artanh(mu2 / muMax);
  // Configuration: project to COM, canonicalise, take alpha = atan2(|λ|, |ρ|),
  // beta = atan2(λ_y, λ_x) folded into [0, π].
  const { alpha, beta } = recoverAlphaBeta(s);
  const sα = (alpha - alphaMin) / (Math.PI/2 - 2*alphaMin);
  const sβ = beta / Math.PI;
  const zα = logit(clamp(sα, εz, 1-εz));
  const zβ = logit(clamp(sβ, εz, 1-εz));
  // Momentum: invert the Jacobi map then sigmoid → logit.
  const { pRho, pLambda } = particleToJacobiMomenta(s.p, m);
  const q = [pRho[0], pRho[1], pLambda[0], pLambda[1]];
  const zq = q.map(qk => logit(clamp(0.5*(qk/qMax + 1), εz, 1-εz)));
  return {
    z: [zα, zβ, ...zq, zμ1, zμ2] as Vec8,
    clamped: /* set if any of the above clamp() calls hit a bound */ false,
  };
}
```

**Tests.**

| ID | Type | Description |
|----|------|-------------|
| M2.U1 | unit | `decodeConfigCanonical(0, 0)` gives `α = π/4`, `β = π/2` (the centre of latent space) |
| M2.U2 | unit | Mass round-trip: `inverseEncode(decode(z)).z ≈ z` to 1e-9 across 1000 random points away from saturation |
| M2.U3 | unit | Configuration round-trip: same, on `(zα, zβ)` |
| M2.U4 | unit | Free-momentum round-trip: same, on `(zq0..zq3)` |
| M2.G1 | golden | Decoding at `α = 0` produces `(\|ρ̃\|=1, \|λ̃\|=0)` — body 2 sits at the inner-pair COM |
| M2.G2 | golden | Decoding at `α = π/2` produces `(\|ρ̃\|=0, \|λ̃\|=1)` — bodies 0 and 1 collide |
| M2.U5 | unit | Canonicaliser is idempotent: `canonicalise(canonicalise(s)) === canonicalise(s)` to f64 |
| M2.U6 | unit | If COM offset is added before canonicalise, output is identical (within 1e-13) |
| M2.U7 | unit | Mirror rule is dead-banded: `λ_y = 1e-15` does not flip; `λ_y = -1e-10` does |
| M2.A1 | acceptance | Spec §1.6.7 — every UV pixel emits either a valid IC or a labelled terminal; no rejected pixels |

**Exit criterion.** `M2.A1` passes for the 8D latent chart with `1e6` random
points: zero pixels go unlabelled.

---

## M3 — Layer 0: flat grid GPU dispatch

**Why next.** First end-to-end pass through the GPU. No cache, no quadtree,
no reduction. Pan/zoom recomputes everything. The point is to validate the
data contract (`SimUniforms`, `TileRequest`, `SimResult`) and the
WGSL ↔ TS struct alignment.

**Scope.**
- WebGPU adapter / device init with feature query.
- Bind group layout (groups 0/1, plus group 3 for render uniforms).
- Compute shader: decode → integrate → write `SimResult`.
- Fragment shader: read `SimResult`, colour by event class.
- A single tile fills the viewport. No tiling logic yet.
- Tile-local precision scheme (`uv_centre`, `uv_half`) is wired up even though
  it doesn't matter at depth 0 — establish the contract early.

**Pseudocode.**

```wgsl
// src/gpu/shaders/simulate.wgsl (excerpt)
@group(0) @binding(0) var<uniform> uniforms : SimUniforms;
@group(0) @binding(1) var<uniform> tile_req  : TileRequest;
@group(1) @binding(0) var<storage, read_write> results : array<SimResult>;
@group(1) @binding(1) var<storage, read_write> ics     : array<ICDescriptor>;

@compute @workgroup_size(8, 8, 1)
fn simulate(@builtin(global_invocation_id) gid : vec3<u32>) {
  let N = u32(uniforms.samples_per_axis);
  if (gid.x >= N || gid.y >= N) { return; }
  let idx = gid.y * N + gid.x;

  // Tile-local UV (stays at full f32 precision regardless of zoom depth).
  let t  = (vec2<f32>(f32(gid.x), f32(gid.y)) + 0.5) / f32(N);
  let uv = tile_req.uv_centre + tile_req.uv_half * (2.0 * t - 1.0);

  // Decode through the chart map. Chart selection is via a shader specialisation
  // constant or a switch on tile_req.chart_id; here we assume the slice chart.
  let ic = decode_latent_slice(uv, uniforms);
  if (ic.terminal != TERMINAL_NONE) {
    results[idx] = sim_result_terminal(ic.terminal);
    ics[idx]     = ic.descriptor;
    return;
  }

  // Integrate.
  var st : TrajState = ic.state;
  var sim : SimAccum  = sim_init();
  loop {
    if (st.t >= uniforms.T_horizon) { break; }
    let res = kdk_macro_step(&st, uniforms.dt_macro, uniforms);
    sim_observe(&sim, &st);
    if (res.terminal != TERMINAL_NONE) { break; }
  }

  results[idx] = sim_finalize(&sim, &st);
  ics[idx]     = ic.descriptor;
}
```

```ts
// src/gpu/dispatch_layer0.ts
export async function renderLayer0(view: ViewState, canvas: HTMLCanvasElement) {
  const N = view.samplesPerAxis;       // e.g. 16
  const tileReq = computeTileRequestForViewport(view);    // f64 → f32 packing
  device.queue.writeBuffer(uniformBuffer,    0, packSimUniforms(view));
  device.queue.writeBuffer(tileRequestBuffer, 0, packTileRequest(tileReq));

  const enc = device.createCommandEncoder();
  {
    const pass = enc.beginComputePass();
    pass.setPipeline(simulatePipeline);
    pass.setBindGroup(0, groupZero);
    pass.setBindGroup(1, groupOne);
    pass.dispatchWorkgroups(Math.ceil(N/8), Math.ceil(N/8), 1);
    pass.end();
  }
  {
    const pass = enc.beginRenderPass({ colorAttachments: [/* canvas tex */] });
    pass.setPipeline(renderPipeline);
    pass.setBindGroup(0, groupZero);
    pass.setBindGroup(1, groupOne);
    pass.setBindGroup(3, renderParamsGroup);
    pass.draw(3, 1);                 // single fullscreen triangle
    pass.end();
  }
  device.queue.submit([enc.finish()]);
}
```

**Struct-alignment guard.**

```ts
// test/integration/struct_alignment.test.ts
import { sizeOfSimResult, sizeOfICDescriptor } from '@/gpu/structs';
test('SimResult is 208 bytes at M=8', () => {
  expect(sizeOfSimResult(/* M= */ 8)).toBe(208);
});
test('ICDescriptor is 64 bytes', () => {
  expect(sizeOfICDescriptor()).toBe(64);
});
```

**Tests.**

| ID | Type | Description |
|----|------|-------------|
| M3.U1 | unit | Struct sizes match the spec (208, 64, 272 for `TileReduction` at M=8) |
| M3.U2 | unit | Tile-local UV computation: `uv(0) = uv_min`, `uv(1) = uv_max` to f32 epsilon at depth 0 |
| M3.I1 | integration | One pixel computed on GPU matches CPU reference (M1) to within 1e-3 in shape-sphere position after `T = 50` |
| M3.I2 | integration | Outcome-class agreement: GPU and CPU classify a 16×16 sample of Burrau ICs identically |
| M3.A1 | acceptance | Spec §6 R5: changing palette doesn't trigger a recompute (no compute dispatch fires when the palette uniform changes) |

**Exit criterion.** `M3.I2` passes — at least 256/256 Burrau samples classify
identically between GPU f32 and CPU f64.

---

## M4 — Layer 1: tile cache and ancestor fallback

**Why next.** The slippy-map UX. Once tiles can be cached and parents stretched
over missing children, the screen never blanks during pan or zoom, even before
adaptive refinement is in place.

**Scope.**
- `TileID` and `TileCacheKey` (the latter now includes `quality_tier` per the
  revised spec).
- A simple cache keyed by `TileCacheKey` with FIFO replacement.
- Tile-pyramid math: `(z, t_x, t_y) → uv ∈ [0,1]²`.
- Camera → zoom mapping: `z_base = clamp(⌊log₂(W / (T_pix · Δu_view))⌋, 0, Z_max)`.
- Ancestor walk: if `(z, t_x, t_y)` is missing, walk up to `(z-1, ⌊t_x/2⌋, ⌊t_y/2⌋)`,
  `(z-2, …)`, until a cached tile is found. Draw it stretched.
- Compute queue: simple FIFO, no priority yet.
- Cache invalidation by key change (chart, integrator, horizon, tier).

**Pseudocode.**

```ts
// src/quadtree/tile.ts
export interface TileID { z: number; tx: number; ty: number; }

export function tileBounds(id: TileID): { uMin: number; uMax: number;
                                           vMin: number; vMax: number; } {
  const span = 1 / 2**id.z;
  return {
    uMin: id.tx * span, uMax: (id.tx + 1) * span,
    vMin: id.ty * span, vMax: (id.ty + 1) * span,
  };
}

export function ancestor(id: TileID, levels: number = 1): TileID {
  return { z: id.z - levels,
           tx: id.tx >> levels,
           ty: id.ty >> levels };
}
```

```ts
// src/cache/tile_cache.ts
export class TileCache {
  private map = new Map<string, CachedTile>();
  constructor(private capacity: number) {}

  key(id: TileID, k: TileCacheKey): string {
    // Include every cache-relevant field. Stringify is fine for now;
    // a fixed-width binary hash is a perf optimisation for later.
    return JSON.stringify({ id, k });
  }

  get(id: TileID, k: TileCacheKey): CachedTile | undefined {
    const t = this.map.get(this.key(id, k));
    if (t) t.lastUsed = performance.now();
    return t;
  }

  put(id: TileID, k: TileCacheKey, tile: CachedTile): void {
    if (this.map.size >= this.capacity) this.evictOne();
    this.map.set(this.key(id, k), tile);
  }

  walkAncestors(id: TileID, k: TileCacheKey,
                maxLevels = 6): CachedTile | undefined {
    for (let dz = 1; dz <= maxLevels && id.z - dz >= 0; dz++) {
      const t = this.get(ancestor(id, dz), k);
      if (t) return t;
    }
    return undefined;
  }

  private evictOne(): void {
    // FIFO at this milestone; weighted-LRU lands in M5.
    const oldest = [...this.map.entries()]
      .sort(([,a],[,b]) => a.lastUsed - b.lastUsed)[0];
    if (oldest) this.map.delete(oldest[0]);
  }
}
```

```ts
// src/quadtree/render_pass_layer1.ts
export function frameLayer1(view: ViewState) {
  const visible = collectVisibleTiles(view);            // (z, tx, ty) cover

  for (const id of visible) {
    const tile = cache.get(id, view.cacheKey);
    if (tile) {
      drawTileSharp(tile, id, view);
    } else {
      const ancestor = cache.walkAncestors(id, view.cacheKey);
      if (ancestor) drawTileStretched(ancestor, id, view);   // never blank
      computeQueue.push(id);                                  // FIFO
    }
  }

  drainComputeQueue(maxJobsThisFrame = 4);
}
```

**Tests.**

| ID | Type | Description |
|----|------|-------------|
| M4.U1 | unit | `tileBounds(z=0, tx=0, ty=0)` covers `[0,1]²` exactly |
| M4.U2 | unit | `ancestor((5, 7, 3), 2) === (3, 1, 0)` |
| M4.U3 | unit | Cache key changes when integrator changes; same key when only palette changes |
| M4.I1 | integration | Pan that scrolls 200px right never produces a frame with a `(0,0,0,0)` pixel — ancestor fallback always covers |
| M4.I2 | integration | Zooming in by one level produces a single frame of stretched-parent rendering, then sharpens as children land |
| M4.A1 | acceptance | Spec §6 R3: quadtree usable even with naive FIFO refinement (the cache works without adaptive priority) |

**Exit criterion.** `M4.I1` passes — pan a 1024² viewport across 4 screens of
content; no frame has a blank region.

---

## M5 — Layer 2: GPU reduction + adaptive refinement

**Why next.** The first time scheduler decisions become data-driven. The
reduction pass aggregates `N²` `SimResult` records into a `TileReduction`
that fits in 272 bytes; the CPU reads it back and decides which tiles to
split.

**Scope.**
- `TileReduction` GPU compute pass (one workgroup per tile for modest `N`,
  two-stage block reduction otherwise).
- CPU readback (the only `GPU → CPU` traffic in normal operation).
- Tile lifecycle: `unseen → queued → computing → ready → readyRefinable`.
- Composite coherence score `S_tile` (10 weighted terms, §6.6 of the spec).
- Split / keep / merge decision logic with the level-dependent threshold
  `τ(ℓ) = 0.20 + 0.02 · ℓ`.
- Priority queue: `P = w_v·P_visible + w_z·P_zoom + w_c·P_complexity + w_f·P_focus`.
- Weighted-LRU eviction using `computeCostMs`.
- Cancellation hooks: subsequent passes for tiles that scrolled offscreen
  are skipped.

**Pseudocode.**

```wgsl
// src/gpu/shaders/reduce.wgsl (excerpt, single-workgroup variant)
@group(0) @binding(0) var<uniform> uniforms : SimUniforms;
@group(0) @binding(1) var<uniform> tile_req  : TileRequest;
@group(1) @binding(0) var<storage, read>       results   : array<SimResult>;
@group(2) @binding(0) var<storage, read_write> reduction : TileReduction;

var<workgroup> shared_means   : array<f32, 64>;
var<workgroup> shared_classes : array<u32, 64>;
// ...one shared array per accumulated field

@compute @workgroup_size(64, 1, 1)
fn reduce(@builtin(local_invocation_id) lid : vec3<u32>,
          @builtin(workgroup_id)        wid : vec3<u32>) {
  let lane = lid.x;
  let total = u32(uniforms.samples_per_axis * uniforms.samples_per_axis);

  // Stride-64 load and partial accumulate.
  var local_class_hist : array<u32, 5>;
  var local_arc_sum    : f32 = 0.0;
  var local_arc_max    : f32 = 0.0;
  // ...other accumulators

  var i = lane;
  loop {
    if (i >= total) { break; }
    let r = results[i];
    local_class_hist[(r.sample_descriptor & 0x7u)] += 1u;
    local_arc_sum += r.arc_length_n;
    local_arc_max = max(local_arc_max, r.arc_length_n);
    // ...
    i += 64u;
  }

  // Workgroup-level reduction (binary tree).
  shared_means[lane] = local_arc_sum;
  workgroupBarrier();
  for (var s = 32u; s > 0u; s >>= 1u) {
    if (lane < s) { shared_means[lane] += shared_means[lane + s]; }
    workgroupBarrier();
  }

  if (lane == 0u) {
    reduction.mean_arc_length_n = shared_means[0] / f32(total);
    // ... write all other reduced fields
    reduction.coherence_score   = compute_coherence_score(/* args */);
    reduction.priority_score    = 0.0;     // CPU sets this
  }
}
```

```ts
// src/quadtree/scheduler.ts
type Lifecycle = 'unseen' | 'queued' | 'computing' | 'ready' | 'readyRefinable';

interface Tile {
  id: TileID; level: number;
  simBuffer: GPUBuffer | null;
  reduction: TileReduction | null;
  lifecycle: Lifecycle;
  priority: number;
  cacheAge: number;
  computeCostMs: number;
  children: [Tile, Tile, Tile, Tile] | null;
  parent: Tile | null;
}

function computePriority(tile: Tile, view: ViewState): number {
  const Pv = isVisible(tile, view) ? 1 : 0;
  const Pz = clamp(1 - Math.abs(tile.level - view.zBase) / view.zBase, 0, 1);
  const Pc = tile.reduction
           ? 1 - 1 / (1 + tile.reduction.coherence_score)        // = S_tile / (1+S_tile)
           : 0.5;                                                // unknown → medium
  const Pf = inverseDistanceFromCentre(tile, view);
  const w  = view.priorityWeights;     // {wv: 10, wz: 2, wc: 3, wf: 1} default
  return w.wv*Pv + w.wz*Pz + w.wc*Pc + w.wf*Pf;
}

function shouldSplit(tile: Tile, view: ViewState): boolean {
  const r = tile.reduction; if (!r) return false;
  if (r.status_flags & AT_F32_FLOOR)              return false;
  if (tile.level >= view.maxDepth)                return false;
  if (!isVisible(tile, view))                     return false;
  if (r.outcome_impurity > view.thresholds.imp)   return true;
  if (r.suspect_fraction > view.thresholds.E)     return true;
  const tau = view.thresholds.tau0 + view.thresholds.tauPerLevel * tile.level;
  return r.coherence_score > tau;        // coherence_score holds S_tile here
}

export function frameLoop(view: ViewState) {
  updateCameraAndView(view);
  const visible = quadtree.collectVisibleFrontier(view);
  const baseline = ensureBaselineTiles(visible, view.minLOD);
  const candidates = [...baseline,
                      ...visible.filter(t => t.isLeaf && t.hasSummary)];
  for (const t of candidates) t.priority = computePriority(t, view);

  const jobs = topK(candidates, view.frameBudget);
  dispatchGpuTileJobs(jobs);

  for (const r of collectCompletedJobs()) {
    const t = quadtree.getNode(r.id);
    t.reduction = r.summary;
    t.lifecycle = 'ready';
    if (shouldSplit(t, view)) {
      quadtree.split(t);
      requestChildren(t.children!);
    }
  }
  renderTiles(quadtree.currentLeafCover(view));
}
```

**Tests.**

| ID | Type | Description |
|----|------|-------------|
| M5.U1 | unit | `TileReduction` size = 272 bytes at M=8 (matches spec §6.6 derivation) |
| M5.U2 | unit | `shouldSplit` returns false on `AT_F32_FLOOR` even with high impurity (override) |
| M5.U3 | unit | `computePriority` is zero for offscreen tiles (visibility dominates) |
| M5.I1 | integration | A uniform basin (e.g. deep interior of an escape region) reaches `coherence_score < 0.05` and is never split below depth 4 |
| M5.I2 | integration | A fractal boundary tile splits all the way to `MAX_DEPTH` under a `frameBudget = ∞` simulation |
| M5.I3 | integration | Pan offscreen → tile cancellation: no compute dispatch fires for tiles that scrolled out before their turn |
| M5.P1 | perf | Per-frame budget: with 64 visible tiles and `N=16`, total reduction CPU readback < 1ms |
| M5.A1 | acceptance | Spec §7 architectural validation: tiles marked coherent stay visually coherent one level deeper |

**Exit criterion.** `M5.I1` and `M5.I2` both pass on the (3,4,5)-Burrau view at
`T_horizon = 80`.

---

## M6 — Stability metrics and per-sample summary

**Why next.** All the colour modes that aren't pure event classification depend
on derived observables: shape-sphere geometry, frequency diffusion, FTLE,
free-group word. Land them once, in the canonical `SimResult`, and every
render mode in M7 reads from there.

**Scope.**
- Shape-sphere observable `n(t)` using the **corrected** Hopf formula from the
  spec revisions: `n_1 = (\|λ̃\|² - \|ρ̃\|²)/I`, `n_2 = -2 ρ̃·λ̃/I`,
  `n_3 = 2 (ρ̃ × λ̃)_z / I`.
- Checkpointing: store `n(t_m)` in `.xyz` of `float4`, unwrapped phase
  `θ̃(t_m)` in `.w` (auxiliary cache).
- Arc length `L_n` accumulated as a scalar.
- Frequency diffusion: two-window least-squares fit; sentinel `-1.0` for
  invalid (NaN forbidden under WGSL).
- FTLE with Benettin renormalisation (Research-tier only).
- Free-group word: bit-packed `uint4`, two branch cuts from BC₁ and BC₂ to the
  geometric north pole; near-pole fallback to south pole.
- The `sample_descriptor` and `trajectory_stats` packed `uint32`s, with the
  sign-of-net-winding fix from the revisions.

**Pseudocode.**

```wgsl
// src/gpu/shaders/helpers.wgsl — corrected shape sphere formula
fn shape_sphere(rho_tilde : vec2<f32>, lambda_tilde : vec2<f32>)
  -> vec3<f32>
{
  let rho_sq    = dot(rho_tilde, rho_tilde);
  let lambda_sq = dot(lambda_tilde, lambda_tilde);
  let I         = rho_sq + lambda_sq;
  let n1 = (lambda_sq - rho_sq) / I;
  let n2 = -2.0 * dot(rho_tilde, lambda_tilde) / I;
  let n3 =  2.0 * (rho_tilde.x * lambda_tilde.y
                 - rho_tilde.y * lambda_tilde.x) / I;
  return vec3<f32>(n1, n2, n3);
}
```

```ts
// src/metrics/free_group.ts — branch-cut crossing detection
const NORTH = [0, 0, 1] as const;
const SOUTH = [0, 0, -1] as const;

function pickEndpoint(b: Vec3): Vec3 {
  // If b is too close to the north pole, fall back to the south.
  const sin = norm3(cross3(b, NORTH));
  return sin < 0.1 ? SOUTH : NORTH;
}

export function freeGroupTick(
  word: WordState, prevN: Vec3, n: Vec3, b1: Vec3, b2: Vec3,
): WordState {
  for (const [generator, b, code] of [
    ['a', b1, 0b00], ['b', b2, 0b10],
  ] as const) {
    const e = pickEndpoint(b);
    const plane = cross3(b, e);                   // normal of branch-cut plane
    const dPrev = dot3(prevN,  plane);
    const dCurr = dot3(n,      plane);
    if (Math.sign(dPrev) !== Math.sign(dCurr) && dPrev !== 0 && dCurr !== 0) {
      const dir = dPrev > 0 && dCurr <= 0 ? 0 : 1;     // 0 = positive loop
      const symbol = code | dir;
      word = appendSymbolWithFreeReduction(word, symbol);
    }
  }
  return word;
}
```

```ts
// src/metrics/diffusion.ts — windowed least-squares frequency
export function diffusion(
  thetaTilde: Float32Array, t: Float32Array, T: number,
): number {
  const W1: [number, number] = [T/4, T/2];
  const W2: [number, number] = [T/2, 3*T/4];
  const fit = (w: [number, number]) => {
    const idx = [...t.keys()].filter(i => t[i] >= w[0] && t[i] <= w[1]);
    if (idx.length < 3) return null;          // ≥3 checkpoints required
    const ts = idx.map(i => t[i]);
    const ys = idx.map(i => thetaTilde[i]);
    return leastSquaresSlope(ts, ys);          // ω
  };
  const w1 = fit(W1), w2 = fit(W2);
  if (w1 === null || w2 === null) return -1;   // sentinel; never NaN
  return Math.abs(w2 - w1);
}
```

```ts
// src/metrics/ftle.ts — Benettin renormalisation loop
export function benettinFTLE(
  baseStep: () => void, shadowStep: () => void,
  separation: () => number, renormalise: () => void,
  T: number, Mrenorm: number, delta0: number,
): number {
  let S = 0, dt = 0;
  while (dt < T) {
    for (let s = 0; s < Mrenorm; s++) { baseStep(); shadowStep(); dt += dtMacro; }
    const dj = separation();
    S += Math.log(dj / delta0);
    renormalise();      // shadow ← base + (shadow - base) * delta0 / dj
  }
  return S / T;
}
```

**Tests.**

| ID | Type | Description |
|----|------|-------------|
| M6.U1 | unit | Shape-sphere formula at `(α=π/2, β=any)` returns `(1,0,0)` (inner-pair collision landmark) |
| M6.U2 | unit | Shape-sphere at the equilateral configuration returns `(0,0,±1)` for both signs (poles) |
| M6.U3 | unit | Diffusion returns `-1` (sentinel) when `t_end < T/2` |
| M6.U4 | unit | Diffusion of a perfect `θ̃(t) = ωt + θ₀` is zero to f64 precision |
| M6.G1 | golden | A periodic equal-mass figure-8 orbit gives a free-group word that is a power of `abAB` (palindromic) |
| M6.G2 | golden | A long Burrau scattering trajectory has FTLE `λ_T > 0.05` against an idealised regular orbit's `λ_T < 0.005` |
| M6.A1 | acceptance | Spec §7: FTLE-labelled outputs are produced only when Benettin renormalisation actually ran |

**Exit criterion.** `M6.G1` passes for the figure-8 orbit at the published
initial conditions, with the corrected shape-sphere formula in place.

---

## M7 — Render graph: colour, brightness, combiner, post

**Why next.** A clean separation of "what hue" / "how light" / "how merged" /
"how post-processed", so palette swaps don't trigger recompute.

**Scope.**
- Four-stage pipeline as in spec §5: colour node → brightness node → combiner →
  postprocess. Stages exchange `vec3<f32>` (linear sRGB) and `f32` (`[0,1]`).
- OKLAB / OKLCH conversion helpers, in linear space throughout.
- VMF blend engine, 6-pole, with Okabe–Ito CB-safe variant.
- Stability × hue principal mode using the corrected shape-sphere observable.
- Physics-overlay landmarks: BC, Euler, Lagrange (and the corrected coordinates).
- Combiner with three modes (replace lightness in OKLAB, modulate, multiply RGB).
- CVD simulation matrices in postprocess, before the canvas write.
- Render-mode UI list; mode change rebinds `RenderParams` only — group 0/1
  buffers don't change.

**Pseudocode.**

```wgsl
// src/gpu/shaders/render.wgsl (excerpt)
@fragment
fn fs_main(@builtin(position) pos : vec4<f32>) -> @location(0) vec4<f32> {
  let pix = pixel_to_sample_index(pos);
  let r   = results[pix];
  let ic  = ics[pix];

  // 1. colour node
  var rgb : vec3<f32>;
  switch (rparams.colour_mode) {
    case COLOUR_EVENT_CLASS:    { rgb = colour_event_class(r);            }
    case COLOUR_VMF_OKLAB:      { rgb = vmf_blend_oklab(final_n(r));      }
    case COLOUR_OKABE_ITO:      { rgb = vmf_blend_okabe_ito(final_n(r));  }
    case COLOUR_DIFFUSION:      { rgb = palette_seq(r.diffusion);          }
    case COLOUR_ENERGY:         { rgb = palette_div_symlog(ic.K_0 + ic.V_0); }
    // ... up to 20 modes
    default:                    { rgb = vec3<f32>(0.5);                   }
  }
  // Fallback for terminal-at-decode states.
  if ((r.sample_descriptor & 0x7u) == OUTCOME_DEGENERATE) {
    rgb = vec3<f32>(0.5);
  } else if ((r.sample_descriptor & 0x7u) == OUTCOME_COLLISION_T0) {
    rgb = vec3<f32>(1.0, 0.9, 0.0);
  }

  // 2. brightness node
  var b : f32 = 1.0;
  switch (rparams.brightness_mode) {
    case BRIGHT_TIME_TO_EVENT: { b = clamp(1.0 - r.t_end/uniforms.T_horizon, 0, 1); }
    case BRIGHT_DIFFUSION:     { b = stability_lightness(r.diffusion);              }
    case BRIGHT_BC_PROXIMITY:  { b = bc_proximity_lightness(final_n(r));            }
    default:                   { b = 1.0;                                            }
  }

  // 3. combiner
  let combined = combine_replace_lightness_oklab(rgb, b);

  // 4. postprocess (CVD)
  let final_rgb = apply_cvd(combined, rparams.cvd_mode);
  return vec4<f32>(linear_to_srgb(final_rgb), 1.0);
}
```

```ts
// src/render/oklab.ts — round-trip-tested colour conversions
export function linearRgbToOklab(rgb: Vec3): Vec3 { /* M1, cube root, M2 */ }
export function oklabToLinearRgb(lab: Vec3): Vec3 { /* inverse */ }
export function combineReplaceLightness(rgb: Vec3, L: number): Vec3 {
  const lab = linearRgbToOklab(rgb);
  return oklabToLinearRgb([clamp(L, 0, 1), lab[1], lab[2]]);
}
```

**Tests.**

| ID | Type | Description |
|----|------|-------------|
| M7.U1 | unit | OKLAB round-trip `oklabToLinearRgb(linearRgbToOklab(c)) ≈ c` to 1e-6 |
| M7.U2 | unit | VMF 6-pole blend at `n = (0,0,1)` returns the `+ẑ` pole hue exactly |
| M7.U3 | unit | Replace-lightness combiner: `combine(c, L_of(c)) ≈ c` (round-trip identity) |
| M7.U4 | unit | CVD matrix is invertible at single precision (eigenvalues > 0) |
| M7.I1 | integration | Palette swap (changing only group-3 RenderParams) does not fire a compute dispatch |
| M7.I2 | integration | Stability × hue mode reproduces the published figure 23 colour layout to within 1 OKLAB ΔE per pixel |
| M7.A1 | acceptance | Spec §5 R6: `SimResult` and `ICDescriptor` buffers don't change when render mode changes |

**Exit criterion.** `M7.I1` passes (no recompute on palette swap) and `M7.I2`
passes against a hand-checked reference frame.

---

## M8 — Interaction model: microscope, lock, lookup, tilt

**Why next.** With the data pipeline solid, the user-facing controls become a
thin layer on top: every gesture maps to a transform of `ViewState`, and
`ViewState` is the cache key. No GPU shader changes needed.

**Scope.**
- Sliders for each `z_k`, log-stepped zoom, chart-mode selector.
- Tilt: Givens-style rotation into a target dimension (corrected per
  revisions). Two independent tilt sliders with Gram–Schmidt
  re-orthonormalisation. Tilt replaces, doesn't accumulate.
- Lock gesture: pixel `(s, t)` → `z_locked` for affine charts; CPU replay or
  GPU readback for nonlinear charts.
- Lookup: input parser (mass tuple, Pythagorean triple, raw `z`, physical
  IC). Inverse encode paths from M2; chart-aware validation; project /
  clamp / reject responses to invalid input.
- Lock-preservation policy across chart switches: decode the locked physical
  IC, attempt inverse encoding into the new chart, fall back to projection
  per the chart's declared policy, refuse if qualitatively different.
- Named compound directions (mass-perturbation-from-Burrau,
  energy-increase-at-fixed-Lz, Burrau-to-unconstrained morph).

**Pseudocode.**

```ts
// src/interact/tilt.ts
export function applyTilt(
  qBase: Vec8, target: number, tau: number,
): Vec8 {
  // Tilt always relative to the chart-defined initial basis qBase.
  const e = unitVec8(target);
  return add8(scale8(qBase, Math.cos(tau)), scale8(e, Math.sin(tau)));
}

export function reorthonormalise(q1: Vec8, q2: Vec8): [Vec8, Vec8] {
  const q1n = normalise8(q1);
  const q2perp = sub8(q2, scale8(q1n, dot8(q2, q1n)));
  if (norm8(q2perp) < 1e-6) {
    // Degenerate: both sliders target the same dimension at similar angles.
    return [q1n, fallbackOrthogonalDirection(q1n)];
  }
  return [q1n, normalise8(q2perp)];
}
```

```ts
// src/interact/lock.ts
export function lock(
  view: ViewState, pixel: { s: number; t: number },
): ViewState {
  const chart = chartRegistry.get(view.chartType);
  if (chart.kind === 'affine') {
    // Closed-form: z_locked = z_0 + (2s-1) q1 + (2t-1) q2, no GPU readback
    const z = add8(view.z0,
      add8(scale8(view.q1, 2*pixel.s - 1),
           scale8(view.q2, 2*pixel.t - 1)));
    return { ...view, z0: z, locked: true };
  }
  // Nonlinear: replay decoder on CPU at f64.
  const ic = chart.decode(pixel, view);
  return { ...view, z0: chart.inverseEncode(ic), locked: true };
}

export function preserveLockAcrossChart(
  view: ViewState, newChartType: string,
): ViewState | { rejected: true; reason: string } {
  if (!view.locked) return { ...view, chartType: newChartType };
  const oldChart = chartRegistry.get(view.chartType);
  const newChart = chartRegistry.get(newChartType);
  const ic = oldChart.decode({ s: 0.5, t: 0.5 }, view);   // current centre
  const encoded = newChart.tryInverseEncode(ic);
  if (encoded.kind === 'exact') {
    return { ...view, chartType: newChartType, z0: encoded.z };
  }
  if (encoded.kind === 'projected' && newChart.policy === 'project') {
    return { ...view, chartType: newChartType, z0: encoded.z, projected: true };
  }
  return { rejected: true, reason: encoded.reason };
}
```

```ts
// src/interact/lookup.ts
export type LookupInput =
  | { kind: 'mass';      m: Vec3 }
  | { kind: 'pythag';    a: number; b: number; c: number }
  | { kind: 'physical';  m: Vec3; r: [Vec2,Vec2,Vec2]; p: [Vec2,Vec2,Vec2] }
  | { kind: 'latent';    z: Vec8 };

export function lookup(
  input: LookupInput, view: ViewState,
): { view: ViewState; clamped: boolean } | { rejected: string } {
  // 1. canonicalise to a physical IC
  const ic = lookupToPhysical(input, view);

  // 2. inverse-encode into the active chart
  const chart = chartRegistry.get(view.chartType);
  const encoded = chart.tryInverseEncode(ic);

  // 3. validate
  const v = chart.validate(encoded.uv, view);
  if (v.kind === 'reject') return { rejected: v.reason };
  if (v.kind === 'project') return { view: applyProjected(view, v), clamped: true };

  // 4. lock
  return { view: lock(view, encoded.pixel), clamped: encoded.clamped };
}
```

**Tests.**

| ID | Type | Description |
|----|------|-------------|
| M8.U1 | unit | `applyTilt(q, k, 0)` returns `q` exactly |
| M8.U2 | unit | `applyTilt(q, k, π/2)` returns `±e_k` exactly |
| M8.U3 | unit | After `reorthonormalise`, `q1·q2 = 0` to 1e-12 |
| M8.U4 | unit | `lock` on the centre pixel (`s = t = 0.5`) returns `z0` unchanged for affine charts |
| M8.U5 | unit | Lookup of Pythagorean `(3,4,5)` with default mass → `ν = 1/2` (the `(2,1)` ratio) |
| M8.I1 | integration | Lock at boundary, switch chart from `(L_z,K)` → `(L_z,E)`: physical IC preserved to 1e-6 |
| M8.I2 | integration | Pan after tilt produces visually consistent frames (no jitter from re-orthonormalisation) |
| M8.A1 | acceptance | Spec §3.4: every user-entered IC either locks, projects with notification, or rejects with a specific reason |

**Exit criterion.** `M8.I1` passes — physical IC preserved across chart switch
to 1e-6 in mass-weighted phase-space norm.

---

## M9 — Locked-pixel inspector (CPU f64)

**Why next.** With M8 producing locks and M2's decoder canonical, the
inspector is a pure CPU recompute that drives an overlay UI. It also doubles
as the validation tool for the GPU pipeline.

**Scope.**
- Re-decode the locked IC through the same `Φ → D → C` pipeline at f64.
- CPU integrator: RK45 (Dormand–Prince) with adaptive step control. Defaults:
  `h_min = 1e-10`, `h_max = 1e-2`, `h_init = 1e-4`, `ε_rel = 1e-10`,
  `ε_abs = 1e-12`.
- Optional shadow trajectory at `δ_0 = 1e-8` for true Benettin FTLE.
- `InspectorResult` struct with full per-step trajectory, derived series, and
  metadata.
- "Match-integrator" mode: use the same KDK / Yoshida coefficients as the
  active GPU pipeline, for apples-to-apples cross-checks.
- Hover-streamline interaction on the shape-sphere chart: 30ms debounce, 8ms
  budget per integration, progressive refinement on idle frames.
- Overlay UI: shape-sphere panel, real-space panel, IC summary, diagnostics
  panel, free-group word, validation panel.

**Pseudocode.**

```ts
// src/inspector/rk45.ts — Dormand–Prince step
const A = [/* 7 stages of coefficients */];
const B5 = [/* 5th-order weights */];
const B4 = [/* 4th-order weights */];

export function dopri5Step(
  s: TrajState, h: number, derivs: (s: TrajState) => Vec18,
): { s5: TrajState; err: number } {
  const k1 = derivs(s);
  const k2 = derivs(addScaled(s, k1, h*A[1][0]));
  const k3 = derivs(addScaled(s, k1, h*A[2][0], k2, h*A[2][1]));
  // ... k4 .. k7
  const y5 = combine(s, [k1,k2,k3,k4,k5,k6,k7], B5, h);
  const y4 = combine(s, [k1,k2,k3,k4,k5,k6,k7], B4, h);
  return { s5: y5, err: norm(sub(y5, y4)) };
}

export function dopri5(
  s0: TrajState, T: number, opts: RK45Opts,
): InspectorResult {
  let s = s0, h = opts.hInit, t = 0;
  const log: TrajState[] = [s];
  while (t < T) {
    const { s5, err } = dopri5Step(s, h, derivs);
    if (err < opts.epsAbs + opts.epsRel * norm(s5)) {
      s = projectCOM(s5);              // every accepted step
      log.push(s); t += h;
      if (terminalCheck(s)) break;
      h = Math.min(opts.hMax, h * 0.9 * (opts.epsAbs/err)**0.2);
    } else {
      h = Math.max(opts.hMin, h * 0.9 * (opts.epsAbs/err)**0.2);
      if (h <= opts.hMin) { return abort('h_min reached', log); }
    }
  }
  return finalise(log);
}
```

```ts
// src/inspector/hover_streamline.ts — debounced budget-capped preview
let inflight: AbortController | null = null;
let lastStart = 0;

export function onPointerMove(uv: Vec2) {
  if (inflight) inflight.abort();
  const now = performance.now();
  if (now - lastStart < 30) return;          // 30ms debounce
  lastStart = now;
  inflight = new AbortController();
  runWithBudget(uv, /* 8ms */, inflight.signal)
    .then(drawPartialOnIdle);
}
```

```ts
// src/inspector/match_integrator.ts — apples-to-apples cross-check
export function inspectorMatching(view: ViewState, ic: TrajState): InspectorResult {
  const integrator = view.integrator;        // 'kdk' | 'yoshida4' | 'yoshida6' | 'rk4'
  const dt = view.dtMacro;
  const horizon = view.horizon;
  // Use the SAME step size and order as the GPU pipeline.
  // Energy-trace comparison against the GPU is now valid.
  return runIntegrator(integrator, ic, dt, horizon, /* f64 */);
}
```

**Tests.**

| ID | Type | Description |
|----|------|-------------|
| M9.U1 | unit | DOPRI5 on the two-body Kepler problem holds energy to 1e-12 over `T = 1000` |
| M9.U2 | unit | Step rejection: when `err > tol`, step size shrinks by exactly `0.9 (tol/err)^0.2` |
| M9.U3 | unit | `runWithBudget` returns a partial trajectory after exactly 8ms wall-clock |
| M9.I1 | integration | Inspector in match-integrator mode reproduces the GPU pipeline's `t_end` to within 1ms on a smooth Burrau sample |
| M9.I2 | integration | Adaptive RK45 successfully chases a near-collision approach (`r_min ≈ 1e-6`) where the GPU pipeline declared `MAX_SUBSTEPS` |
| M9.A1 | acceptance | Spec §3.3: any disagreement above threshold flagged in orange in the validation panel |

**Exit criterion.** `M9.I1` passes — match-integrator mode agrees with GPU to
sub-millisecond `t_end`.

---

## M10 — Chart instantiations

**Why next.** Each chart is a small registered module with three operations:
`Φ(u,v)`, `inverseEncode(ic)`, `validate(u,v)`. They all reuse the M2 decoder
and M5 quadtree. Adding a chart is a leaf change.

**Scope.**
- Latent affine slice (already implicit since M3 — wrap in chart contract).
- `(L_z, E)` chart with feasibility-parabola domain warp. Energy-normalisation
  flag `forbids_energy_normalisation = true`.
- `(L_z, K)` chart (simpler warp, same flag).
- Shape-sphere chart with hover-streamline (M9 dependency); the
  `has_redundant_hemisphere = true` flag declared.
- Mass simplex chart with `ε_m = 1e-4` interior buffer.
- Burrau Euclid display chart (1D physical, 2D for landmark display).
- Burrau acute-angle chart, ternary mass plot, bifurcation strip.
- Mixed-axis chart factory that takes a pair of axis specs and a frozen-`z`
  vector. `requires_per_pixel_mass = true` if any axis is a mass coordinate.
- Chart registry with `validate(u,v) → ValidationResult` signature.

**Pseudocode.**

```ts
// src/chart_atlas/registry.ts
export interface Chart {
  type: string;
  kind: 'affine' | 'invariant' | 'sphere' | 'mass-simplex' | 'mixed';
  decode(uv: Vec2, view: ViewState): ICDecodeOut;
  inverseEncode(ic: TrajState): EncodeResult;
  validate(uv: Vec2, view: ViewState): ValidationResult;
  flags: ChartFlags;
}
export interface ChartFlags {
  forbids_energy_normalisation: boolean;
  has_redundant_hemisphere:     boolean;
  requires_per_pixel_mass:      boolean;
}

export const chartRegistry = new Map<string, Chart>();
chartRegistry.set('latent_slice',  latentSliceChart);
chartRegistry.set('lz_e',          lzEChart);
chartRegistry.set('lz_k',          lzKChart);
chartRegistry.set('shape_sphere',  shapeSphereChart);
chartRegistry.set('mass_simplex',  massSimplexChart);
chartRegistry.set('burrau_euclid', burrauEuclidChart);
chartRegistry.set('burrau_acute',  burrauAcuteChart);
chartRegistry.set('mixed_axis',    mixedAxisChart);
```

```ts
// src/chart_atlas/lz_e.ts — domain warp + deterministic momentum construction
export const lzEChart: Chart = {
  type: 'lz_e',
  kind: 'invariant',
  flags: { forbids_energy_normalisation: true,
           has_redundant_hemisphere:     false,
           requires_per_pixel_mass:      false },

  decode({ u, v }, view) {
    const { Kmax, gammaK } = view.chartParams;
    const K  = Kmax * v ** gammaK;
    const E  = computeUatRest(view) + K;
    const Lmax = Math.sqrt(2 * /*I=*/1 * K);
    const Lz = (2*u - 1) * Lmax;

    const config = decodeConfig(view);    // α, β fixed by chart
    const I = 1;                          // scale gauge

    // (i) minimal-energy rigid rotation realising Lz
    const omega = Lz / I;
    const Kmin  = Lz*Lz / (2*I);
    const vL    = bodies =>
      bodies.map(r => scale(J(r), omega));

    // (ii) projected direction field
    const w = constructEnergySeed(config, view);

    // (iii) mix to hit K
    const a = Math.sqrt(2 * (K - Kmin));
    const v_i = combine(vL(config.r), w, a);
    const p_i = v_i.map((v, i) => scale(v, view.m[i]));

    return { state: { r: config.r, p: p_i, m: view.m, t: 0 } };
  },

  inverseEncode(ic) { /* compute Lz and E directly from ic */ },
  validate({u, v}, view) {
    if (v < 0 || v > 1) return { kind: 'reject', reason: 'v out of range' };
    if (u < 0 || u > 1) return { kind: 'reject', reason: 'u out of range' };
    return { kind: 'pass' };
  },
};
```

**Tests.**

| ID | Type | Description |
|----|------|-------------|
| M10.U1 | unit | `lzEChart.decode((0.5, 0))` produces a rest start with `Lz=0`, `K=0` |
| M10.U2 | unit | `lzEChart.decode((1, 1))` saturates at `Lz = +Lmax(Kmax)` and `K = Kmax` |
| M10.U3 | unit | `shapeSphereChart.flags.has_redundant_hemisphere === true` |
| M10.U4 | unit | `mixedAxisChart` with axis1 = mass simplex, axis2 = Lz: `requires_per_pixel_mass === true` |
| M10.G1 | golden | Locking the equilateral triangle in the shape-sphere chart and switching to `(L_z, E)` lands at the apex of the feasibility parabola, `(0, U)` |
| M10.A1 | acceptance | Spec §1.6.5: every chart's `Φ` is a total function on `[0,1]²` |

**Exit criterion.** `M10.A1` passes — for each registered chart, 1e6 random
`(u, v)` give either a valid IC or an explicit terminal label.

---

## M11 — Burrau family progression

**Why next.** Layered onto M10's chart machinery, the Burrau family becomes a
progression of concrete views, not a separate code path. Each stage adds one
degree of freedom.

**Scope.**

| Stage | View | New code |
|-------|------|----------|
| 1a | Discrete primitive triples at rest | landmark overlay only |
| 1b | Continuous `ν` sweep | `burrau_euclid` chart |
| 2a | Continuous masses, fixed triangle | `burrau_mass_simplex` chart |
| 2b | Continuous `(L_z, E)` at fixed shape & masses | reuse `lz_e` chart |
| 3 | Combined: masses and momentum simultaneously | mixed-axis chart |
| 4 | Full 8D: tilt out of the Burrau submanifold | tilt mechanism (M8) |

- Euclid parametrisation (`a = m²-n²`, `b = 2mn`, `c = m²+n²`) and the
  primitive-triple landmark grid.
- Acute-angle axis: `θ = arctan((1-ν²)/(2ν))`, `ν(θ) = sec θ - tan θ`.
- Burrau-mass mapping: `m_i ∝` opposite-side length, with the 0-/1-index
  rewiring discussed in spec §2.3.
- Bifurcation strip charts: `(θ, K)` and `(θ, δm)`.
- Central-hypothesis test scaffolding: lock on a Burrau basin boundary, tilt
  one basis vector into a non-Burrau direction, and watch persistence.

**Pseudocode.**

```ts
// src/burrau/euclid.ts
export function burrauTriangle(nu: number): {
  r: [Vec2,Vec2,Vec2]; m: Vec3;
} {
  const a = 1 - nu*nu;          // normalised by m²
  const b = 2*nu;
  const c = 1 + nu*nu;
  const total = a + b + c;
  // Burrau classical convention is 1-indexed. Re-index to 0-indexed:
  // body 1 → 0 (right angle, at origin, mass = c/total)
  // body 2 → 1 (mass = b/total)
  // body 3 → 2 (mass = a/total)
  return {
    r: [[0,0], [a/c, 0], [0, b/c]],
    m: [c/total, b/total, a/total],
  };
}

export function* primitiveTriples(maxM: number) {
  for (let m = 2; m <= maxM; m++) {
    for (let n = 1; n < m; n++) {
      if (gcd(m, n) === 1 && (m - n) % 2 === 1) {
        yield { m, n, nu: n/m,
                a: m*m - n*n, b: 2*m*n, c: m*m + n*n };
      }
    }
  }
}
```

```ts
// src/burrau/hypothesis_probe.ts — Stage 4 test
export async function probePersistence(
  view: ViewState,
  boundaryPixel: { s: number; t: number },
  tiltDimension: number,
  steps: number = 60,
): Promise<PersistenceTrace> {
  const trace: PersistenceTrace = [];
  const locked = lock(view, boundaryPixel);
  for (let i = 0; i < steps; i++) {
    const tau = (i / (steps - 1)) * (Math.PI / 2);
    const tilted = applyTiltToView(locked, tiltDimension, tau);
    const tile = await ensureTileAt(tilted, { s: 0.5, t: 0.5 });
    trace.push({ tau, outcomeImpurity: tile.reduction.outcome_impurity,
                 coherence: tile.reduction.coherence_score });
  }
  return trace;
}
```

**Tests.**

| ID | Type | Description |
|----|------|-------------|
| M11.U1 | unit | `burrauTriangle(1/2)` matches the (3,4,5) reference triangle exactly |
| M11.U2 | unit | `primitiveTriples(5)` yields exactly `{(2,1):(3,4,5), (3,2):(5,12,13), (4,1):(15,8,17), (4,3):(7,24,25)}` |
| M11.U3 | unit | `θ(ν=1/2) = arctan(3/4) ≈ 36.87°` |
| M11.G1 | golden | Stage 1a: integrating the (3,4,5) Burrau IC reproduces the published outcome (body 1 escapes at `t ≈ 60`) |
| M11.G2 | golden | Stage 1b: at `ν = 0.5`, the basin classification matches the discrete (3,4,5) result |
| M11.I1 | integration | Stage 4: a clearly-fractal boundary in the (3,4,5) view persists under a tilt of ±30° into `z_μ1` (basin survives) |
| M11.A1 | acceptance | Each Burrau-family chart's `Φ` factorises through the shared decoder (no Burrau-specific integrator) |

**Exit criterion.** `M11.G1` and `M11.G2` both pass against published Burrau
results.

---

## M12 — Export, data API, validation harness

**Why last.** Once interactive exploration works, the export pipeline reuses
all of it: same decoder, same integrator, same chart map, same render graph.
The only difference is orchestration.

**Scope.**
- `ViewState` schema as the single source of truth, used by:
  - URL sharing (encode/decode to compressed string)
  - Single-frame static export
  - Animated sweep with `Timeline` keyframes and easing functions
  - Live-simulation export (one step per frame, no quadtree)
  - Reproducibility sidecar (JSON + SHA-256 of binary)
- Full-retention mode (no reduction pass; persistent `SimResult` buffer,
  partition into sub-buffers if a single buffer would exceed
  `maxStorageBufferBindingSize`).
- Data export formats: PNG (Canvas API), JSON (small datasets), binary
  ArrayBuffer (raw `SimResult[]`), CSV (spreadsheet), NPZ (with the
  documented JS-library dependency).
- Validation harness: every spec §7 acceptance check wired into CI, run
  against a frozen corpus.

**Pseudocode.**

```ts
// src/export/timeline.ts
export interface TimelineTrack<T> {
  path: string;
  keyframes: { frame: number; value: T; easing: EasingName }[];
}

const easings: Record<EasingName, (t: number) => number> = {
  linear:       t => t,
  ease_in:      t => t*t,
  ease_out:     t => 1 - (1-t)*(1-t),
  ease_in_out:  t => 3*t*t - 2*t*t*t,
  hold:         _ => 0,
  log:          t => Math.log(1 + 9*t) / Math.LN10,
  step:         t => t < 1 ? 0 : 1,
};

export function evaluateTrack<T>(
  track: TimelineTrack<T>, frame: number, base: T,
): T {
  const ks = track.keyframes;
  if (frame < ks[0].frame) return base;
  if (frame >= ks[ks.length-1].frame) return ks[ks.length-1].value;
  let i = 0;
  while (i < ks.length - 1 && ks[i+1].frame <= frame) i++;
  const t01 = (frame - ks[i].frame) / (ks[i+1].frame - ks[i].frame);
  const eased = easings[ks[i].easing](t01);
  return interpolate(ks[i].value, ks[i+1].value, eased);
}

export async function runTimeline(timeline: Timeline) {
  for (let f = 0; f < timeline.duration_frames; f++) {
    const view = structuredClone(timeline.base);
    for (const tr of timeline.tracks) {
      setByPath(view, tr.path, evaluateTrack(tr, f, getByPath(view, tr.path)));
    }
    const v = chartValidate(view);
    if (v.kind === 'reject') throw new Error(`frame ${f}: ${v.reason}`);
    const buf = await renderFlatStatic(view);
    await writeFrame(timeline.output.path, f, buf);
  }
  if (timeline.output.include_sidecar) await writeSidecar(timeline);
}
```

```ts
// src/export/data_api.ts
export async function exportBinary(view: ViewState): Promise<ArrayBuffer> {
  const { simResults, header } = await renderFlatStaticFullRetention(view);
  return packHeaderAndPayload(header, simResults);
}

export async function exportSidecar(view: ViewState, dataHash: string) {
  return JSON.stringify({
    principia_version: VERSION,
    timestamp: new Date().toISOString(),
    view, sha256: dataHash,
  }, null, 2);
}

// Reproducibility round-trip:
export async function reproduce(viewJson: string, expectedHash: string) {
  const view = JSON.parse(viewJson) as ViewState;
  const buf  = await exportBinary(view);
  const got  = await sha256(buf);
  return got === expectedHash;
}
```

```ts
// src/validation/acceptance.ts — wires every spec §7 check into CI
export const acceptanceTests = [
  { id: 'A1', name: 'n(t) stable near poles',
    run: () => /* sample 1k random ICs near n=(0,0,±1), check no NaNs */ },
  { id: 'A2', name: 'coherent tile stays coherent one level deeper',
    run: () => /* split a coherent tile, check children agree */ },
  { id: 'A3', name: 'baseline coverage during refinement',
    run: () => /* ensure no blank regions during refine */ },
  { id: 'A4', name: 'render mode change does not change compute payload',
    run: () => /* assert SimResult byte-identical pre/post mode swap */ },
  { id: 'A5', name: 'FTLE only labelled when Benettin actually ran',
    run: () => /* dispatch with FTLE off, assert FTLE_VALID never set */ },
  { id: 'A6', name: 'energy drift below threshold for bounded',
    run: () => /* sample bounded basin, check ε_E < 1e-4 (interactive) */ },
];
```

**Tests.**

| ID | Type | Description |
|----|------|-------------|
| M12.U1 | unit | `evaluateTrack` at the keyframe frame returns the keyframe value exactly |
| M12.U2 | unit | `step` easing produces an instant transition exactly at `t = 1` |
| M12.U3 | unit | Reproducibility: `reproduce(sidecarJson, hash)` returns `true` for a sidecar produced from the same `ViewState` |
| M12.I1 | integration | Sweep `z[3]` over 120 frames at 1024² produces a frame sequence whose first and last frames match independent single-frame exports byte-for-byte |
| M12.I2 | integration | Full-retention buffer exceeds `maxStorageBufferBindingSize`: pipeline auto-partitions into sub-buffers and produces correct output |
| M12.A1..6 | acceptance | All six spec §7 architectural checks pass on a frozen corpus |

**Exit criterion.** `M12.A1..6` all pass; reproducibility sidecar correctly
verifies a 100-frame animated export.

---

## Cross-cutting concerns (live across all milestones)

These are not single milestones but standing rules that every milestone has
to honour.

### Precision contract

| Where | Precision | Why |
|-------|-----------|-----|
| Quadtree manager (CPU) | f64 | tile bounds, centre/half-width |
| GPU per-tile uniforms | f32 | `c_u, h_u, c_v, h_v` |
| GPU shader interior | f32 | tile-local sample positions, IC decode, integration |
| Locked-pixel inspector | f64 | single-trajectory validation |
| Linearised decoder reference IC | f64 (CPU) → f32 (GPU) | only at deep zoom |

### Sentinel discipline

- Diffusion: `-1.0` for "missing or invalid", **never NaN** under WGSL.
- FTLE: `0.0` when `FTLE_VALID` is clear (no sentinel needed; the bit drives interpretation).
- COM projection: never optional in production paths. Inspector at f64 may project per substep.

### Cache invalidation policy

| Change | Invalidates |
|--------|-------------|
| Palette / hue / brightness | render cache only |
| Overlay toggles | render cache only |
| Integrator / `Δt_macro` / `N_max` | diagnostics + render |
| Event thresholds (`r_coll`, `R_esc`, `k_esc`) | diagnostics + render |
| Chart parameters (`z_0`, `q_a`) | diagnostics + render |
| Decode knobs (`μ_max`, `α_min`) | diagnostics + render |
| Horizon `T` | diagnostics + render |
| Enabled metrics set | diagnostics + render |
| Quality tier | diagnostics + render |

`payload_version` (a single uint32 in `TileCacheKey`) bumps whenever any
"diagnostics-invalidating" knob changes. Bumping the constant in the shader
and CPU code at the call site is sufficient.

### Telemetry

Every milestone after M3 records into a per-frame trace:
- Tiles dispatched, queued, evicted.
- GPU compute time and CPU readback time.
- Energy drift histogram (Burrau golden run).
- Cache hit rate and ancestor-fallback rate.

These feed the perf gate for M5 and M12 acceptance tests.

### Risk register

| Risk | Mitigation milestone |
|------|----------------------|
| WGSL struct layout drifts from TS-side packing | M3 (`sizeOfSimResult` test) |
| `f32` precision wall at deep zoom | M5 (linearised decoder switchover at depth ≥ 20) |
| Free-group near-pole degeneracy on extreme mass ratios | M6 (south-pole fallback) |
| Inspector vs GPU energy-drift confusion | M9 (match-integrator mode) |
| Buffer-size limit on full retention | M12 (auto-partition) |

---

## Milestone graph (build order)

```
                  ┌───── M0 (skeleton + math) ─────┐
                  ▼                                ▼
                  M1 (CPU integrator) ──────► M2 (decoder atlas)
                                                   │
                                                   ▼
                  M3 (Layer 0 GPU) ◄───────────────┤
                       │                           │
                       ▼                           │
                  M4 (Layer 1 cache)               │
                       │                           │
                       ▼                           │
                  M5 (Layer 2 reduction) ◄─────────┘
                       │
                       ▼
                  M6 (stability metrics)
                       │
                       ▼
                  M7 (render graph) ──────────► M8 (interaction)
                                                   │
                                                   ▼
                                              M9 (inspector)
                                                   │
                                                   ▼
                                              M10 (chart instantiations)
                                                   │
                                                   ▼
                                              M11 (Burrau progression)
                                                   │
                                                   ▼
                                              M12 (export + acceptance)
```

A two-engineer team can parallelise: M1+M2 in week 1; one person on M3 while
another starts M6 prototyping at f64; merge at M5; from M7 onward the
interaction track (M8/M9) and the chart track (M10/M11) are independent and
re-converge at M12.

A solo build is roughly 12–14 weeks of focused work, with the first user-facing
demo (Layer 1 + a basic colour mode) hitting at the end of M4.


