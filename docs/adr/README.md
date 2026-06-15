# Architecture Decision Records

Cross-milestone contract decisions for Principia. **All are _Proposed_** — pending ratification into `research/spec/principia_spec_revised.tex`. See plan Workstream A.

| # | Decision | Gates | Recommendation |
|---|----------|-------|----------------|
| 0001 | [Shape-sphere checkpoint-time schedule](0001-checkpoint-schedule.md) | M3, M6, inspector | Adopt closed-form equal spacing with no t=0 anchor: t_m = m·T/M for m=1..M (right-aligned endpoints, t_M = T), fixed for all tiers and charts. |
| 0002 | [Outcome-class enum to u32 mapping](0002-outcome-class-enum.md) | M3, M5, M6 | Pin BOUNDED=0, COLLISION=1, ESCAPE=2, DEGENERATE=3, TIMEOUT=4 (low 3 bits of sample_descriptor) in a single shared file generated into both a TS enum and a WGSL const, fold MAX_SUBSTEPS/SIM_FAILED into existing classes, and lock it with a parity golden test. |
| 0003 | [Default FTLE perturbation variant per quality tier](0003-ftle-variant-per-tier.md) | M6, M9 | Full phase-space Benettin FTLE in Research tier only; Preview and Balanced compute no FTLE (FTLE_VALID always clear, ftle=0); FTLE_VALID is set iff the tier enabled FTLE AND benettinCount>0 AND the run is numerically finite. |
| 0004 | [Free-group word encoding for unequal masses](0004-free-group-unequal-masses.md) | M6, M10, M11 | Scope v1 to equal masses: the F2 word with fixed equator generators (1,0,0)/(-1/2,±√3/2,0) is the only validated, golden-pinned regime; unequal-mass slices compute the word against decoder-derived collision points but flag it WORD_UNCERTAIN and never gate refinement or science on it until a future ADR ratifies the general rule. |
| 0005 | [Layer-0 dispatch batching under WebGPU timeouts](0005-layer0-dispatch-batching.md) | M3 | Adopt fixed-size dispatch chunks (each chunk = one compute pass = one tile, 256x256 samples) submitted in centre-out raster order, one queue submit per chunk, with a per-frame generation token that lets the render loop abandon remaining chunks the instant the camera moves. |
| 0006 | [TileReduction versioned offset map (vs hard-coded byte offsets)](0006-tilereduction-offset-map.md) | M5, M6 | Generate the TS decoder, WGSL struct, and a schema-version field from one declarative TileReduction field table in src/gpu/structs.ts, pinned by a golden round-trip fixture. |
| 0007 | [DEGENERATE(reason) reason enumeration](0007-degenerate-reason-enum.md) | M2, M3 | Adopt a closed 8-member DegenerateReason enum with frozen u32 codes (10-17), reserving COLLISION_T0 as a separate terminal kind; downstream matches on the enum, never on free strings. |
