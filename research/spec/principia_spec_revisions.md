# principia_spec — revision summary

The revised file is `principia_spec_revised.tex`, sitting alongside your
unchanged `principia_spec.tex` (3006 lines, byte-identical to the upload you
re-shared). The revisions below were applied directly on top of that.

## Edits in `principia_spec_revised.tex`

1. **Shape-sphere coordinate formula (§4.3.1).** Component slots permuted so that
   inner-pair collision lands at `(1,0,0) = b̂_1`, equilateral lands at the poles
   `(0,0,±1) = l̂±`, and the other two BCs sit at `(-1/2, ±√3/2, 0)`. The
   previous formula put the inner-pair collision at the south pole and the
   equilateral configuration on the equator. Added a "Convention check"
   paragraph that calls out the fix explicitly.

2. **α figure captions (§1.6.2, both `hyperspherical_jacobi` and `alpha_sphere`).**
   Reversed so the captions now track the decode formula `|ρ̃|=cos α`, `|λ̃|=sin α`:
   small α = body 2 sitting near the inner-pair COM (large `|ρ|`), α near π/2 =
   tight inner pair / hierarchical. The previous captions had it backwards.

3. **Diffusion validity paragraph relocated.** Moved out of §4.2 (Escape) into
   §4.3.2 (Frequency diffusion) where it belongs. Replaced the old single
   sentence with a four-bullet validity policy: full-window default, partial-
   window allowed in `W_2` with at least 3 checkpoints per window, `-1.0`
   sentinel (NaN forbidden under WGSL), and a note that M < 8 disables the
   metric.

4. **`T` notation disambiguated.** Parts V/VI now use `N` for
   `SAMPLES_PER_TILE_AXIS` and `T_pix` for the per-tile raster resolution. The
   previous text used `T` for both, which made the §6.2 (Tile pyramid) and
   Layer-0 sentences inconsistent. Updated `TileCacheKey` accordingly and added
   `quality_tier` as an explicit field.

5. **`TileID` defined.** It was used (`TileReduction`, `TileRequest`, the
   per-frame loop) but never defined; added a one-line struct.

6. **`TIMEOUT/MAX_SUBSTEPS` split into separate labels.** The old slash made it
   ambiguous whether one or two terminal labels were intended. Now: three
   separate labels (`SIM_FAILED`, `MAX_SUBSTEPS`, `TIMEOUT`), each with a
   distinct trigger.

7. **Full-retention memory cost corrected.** §5.2.4 said 176 bytes/sample at
   M=8, internally inconsistent with §6.6's 208 bytes from the field-by-field
   layout. Updated to 208 bytes / 218 MB at M=8 and 336 bytes / 352 MB at M=16
   (1024² viewport). Also added an explicit `maxStorageBufferBindingSize`
   note: the WebGPU baseline is 128 MiB, so partition or query at startup.

8. **Yoshida-4 "nearly free" claim softened.** Now states the amortisation
   argument applies to mixed-divergence tiles, not uniformly smooth ones, which
   still pay the full 3× force evaluations.

9. **Tilt section ("Givens rotation").** Renamed the subsection to
   "Tilt: rotating into hidden dimensions" and added a terminology note that
   the formula is Givens-style only when `q ⊥ e_k`. Also clarified that `q`
   in the formula is always the chart-defined initial basis, not the
   currently tilted one — tilts replace, they don't accumulate.

10. **`forbids_energy_normalisation` chart flag.** §1.6.6 now describes when
    energy normalisation is allowed and when it must be off; §3.4.2 lists this
    as one of three canonical chart-compatibility flags (alongside
    `has_redundant_hemisphere` and `requires_per_pixel_mass`) so the
    constraint lives in code, not just in prose.

11. **`SUSPECT_LZ` gated on absolute drift.** Bit 6 of `sample_descriptor` is
    now defined as `|ΔL_z,max| > τ_L_abs` rather than relative drift, because
    the relative form is dominated by the `ε_L` floor for trajectories starting
    near `L_{z,0}=0` (rest start) and would mark them spuriously.

12. **Shape-sphere β-fold redundancy made explicit.** §1.7.4 now says directly
    that the chart is a 2-to-1 cover (the canonical-frame decoder gauges away
    the reflection that maps `(θ, φ)` to `(θ, 2π−φ)`), with a recommendation
    to either render only one hemisphere or label the redundancy.

13. **Inspector-vs-GPU validation caveat.** §3.3.6 now flags that comparing
    energy traces between a non-symplectic inspector (RK45) and a symplectic
    GPU pipeline (KDK / Yoshida) is not apples-to-apples, and recommends a
    "match-integrator" mode for true cross-checks.

## A note on the chat review

A few of the issues I flagged in chat (the §1.7.4 realisation map inversion,
the "minimum of 4 checkpoints per window" wording, the 343 MB figure at M=16,
the prose claim that `quality_tier` is in the cache key) referenced lines in
a draft that doesn't match the file you re-shared. They appear to have come
from a stale read of the upload during the initial review pass, not from your
real document. If you do at some point introduce those paragraphs, the
edits in this revised file already give the correct treatment for them
(corrected formula, ≥3 checkpoints, 352 MB / 336 MiB, `quality_tier` now
explicitly in `TileCacheKey`).

## Ratified contract decisions (ADRs 0001–0007, 2026-06-15)

Seven cross-milestone contracts that the body left open or underspecified were
ratified and applied. Full records (context/options/consequences/verification)
live in `docs/adr/`; a new "Ratified contract decisions (ADRs)" appendix section
in `principia_spec_revised.tex` carries the authoritative summaries.

1. **Checkpoint schedule (ADR 0001, §4.3).** Equal spacing, no `t=0` anchor:
   `t_m = m·T/M`, `t_M = T`. Diffusion windows closed–closed with `t=T/2` in
   both `W₁` and `W₂` → exactly 3 checkpoints/window at M=8. Part of the cache
   signature; identical on GPU (f32) and inspector (f64).
2. **Outcome-class enum (ADR 0002, §6.6).** `BOUNDED=0, COLLISION=1, ESCAPE=2,
   DEGENERATE=3, TIMEOUT=4`, single source `src/gpu/outcome_class.ts`. **Fixed a
   spec/code conflict**: the §6.6 `sample_descriptor` table previously read
   `escape(0), bounded(1), collision(2)…`, contradicting the M3 shader and
   M5/M6 reduction; the table line was corrected to the code's mapping.
3. **FTLE variant per tier (ADR 0003, §4.3.3).** Full phase-space Benettin FTLE
   only, Research tier only; Preview/Balanced leave `ftle=0`, `FTLE_VALID`
   clear. IC-manifold / position-only deferred.
4. **Free-group word, unequal masses (ADR 0004, §4.6).** Trusted only in the
   equal-mass regime (generators frozen at spec constants). Unequal masses →
   `WORD_UNCERTAIN`, excluded from refinement/diagnostics; general rule deferred.
5. **Layer-0 dispatch batching (ADR 0005, §6.1.1).** Fixed chunks (1 chunk = 1
   tile = 1 N×N pass), centre-out raster, one submit/chunk, bounded chunks/frame,
   `viewGeneration` token to skip stale chunks (in-flight never cancelled).
6. **TileReduction schema (ADR 0006, §6.6).** Single declarative field table in
   `src/gpu/structs.ts` generating the TS decoder + WGSL snippet +
   `TILE_REDUCTION_SCHEMA_VERSION` (GPU writes, CPU asserts). No hand-coded
   offsets.
7. **DEGENERATE reason enum (ADR 0007, §1.2).** Closed integer reason enum
   (`M01_TINY=10`, …; `1x` band = decode-time terminal; `0–4` reserved for ADR
   0002 outcomes). `COLLISION_T0` stays a separate terminal kind; shared CPU/GPU
   table, matched as an enum not strings.
