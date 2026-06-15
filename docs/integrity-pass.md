# Principia — cohesion / integrity pass (findings)

**Status: RESOLVED (2026-06-15).** The findings below were catalogued first
(commit `afc902c`), then fixed in a follow-up pass (commits `8d39756`,
`213c152`) on branch `chore/integrity-pass`. All HIGH + MED applied across the
14 milestone docs; LOW backlog noted in §C.4 + the P2 spec-citation pattern left
for implementation time. Fence balance and the 9 HIGH roots re-verified.
Cross-file consistency confirmed (M6 packer ↔ M7 consumer; M4 `QuadtreeView`
rename ↔ M5; `DegenerateReason` home `@/decode/types.js` ↔ M10/G11; made it a
plain enum for `isolatedModules`). The text below is the original findings record.

**Why this exists.** The planning push that produced the spec, the 7 ADRs, and
the G9–G16 milestones was bottom-up. The only adversarial review run so far
covered the spec/ADRs and the *new* G9–G16 docs. This pass closes three
top-down gaps: (A) is there one authoritative build order, (B) did the M-series
drift from the ratified ADRs, (C) do the M-series docs survive the same
cross-ref scrutiny G9–G16 got.

---

## Executive summary

| Part | What | Result |
|---|---|---|
| A | Build-order DAG + skill triggers + README reconciliation | 1 structural contradiction (G1/G3 ordering), README dep column understates ~18 milestones |
| B | ADR → milestone traceability (all 7 ADRs × gated milestones) | **4 DRIFT + 2 ABSENT**, all verified at `file:line`; rest CLEAN |
| C | M0–M9/M12 cross-ref sweep (11 reviewers) | **4 new HIGH + ~8 MED + LOW**; 3 sweep findings turned out to be the origin of Part-B items |

**Total: ~9 distinct HIGH roots, ~12 MED, ~14 LOW.** Full tally and a
DAG-ordered fix sequence are at the end of the doc.

**Must-fix before M3 is built** (these gate the first GPU milestone — note two
*precede* M3 in the chain):
- **C1** M0 `massFromSimplex` map disagrees with spec → M2 inherits wrong masses.
- **C2** M2 `Vec2` import resolves to nothing (unresolved symbol).
- **B2** M2 free-string DEGENERATE reasons (not the closed enum).
- **C3** M3 `SimUniforms` packer drops `mu_max/alpha_min/q_max` → GPU reads 0 →
  the M3 exit gate cannot pass.
- **B1** M3:807 outcome-class drift (max-substeps → DEGENERATE, should be TIMEOUT).
- **B5** M3 dispatch records no ADR-0005 chunking contract for M4/M5 to inherit.
- **A1** the G1/G3 ordering contradiction (M3 allocates bind groups + compiles
  shaders *before* G3/G1 exist).

The rest can be fixed just-in-time before their gating milestone.

---

## Part A — Authoritative build-order DAG

### A.1 The dependency graph (reconciled, fuller than the README)

The M-series is a clean linear chain. The G-series is a dependency web. Edges
below are the *full* data-flow dependencies (the README's "Depends on" column
lists only a partial/direct subset — see A.4).

```
M0
└─ M1 ── M2 ── M3 ── M4 ── M5 ── M6 ── M7 ── M8 ── M9
                                              └─ M10 ── M11 ── M12
G-series (web; earliest-buildable point in parens):
  G1  shader linker        needs M3 shaders (extends as M5/M6 add shaders)
  G3  bind-group authority needs M3, M5, M7
  G6  linearised decoder   needs M2, M3, M5, M6, G3
  G7  device-loss+spreads  needs M3, M5, G3
  G2  App orchestrator     needs M3, M4, M5, M7, M8, M9, M10, M12
  G4  chart uniforms       needs M10, G3
  G5  chart inverses       needs M8, M10
  G8  UI/CI/perf patches   needs M1, M5, M6, M7, M8, M9, G2
  G9  capability detect    needs M3
  G10 perf profiling       needs G2, G7, G8, G9
  G11 error/telemetry      needs G2, G7, G9, M5
  G12 full shell           needs G2, G8, G9, G11, M7, M8
  G13 a11y/CVD             needs G12, M7, M8
  G14 e2e/regression CI    needs G8, G12, G13, M3, M12
  G15 build/deploy         needs G1, G8, G14
  G16 docs                 needs M10, M12 (+ conceptually all)
```

**Cycle check:** the reconciled graph is acyclic. The M-chain is a total order;
every G-node points only at lower-or-equal M-nodes and earlier G-nodes.

### A.2 Recommended linear build order

`M0 → M1 → M2 → M3 → G1 → M4 → M5 → M6 → G6 → M7 → G3 → G7 → M8 → M9 → G9 →
M10 → G4 → G5 → M11 → M12 → G2 → G8 → G10 → G11 → G12 → G13 → G14 → G15 → G16`

This is *one* valid topological order; the only hard ordering constraints are the
edges in A.1. (G1/G3 placement is contested — see A.3.)

### A.3 FINDING A1 (HIGH) — G1/G3 ordering contradiction

`milestones/README.md` lines 38–45 say the G-series is implemented **after** the
M-series, yet also that "G1 unblocks every GPU milestone, G3 must land before any
pipeline allocates real bind groups." These cannot both hold: **M3 already
compiles WGSL and allocates bind groups** (it defines `simulate.wgsl`,
`render.wgsl`, and the struct/bind-group contracts) — long before G1's linker or
G3's `Layouts` module exist. Same for M5/M7.

This is unresolved in the docs. The fix-pass must pick one and write it down:
- **(rec.)** M3/M5/M7 land with *provisional* inline shader strings and
  per-pipeline bind-group definitions; G1 and G3 are explicit *refactors* that
  later centralise them. State this in M3 and in G1/G3's "Goal".
- or pull G1/G3 earlier (right after M3) as true prerequisites, and have M5/M7
  consume them from the start.
- **Home:** `milestones/README.md` ordering note + M3/G1/G3 "Goal" sections.

### A.4 FINDING A2 (MED) — README "Depends on" column understates real deps

The README dependency column lists a partial/direct subset; milestone bodies
imply more. A multi-agent build reading only the table would miss prerequisites.
Disagreements found (README → fuller, from doc bodies):

| Milestone | README says | Body implies (add) |
|---|---|---|
| M2 | M0, M1 | M1 only used by golden tests — confirm M0-only for decode path |
| M3 | M0, M2 | + M1 (f64 parity reference for the GPU integrator golden) |
| M8 | M7 | + M4 (`TileCacheKey` / navigation) |
| M9 | M2, M8 | + M1 (integrator), M6 (metrics to validate against) |
| M10 | M8 | + M2 (decoders), M3 (chart-on-GPU path) |
| M12 | M11 | + M1, M5, M6, M8, M10 (acceptance touches the whole pipeline) |
| G1 | M3 | + M5, M6 (the shaders it links) |
| G2 | M5, M8 | + M3, M4, M7, M9, M10, M12 (orchestrates everything) |
| G4 | M3, M10 | M3 → **G3** (needs the bind-group authority, not raw M3) |
| G8 | G2 | + M1, M5, M6, M7, M8, M9 (hot-path patches reach into each) |
| G14 | G8, M12 | + G12, G13, M3 |
| G15 | G8 | + G1, G14 |

**Home:** `milestones/README.md` dependency column. Recommendation: make the
column list *direct* deps consistently and add a one-line "transitively needs…"
where the body reaches further.

### A.5 Skill-authoring triggers (just-in-time, inline in the order)

Author each skill *immediately before* its gating milestone so multi-agent
execution can't skip it:

| Before milestone | Skill to author | Status |
|---|---|---|
| (before G1) | `principia-gpu` shader-composition section | **DONE** (`ca73b5e`) |
| (before M8) | `principia-architecture` ViewState/cache discipline | **DONE** (`ca73b5e`) |
| M6 | `principia-metrics` | pending |
| M7 | `principia-render` | pending |
| M8 | `principia-interaction` | pending |
| M9 | `principia-inspector` | pending |
| M10 | `principia-charts` | pending |

Existing skills (`principia-numerics`, `principia-testing`, `principia-gpu`,
`principia-architecture`, `principia-milestone-workflow`) already cover M0–M5.

---

## Part B — ADR → milestone traceability

All 7 ADRs × their gated milestones. Each DRIFT/ABSENT below was **re-verified by
reading the cited line during this pass** (not taken from the scout on trust).

| # | ID | ADR | Milestone | Status |
|---|---|---|---|---|
| B-a | 0001 | checkpoint schedule | M3 | CLEAN (M3:756–758 `dtCkpt=T/M`, no t=0) |
| B-b | 0001 | checkpoint schedule | M6 | CLEAN (closed-closed windows) |
| B-c | 0001 | checkpoint schedule | M9 | re-confirm in sweep |
| **B1** | 0002 | outcome enum | M3 | **DRIFT** |
| B-d | 0002 | outcome enum | M5 | CLEAN (5-bucket histogram `& 0x7`) |
| B-e | 0002 | outcome enum | M6 | CLEAN (`outcomeClass 0..4`) |
| **B3** | 0003 | FTLE variant per tier | M9 | **DRIFT** |
| B-f | 0003 | FTLE variant per tier | M6 | CLEAN (single `ftle`, no `stretch` — confirmed by repo-wide grep) |
| **B6** | 0004 | free-group unequal | M6 | **ABSENT** (primary home) |
| B-g | 0004 | free-group unequal | M10, M11 | ABSENT (secondary — guard only) |
| **B5** | 0005 | layer-0 batching | M3 | **ABSENT** |
| **B4** | 0006 | TileReduction map | M5 | **DRIFT** |
| B-h | 0006 | TileReduction map | M6 | re-confirm in sweep (M6 reads the map) |
| **B2** | 0007 | degenerate reason | M2 | **DRIFT** |
| B-i | 0007 | degenerate reason | M3 | re-confirm in sweep |

### B1 (HIGH) — M3 outcome-class drift
- **Where:** `milestones/M3_layer0_gpu.md:806–807`
- **Offending:** `if (max_substeps_runs >= 1u) { terminal_kind = 3u; break; }`
- **Rule (ADR 0002):** class `3u` is **DEGENERATE**; max-substeps/stall is
  **TIMEOUT = 4u**.
- **Impact:** every stalled tile is silently counted as DEGENERATE in the M5
  reduction histogram, corrupting `outcome_impurity`.
- **Fix:** `terminal_kind = 4u;`  **Home:** M3.

### B2 (HIGH) — M2 free-string DEGENERATE reasons
- **Where:** `milestones/M2_decoder_atlas.md:391` and `:396`
- **Offending:** `fallback: (reason: string)` … `fallback((e as Error).message ?? 'unknown')`
- **Rule (ADR 0007):** reasons are the closed `DegenerateReason` enum (codes
  10–17); downstream never matches free strings.
- **Impact:** GPU path can't histogram reasons; `switch` can't be exhaustive;
  agents diverge.
- **Fix:** type the fallback as `(reason: DegenerateReason)`, default `NONFINITE`
  in the catch; keep the `'M01_TINY'` site (M2:427) but as the enum member.
  **Home:** M2 (and confirm `makeTerminal`/`TerminalLabel` carry the enum).

### B3 (HIGH) — M9 inspector FTLE seed is position-only
- **Where:** `milestones/M9_inspector.md:444–449`
- **Offending:** `perturb()` returns `r: [[s.r[0][0]+d, …], …], p: s.p` —
  momenta untouched.
- **Rule (ADR 0003):** the canonical FTLE seed perturbs **both positions and
  momenta**; position-only must not be labelled canonical FTLE. The `sep()`
  norm (M9:452) is already full phase-space — only the seed is wrong.
- **Impact:** inspector `ftle` is mislabelled canonical; the
  `ftle_chaotic_vs_regular` golden can pass while non-canonical.
- **Fix:** seed a normalised split across all 12 phase-space components.
  **Home:** M9.

### B4 (MED) — M5 hard-coded TileReduction offsets, no schema version
- **Where:** `milestones/M5_layer2_refinement.md:814–853`
- **Offending:** `const o = 8 + m*4; … const base = 8 + M*4; … f32[base + N]`
  for all 31 fields; no `TILE_REDUCTION_SCHEMA_VERSION`, no generated decoder.
- **Rule (ADR 0006):** generate the TS decoder + WGSL struct + version field
  from one declarative field table in `src/gpu/structs.ts`, pinned by a
  round-trip golden.
- **Impact:** M6 adds/reorders a field (e.g. a second-pass spread) and the
  hand-written `base + N` indices silently point at wrong lanes.
- **Fix:** replace the hand offsets with the generated offset-map decoder + a
  schema-version check. **Home:** M5 (table in `src/gpu/structs.ts`), consumed
  by M6.

### B5 (MED) — M3 records no ADR-0005 dispatch-chunking contract
- **Where:** `milestones/M3_layer0_gpu.md` `dispatchLayer0()` (~936–997); grep
  finds no `viewGeneration` / `chunk` / centre-out / per-chunk submit.
- **Rule (ADR 0005):** Layer-0 dispatch is fixed-size chunks (chunk = tile =
  N×N samples), centre-out order, one `queue.submit` per chunk, a
  `viewGeneration` token that abandons remaining chunks when the camera moves.
- **Impact:** M3's single-tile pass is fine *as a special case*, but it records
  no contract, so M4/M5 agents may ship a non-chunked layer that trips the
  WebGPU timeout guard.
- **Fix:** add the chunking-contract note to M3 (and/or its true home M4, which
  owns multi-tile dispatch). **Home:** M3 note → M4 implementation.

### B6 (MED) — `WORD_UNCERTAIN` flag never set (ADR 0004)
- **Where:** repo-wide grep finds `WORD_UNCERTAIN` only in
  `milestones/G16_documentation_onboarding.md:643` (docs index). M6 has the
  free-group word machinery and equal-mass basepoints (M6:529, :1217) but never
  sets the flag; M10/M11 don't mention it.
- **Rule (ADR 0004):** the F2 word is validated for **equal masses only**;
  unequal-mass slices set `WORD_UNCERTAIN` (sample_descriptor bit 9) and never
  gate refinement/science on the word.
- **Impact:** unequal-mass words look gold-standard; refinement could split on an
  unvalidated quantity.
- **Fix:** M6 packing sets `WORD_UNCERTAIN` when masses are outside the
  equal-mass ε band; M5/M11 refinement guards must not split on uncertain words.
  **Home:** M6 (set the bit) + M5/M11 (guard).

---

## Part C — M0–M9/M12 cross-ref sweep

11 reviewers (one per doc, findings-only), deduped against Part B. Three Part-C
findings turned out to be the *origin* of a Part-B item — folded in and marked
`[=Bn]`.

### C.1 New HIGH findings (independent of the ADRs)

| # | Where | Defect | Fix home |
|---|---|---|---|
| C1 | M0:432–437 `massFromSimplex` | Mass-simplex map uses bilinear `t·(1−t1·t2)`; spec map is `x=t1, y=(1−t1)t2, m=(1−x−y, x, y)`. **M2's `decodeMassSimplex` inherits the wrong base map** → wrong mass triples. (Also makes the "bijective" claim false: (0,0) and (1,1) both → [1,0,0].) | M0 (rewrite) + M0 corner test |
| C2 | M2:198 `momentum_free.ts` | imports `Vec2` from `./types.js`, which only *type-imports* it from `@/math/types.js` and never re-exports it → unresolved symbol, used in value position `as Vec2`. Siblings import `Vec2` from `@/math/types.js`. | M2 (fix the import) |
| C3 | M3:103–141 vs 678–684 | WGSL `SimUniforms` has `mu_max/alpha_min/q_max` (read by the decode shader) but the TS interface + `packSimUniforms` never declare/write f32[19..21] → shader reads **0** → mass/config/momenta collapse → **M3 exit gate (≥250/256) cannot pass**. | M3 (add 3 fields to packer) |
| C4 | M7:1046 | acceptance test imports `DEFAULT_RENDER_PARAMS` from `@/render/params.js`, but it lives in `@/render/types.js` → the exit test won't resolve. (This is the *source* of the canonical "DEFAULT_RENDER_PARAMS in types.js" rule the G-series review already enforced on consumers — M7 itself still has it wrong.) | M7 |

### C.2 New MED findings

| # | Where | Defect | Fix home |
|---|---|---|---|
| C5 | M4:112–121 vs M8:69–123 | **Two different `ViewState` types** both exported from module barrels: M4's quadtree `ViewState` (cacheKey/uvCentre/…) and M8's interaction `ViewState` (the documented single-source-of-truth). M5 imports the M4 one. Latent collision. | M4 (rename to `TileViewState`/`QuadtreeView`) |
| C6 | M6:15 & 1200 | Exit/acceptance command `npm test -- --run test/golden/metrics` matches **zero files** (golden suites are `figure8_word`/`ftle_chaotic_vs_regular`/`shape_sphere_landmarks` directly under `test/golden/`, no `metrics` substring) → vitest passes vacuously. | M6 (fix the exit command) |
| C7 | M6:1051/1064 | `figure8_word.test.ts` — sync `it(() => {…})` callback uses top-level `await import('@/integrate/kdk.js')`. Use the static import like the FTLE golden. | M6 |
| C8 | M9:747 | Unterminated string literal: `it('only the most recent move's session …'` — the apostrophe closes the quote → file won't parse → `test/unit/inspector` breaks. | M9 |
| C9 | M12:8/25/1101 | Cites "spec §7 acceptance gates" with checks **A1–A6**; the revised spec has **no §7** and no A1–A6 enumeration (it has an "Acceptance targets" appendix). The exit milestone cites a section that doesn't exist. | M12 (or add §7 to spec) |
| C10 | M1:876–878 | Burrau prose "body 1 (the lightest)…escapes" — body 1 is mass 4/12; the lightest is body 2 (3/12). The escaper-index contract (`body:1`) is fine; only the epithet is wrong and could mislead a golden regen. | M1 |
| C11 | M8:344/356 | `lockAffine`/`unlock` assign `lockedPhysical: undefined` to an optional-only prop → `exactOptionalPropertyTypes` typecheck error. | M8 |

### C.3 Cross-cutting patterns (each recurs across ≥2 docs)

- **P1 — `exactOptionalPropertyTypes` violations.** Explicit `undefined` assigned
  to optional-only props: M1:74/579 (`trace`), M8:344/356 (`lockedPhysical`).
  Likely lurks elsewhere — the fix-pass should grep `: undefined` across all
  milestone TS. (C11 + M1 LOW.)
- **P2 — stale numeric spec citations.** `§6.6`, `§7`, `§4.3.1`, `§1.6.x`, `§5.3.1`
  don't resolve — the revised spec uses named `\subsection`/`\label` anchors.
  Recurs in M0, M3, M6, M12. Project-wide citation hygiene (C9 is the only one
  that's MED because it's the exit milestone's gate).
- **P3 — sample_descriptor packing is the WORD_UNCERTAIN origin (= B6).** M6:441–467
  packs `encounterCount` at **bits 9–15 (7 bits)** with **no WORD_UNCERTAIN
  field** — exactly the bit-9 slot the ratified layout needs. M7:868 consumer
  mirrors the wrong `>>9 & 0x7f`. So B6's fix is concrete: insert WORD_UNCERTAIN
  at bit 9, move encounter_count to bits 10–15 (mask `0x3f`), update M7:868 to
  `>>10 & 0x3f`. **`[=B6]` — elevate to HIGH.**
- **P4 — TileReduction has four hand-maintained copies (= B4).** M5 ships the
  inline `decodeTileReduction` (offsets), a separate WGSL struct, a
  `reduction_types.ts` interface, and no schema-version write or pin test — the
  exact failure ADR 0006 forbids (its Consequences name `reduce_readback.ts` by
  file). **`[=B4]` — three M5 HIGHs + 1 MED all collapse here.**
- **P5 — exit-command vs file-tree drift.** C6 (M6) matches zero files; M12 has a
  `a_all.test.ts` not in its tree (LOW). The fix-pass should validate every
  milestone's exit command resolves to ≥1 real test path.

### C.4 LOW (deferred — fix at implementation time)

M0 spec-ref numbers; M1 unused imports + `trace` optional type; M3 spec-refs;
M4 `dispatch_layer0` prose; M6 free-word packing comment; M7 "32-byte" (is
64-byte); M8 unused imports; M9 `('BC'|'Euler'|'Lagrange')[]` precedence; M12
`a_all.test.ts` tree + `chart_params.nu`→`chartParams` comment.

---

## Consolidated tally & recommended fix order

**HIGH (8):** C1 (M0 simplex→M2), C2 (M2 Vec2), C3 (M3 SimUniforms), C4 (M7
render-params path), B1 (M3 outcome class), B2 (M2 degenerate reasons), B3 (M9
FTLE seed), B4/P4 (M5 TileReduction), B6/P3 (M6 sample_descriptor) — *(B4 and B6
each absorb multiple sweep findings; count them once → 9 distinct HIGH roots.)*

**MED (~12):** A1, A2, B5, C5–C11, plus P1/P5 sweeps.

**LOW (~14):** C.4 list + P2 citation hygiene.

**Recommended fix sequencing (respects the build DAG):**
1. **Before M2:** C1 (M0 simplex map — M2 inherits it).
2. **With M2:** C2, B2.
3. **Before M3:** A1 (G1/G3 ordering ruling).
4. **With M3:** C3, B1, B5.
5. **With M5:** B4/P4 (TileReduction offset map + schema version + pin test).
6. **With M6:** B6/P3 (sample_descriptor bit 9), C6, C7.
7. **With M7:** C4.
8. **With M8:** C5 (ViewState rename), C11; sweep P1.
9. **With M9:** B3, C8.
10. **With M12:** C9.
11. **README:** A2 (dependency column) + the ordering note from A1.
12. **Anytime:** the LOW backlog (C.4, P2).

Posture for the follow-up (recommended, your call): a fix workflow ordered as
above, HIGH+MED applied in place with per-fix verification, LOW left as a tracked
backlog — same posture that closed the G9–G16 review.
