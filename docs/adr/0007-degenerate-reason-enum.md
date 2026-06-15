# ADR 0007: DEGENERATE(reason) reason enumeration

- **Status:** Proposed (not yet ratified into the spec)
- **Date:** 2026-06-15
- **Gates:** M2, M3
- **Recommendation:** Adopt a closed 8-member DegenerateReason enum with frozen u32 codes (10-17), reserving COLLISION_T0 as a separate terminal kind; downstream matches on the enum, never on free strings.

---

## Context

Totality is an architectural invariant: the decode-to-simulate pipeline is a total function of the UV/UVW coordinate and "must never reject a parameter point" (spec §1, `sec:goal`, line 77). The no-holes rule in §1 (`sec:goal`, line 88) says "decode-time failures emit `DEGENERATE(reason)`, and t=0 near-collisions emit `COLLISION_T0`", and the architecture skill restates it as "tag, never throw."

The problem: the spec names the **constructor** `DEGENERATE(reason)` but never enumerates the `reason` set. It mentions concrete reasons only in passing and in three different places:

- §6.1 `sec:mass_decode` (line 201): "if `M01 < ε`, emit `DEGENERATE(M01_TINY)`" — the only fully-named reason.
- §6.8 `sec:no_holes_impl` (line 270): "`DEGENERATE(reason)` for rare numerical failures" — unspecified.
- §7.2 `sec:LE_view` (line 313, 315): "Only emit `DEGENERATE` if all seeds fail" and "If `K* < K_min`, emit terminal" — invariant-momentum failures, reason unnamed.

This is an open **contract** that gates M2 (decoder atlas) and M3. It must be pinned once because multiple build agents touch both sides of it. The M2 milestone already shows the drift hazard concretely: `pipeline.ts` emits the **enum-style** `{ kind: 'DEGENERATE', reason: 'M01_TINY' }`, while `no_holes.ts::safeguardDecode` forwards `(e as Error).message ?? 'unknown'` — an arbitrary **free string** — into the same `reason` slot. Without a closed enum, two agents will produce mutually unmatchable reasons, the GPU path has no stable integer to write into `SimResult`, and the architecture skill's "downstream matches on the enum, not free strings" is unenforceable. `COLLISION_T0` is deliberately *not* a DEGENERATE reason: §1 and §6.8 list it as a separate terminal, and `canonicalise.ts` already emits it as its own `kind` with a `pair` field.

What is undecided: (a) the closed membership of the reason set; (b) the stable u32 codes for the GPU path; (c) that `reason` is an enum, not a string, on both CPU and GPU.

## Options

### Option A — Free-string reasons (status quo of `safeguardDecode`)
How it works: `DEGENERATE` carries an arbitrary `reason: string`; the GPU collapses all degeneracies to a single "degenerate" outcome code with no sub-reason.
- Pros: zero up-front design; any new failure site invents its own message.
- Cons: directly violates the architecture skill ("match on the enum, not free strings"); reasons drift across agents (`'M01_TINY'` vs `'M01 tiny'` vs an exception message); no stable GPU integer, so the reduction/diagnostics can never histogram *why* a pixel was degenerate; impossible to write a fixture that pins the contract.
- Cost: none now, large recurring cost later (every consumer hand-parses strings).

### Option B — Closed enum, CPU-only string union, GPU collapses to one code
How it works: define a TypeScript string-literal union `DegenerateReason`; the GPU writes a single shared "DEGENERATE" outcome with no reason sub-field.
- Pros: type-safe on CPU; cheap GPU.
- Cons: the GPU path is exactly the path the spec calls out (`DEGENERATE` is emitted inside the per-pixel decode that runs in WGSL). Collapsing on the GPU means the `TileReduction` histogram and the locked-pixel inspector cannot distinguish `M01_TINY` from an infeasible-energy terminal — a real diagnostic loss for a tool whose whole point is exploring the degeneracy structure of IC space. String unions also need a separate, manually-synced int table for any GPU use, reintroducing drift.
- Cost: low, but leaves a second (GPU) mapping undefined and gating M3.

### Option C — Closed enum with frozen u32 codes, shared CPU+GPU, COLLISION_T0 separate (recommended)
How it works: a single closed enum `DegenerateReason` with explicit `u32` codes that are identical in TypeScript and in WGSL. `DEGENERATE` carries `reason: DegenerateReason`. `COLLISION_T0` stays a distinct terminal kind (with its `pair` field), not a reason. `safeguardDecode` is changed to accept and forward a `DegenerateReason`, never an `Error.message`. The codes live in `decode/types.ts` and are mirrored byte-for-byte in the WGSL outcome encoding; both are part of the cache signature.
- Pros: satisfies the spec verbatim (named reasons, `DEGENERATE(reason)`); one source of truth for CPU and GPU; downstream `switch` is exhaustive (TS `never` check) and the GPU can histogram reasons; minimal, closed, and ratifiable; COLLISION_T0 stays where the spec already puts it.
- Cons: adding a future reason requires bumping the cache signature and updating the WGSL mirror — but that friction is the point (it forces a deliberate contract change).
- Cost: ~1 enum + 1 WGSL `const` block + 1 fixture; lowest *total* cost given GPU needs the integer anyway.

### Option D — Open enum with an `OTHER`/`UNKNOWN` escape hatch
How it works: Option C plus a catch-all `DEGENERATE_OTHER` for un-categorised throws.
- Pros: `safeguardDecode` always has a target even for an unanticipated exception.
- Cons: the escape hatch becomes a silent dumping ground that re-opens the drift the contract is meant to close; "rare numerical failures" (§6.8) get hidden behind one opaque code instead of being promoted to a named reason.
- Cost: same as C; worse hygiene.

## Decision

**Adopt Option C.** It is the simplest option that satisfies both the science (named, distinguishable degeneracies the inspector and reduction can read) and the multi-agent build (one frozen integer table shared by CPU and GPU, exhaustively matchable). `COLLISION_T0` remains a separate terminal kind, matching §1 and §6.8.

The closed enum (codes chosen so `0` is reserved/non-terminal and the `1x` band is "decode-time terminal", leaving room below for the post-integration outcomes `collision/escape/bounded/timeout` from the numerics skill):

| Reason | u32 | Source in spec | Trigger |
|---|---|---|---|
| `M01_TINY` | 10 | §6.1 line 201 | `M01 = m0+m1 < ε` (inner-pair mass vanishes; Jacobi reconstruction undefined). This is the only spec-named reason and keeps its name. |
| `MASS_SATURATION` | 11 | §6.1 line 201 | softmax/tanh logit saturation drives a mass below the positivity floor (decode-time, distinct from the lookup-side `lookup_clamped`). |
| `ALPHA_CLAMPOUT` | 12 | §6.2 line 216-218 | the `α_min` buffer / sigmoid saturation pins the configuration onto the excluded boundary so the shape is degenerate. |
| `JACOBI_GUARD` | 13 | §6.3 line 221-224 | unweight/reconstruction guard fails (`√μ_ρ` or `√μ_λ` underflow, non-finite Jacobi vector). |
| `MIRROR_TIE` | 14 | §2 line 101, §6.2 line 244 | the deadbanded mirror rule cannot resolve a gauge tie at `λ̃_y = 0` within `δ_λ`. |
| `INFEASIBLE_ENERGY` | 15 | §7.2 line 315 | invariant-momentum: `K* < K_min` (target energy below the rigid-rotation floor). |
| `MOMENTUM_SEEDS_EXHAUSTED` | 16 | §7.2 line 313 | invariant-momentum: all projected-direction seeds fail `‖w⁽²⁾‖²_m > ε_w`. |
| `NONFINITE` | 17 | numerics skill line 107 | any decode-time NaN/Inf reaching the no-holes guard (the catch-all for `safeguardDecode`, but **named**, not free-string and not an open `OTHER`). |

`COLLISION_T0` is **not** in this enum; it is `{ kind: 'COLLISION_T0', pair }` with its own outcome code in the post-integration band, as M2's `canonicalise.ts` already emits.

Rationale for rejecting D's escape hatch: `NONFINITE` is the deliberate, named home for "rare numerical failures" (§6.8). It is a real category (the numerics skill makes NaN/Inf terminal), not an unbounded `OTHER` — so `safeguardDecode` has a legal target without re-opening drift.

This is a recommendation for human ratification. If a genuinely new failure mode appears, it gets a new named member and a cache-signature bump — never a free string.

## Consequences

Downstream artifacts that must reflect this once ratified:

- **`principia/src/decode/types.ts`**: add `export const enum DegenerateReason { M01_TINY = 10, ... NONFINITE = 17 }` (or a frozen `as const` map plus a union type) and change `TerminalLabel`'s `DEGENERATE` variant from `reason: string` to `reason: DegenerateReason`.
- **`principia/src/decode/no_holes.ts`**: `safeguardDecode`'s `fallback` signature changes from `(reason: string)` to `(reason: DegenerateReason)`; the `(e as Error).message ?? 'unknown'` path is replaced by classifying into a member (default `NONFINITE`).
- **`principia/src/decode/pipeline.ts`**: the existing `{ kind: 'DEGENERATE', reason: 'M01_TINY' }` becomes `reason: DegenerateReason.M01_TINY`; the configuration/momentum/Jacobi guards emit their respective members.
- **WGSL decode/diagnostics shader + `principia/src/decode/` GPU outcome encoding**: a `const` block mirroring the same u32 codes; the per-pixel decode writes the reason into the `SimResult` outcome field. The `principia-gpu` skill's `SimResult`/`TileReduction` layout notes must reserve the reason field, and `TileReduction`'s outcome histogram gains the degenerate sub-buckets.
- **`principia-architecture` skill** (§"Totality is an architectural invariant") and **`principia-numerics` skill** (§"Totality"): add a pointer to this ADR as the authoritative reason list; both currently say `DEGENERATE(reason)` without enumerating.
- **M2 milestone** (`milestones/M2_decoder_atlas.md`): the `pipeline.test.ts` totality test and `decode_landmarks` golden gain reason-coverage assertions; `safeguardDecode` doc comment updated.
- **M3**: any reduction/diagnostics consumer that switches on outcome must use the shared codes; the cache signature (per the architecture skill's "all acceptance and numerical constants belong in the cache signature") must include the enum-code table so changing a code invalidates cached tiles.

## Verification

A golden fixture `test/golden/degenerate_reasons.test.ts` that pins both membership and codes so neither can silently drift:

1. **Code-stability assertion (the drift guard):** assert the literal integer of every member, e.g. `expect(DegenerateReason.M01_TINY).toBe(10)` ... `expect(DegenerateReason.NONFINITE).toBe(17)`, and `expect(Object.keys(DegenerateReason).length).toBe(8)`. Changing or reordering a code breaks this test, forcing a deliberate cache-signature bump.
2. **CPU/GPU mirror assertion:** parse the WGSL `const` block (or its generated TS mirror) and assert every `DegenerateReason` member maps to the identical u32 in the shader; fails if the two tables diverge.
3. **Trigger fixtures (one decode input per reason):** a table of latent `z` / chart inputs each crafted to fire exactly one member — e.g. masses driven to `M01 < ε` for `M01_TINY`; saturated `z_μ` for `MASS_SATURATION`; an `(L_z,E)` point below the parabola apex for `INFEASIBLE_ENERGY`; a NaN-injecting input for `NONFINITE` — asserting `decodeLatent(z).terminal` equals `{ kind: 'DEGENERATE', reason: <member> }`. This pins the *meaning* of each code, not just its value.
4. **Exhaustiveness:** a `switch (reason)` with no `default` and a `const _: never = reason` in the unreachable branch, so adding a member without handling it is a compile error.
5. **COLLISION_T0 separation:** assert the collision-at-t=0 fixture yields `kind: 'COLLISION_T0'` and is **not** any `DegenerateReason`, locking the boundary between the two terminal families.
