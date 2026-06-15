# ADR 0006: TileReduction versioned offset map (vs hard-coded byte offsets)

- **Status:** Accepted (ratified into the spec 2026-06-15)
- **Date:** 2026-06-15
- **Gates:** M5, M6
- **Recommendation:** Generate the TS decoder, WGSL struct, and a schema-version field from one declarative TileReduction field table in src/gpu/structs.ts, pinned by a golden round-trip fixture.

---

## Context

`TileReduction` is, per the `principia-gpu` skill and spec, "the **only** struct that crosses GPU->CPU during normal operation, and only in the adaptive refinement layer." Its layout therefore has an unusual property the other structs do not: it must be *decoded* on the CPU, not just *packed*. The M5 milestone ships that decoder as `src/gpu/reduce_readback.ts`, and it reads the buffer by hand-computed byte offsets:

```ts
const o = 8 + m * 4;            // skip 16 bytes id+level (4 i32) + WGSL pad to vec4
...
const base = 8 + M * 4;
mean_arc_length_n: f32[base + 0],
spread_n:          f32[base + 6],
...
status_flags:      u32[base + 30],
```

Nothing connects these numbers to the WGSL struct in `reduce.wgsl` or to the spec's `TileReduction` definition. They are a third, undeclared copy of the layout — exactly the failure the skill forbids: "Every struct that crosses the CPU/GPU boundary has two declarations ... they describe **the same bytes**. `src/gpu/structs.ts` is the single source of truth ... If you change a field, you change it in **three** places in the same commit." The offset arithmetic in `reduce_readback.ts` is a *fourth* place that no rule currently governs.

This is not hypothetical drift. M6 is scheduled to mutate this exact struct: M6's "Notes for the implementer" says it will "wire the second-pass spread computation into `reduce.wgsl`" so that `spread_n`, `spread_diffusion`, `mean_word_length`, etc. become populated — and M5's `reduce.wgsl` already zero-fills those fields with a `// M6 fills this` comment. When an M6 build agent reorders, inserts, or re-types a field (e.g. promoting a reserved slot, adding a spread term), the WGSL struct and the `structs.ts` interface get updated, the alignment pin test catches a *size* change — but a field *reordering at constant size* leaves the hard-coded `f32[base + N]` indices silently pointing at the wrong lane. WGSL produces no error; the CPU reads a plausible-looking float into `coherence_score`, and the scheduler makes wrong split/keep/merge decisions for every tile. Because M5 and M6 are built by separate agents against the same contract, the offset map must be decided once and recorded so both stay in lockstep.

The spec already anticipates the versioning half of this. §`sec:tile_payload` ("Payload versioning") requires every cached payload to "carry a compact compatibility signature covering: ... payload schema version," and §`sec:tile_summary` gives `TileReduction` a `status_flags` field and a fixed field order. What the spec does *not* specify is the mechanism that keeps the TS decoder, the WGSL struct, and that schema version from diverging — that mechanism is what this ADR decides.

## Options

### Option A — Generated decoder from a single field table in `structs.ts`
A declarative table in `src/gpu/structs.ts` is the one source of truth for `TileReduction`:

```ts
export const TILE_REDUCTION_FIELDS = [
  { name: 'mean_arc_length_n', type: 'f32' },
  { name: 'spread_n',          type: 'f32' },
  ...
  { name: 'status_flags',      type: 'u32' },
] as const;
```

From this table, `structs.ts` computes WGSL offsets (applying the std430 rules already in the skill's alignment table), and exposes:
- `decodeTileReduction(ab, M)` — derived from the table, replacing the hand-written body in `reduce_readback.ts`;
- `wgslTileReductionStruct()` or a checked-in generated `.wgsl` snippet, so the WGSL struct is emitted from the same table;
- `TILE_REDUCTION_SCHEMA_VERSION` — a hash (or hand-bumped integer) of the field table.

The GPU writes `TILE_REDUCTION_SCHEMA_VERSION` into a dedicated field (reusing low bits of `status_flags`, or a new `schema_version` slot); the decoder asserts it matches and throws on mismatch.

- **Pros:** literally impossible to have TS/WGSL offset drift — both come from one array. The skill's "one artifact, three places" collapses to one place plus generated outputs. Schema version is automatic. Field reordering by an M6 agent is a one-line table edit that regenerates everything.
- **Cons:** requires a small codegen/offset-computer (~80 lines) and a decision on whether WGSL is emitted at build time or checked in. Slightly more machinery than M5 currently has.
- **Cost:** Medium. One new module in `structs.ts`, rewrite of `reduce_readback.ts` body to call it, one golden fixture. ~half a day.

### Option B — Hand-maintained offset-constant map + runtime schema-version guard
Keep three hand-written declarations but route the decoder through named offset constants instead of inline arithmetic, and add a schema-version field:

```ts
export const TR_OFF = { mean_arc_length_n: 0, spread_n: 6, ..., status_flags: 30 } as const;
export const TILE_REDUCTION_SCHEMA_VERSION = 3;
```

The WGSL writes the version into the struct; the decoder reads `TR_OFF.*` relative to `base` and asserts the version. Offsets are still typed by hand but live in one named map, and the version guard turns a silent corruption into a loud runtime throw.

- **Pros:** no codegen; minimal new concepts. The version field catches *any* layout change at runtime (the test/integration suite would throw immediately). Named constants are more legible than `base + 6`.
- **Cons:** the offsets are still hand-maintained and can still be edited inconsistently with the WGSL — the version guard catches it at runtime, not at the source. A developer who edits WGSL but forgets to bump the version still drifts silently until something throws; and if they bump the version *and* the offsets but get an offset wrong, the guard passes while the data is garbage.
- **Cost:** Low. Refactor inline offsets to a named map, add a version field to WGSL + struct + decoder. ~2 hours.

### Option C — Status quo + alignment pin test only (do nothing new)
Rely on the existing `layer0_struct_alignment.test.ts` size pin (the skill's existing discipline) and code review to keep the M5 decoder aligned.

- **Pros:** zero work now.
- **Cons:** the size pin catches only *size* changes. A constant-size field reordering — the most likely M6 edit — passes every test and silently corrupts `coherence_score`. Directly contradicts the brief's requirement to "decide once and record so multiple build agents stay consistent." Rejected.
- **Cost:** Zero now, high later.

## Decision

**Adopt Option A: a single declarative `TileReduction` field table in `src/gpu/structs.ts` that generates the TS decoder, the WGSL struct snippet, and a `TILE_REDUCTION_SCHEMA_VERSION`, with the GPU writing the version and the decoder asserting it.**

Rationale:

1. **It is the only option that removes the failure mode at the source rather than at runtime.** The brief asks for "a versioned, single-source offset map / schema-version field so TS and WGSL stay in lockstep, consistent with the principia-gpu rule that struct layout is one artifact changed in three places." Option A *makes it literally one artifact*: the field table is the artifact, and the WGSL struct, the TS interface/decoder, and the version are all derived from it. Option B keeps three artifacts and merely makes their divergence loud — better than today, but the brief explicitly wants the one-artifact property the skill already aspires to.

2. **`structs.ts` is already designated the single source of truth** ("`src/gpu/structs.ts` is the single source of truth: it computes each struct's size under WGSL alignment rules"). The skill already says it *computes* sizes from rules — extending it from "compute size" to "emit offsets, decoder, and WGSL" is the natural completion of an existing decision, not a new pattern.

3. **`TileReduction` is uniquely the right place to pay this cost.** It is the *only* GPU->CPU struct, so it is the only struct that needs a CPU *decoder* at all (the others only need packers, which the size pin already guards on the write side). Generating one decoder is proportionate; we are not proposing to codegen the whole GPU layer.

4. **It matches the cross-agent constraint.** M5 and M6 agents touch this struct in sequence. With Option A, an M6 agent's only correct move — editing the field table — automatically updates the decoder M5 shipped and bumps the version, so M5's `reduce_readback.ts` cannot fall out of date.

The schema version should be hand-bumped to start (a simple integer constant in the table module) rather than a content hash, to keep the generator trivial and the version human-meaningful in the spec's payload-compatibility signature; a hash can replace it later without changing the contract. Reuse the spare bits the spec already reserved — `status_flags` bits 6–7 are "reserved," and a dedicated `schema_version` would be cleaner if a slot is free at constant struct size; the build agent picks whichever keeps the 272-byte size, and the alignment pin enforces that choice.

## Consequences

This contract commits the following, and every M5/M6 build agent must reflect it:

- **`src/gpu/structs.ts`** gains the canonical `TILE_REDUCTION_FIELDS` table, an offset-computer applying std430 rules, `decodeTileReduction(ab, M)`, a WGSL-struct emitter (or a generated checked-in snippet), and `TILE_REDUCTION_SCHEMA_VERSION`. This is now the *only* place `TileReduction` field order is written by hand.
- **`src/gpu/reduce_readback.ts` (M5)** must delete its inline `decodeTileReduction` body and call `structs.ts`. The `const base = 8 + M*4` arithmetic and all `f32[base + N]` literals are removed.
- **`src/gpu/shaders/reduce.wgsl` (M5) and `metrics.wgsl`/reduce second pass (M6)** must use the generated WGSL struct (or be diffed against it in CI), and must write `TILE_REDUCTION_SCHEMA_VERSION` into the version field after reduction. M6's added `spread_n`/`spread_diffusion` second pass changes the table, which auto-regenerates both sides and bumps the version.
- **`src/quadtree/reduction_types.ts` (M5)** `TileReduction` interface stays, but its field order is now asserted to match the table (the generator can derive the interface, or a type-level/test check pins it).
- **The alignment pin test** (`layer0_struct_alignment.test.ts` per the skill) keeps its 272-byte assertion for `TileReduction`; the new golden fixture (below) is added alongside it.
- **The `principia-gpu` skill** should be updated: for `TileReduction` specifically, the "three places" rule becomes "one place (the field table) plus a pinning fixture," and the skill's catalogue note for `TileReduction` should point at the table and version constant.
- **Spec §`sec:tile_payload` payload-compatibility signature** should reference `TILE_REDUCTION_SCHEMA_VERSION` as the concrete realisation of its required "payload schema version" component, so the cache-key/compatibility machinery and the GPU->CPU decoder share one version source.
- **M6 milestone** ("Order of integration into M5") gains an explicit step: "edit `TILE_REDUCTION_FIELDS` in `structs.ts` and bump `TILE_REDUCTION_SCHEMA_VERSION`; do not hand-edit decoder offsets."

## Verification

Pin the decision with a **golden round-trip fixture** that fails the moment any layout or version drifts, plus a guard test:

1. **Golden byte fixture (`test/golden/tile_reduction_layout.test.ts`).** Check in a fixed `ArrayBuffer` (e.g. `tile_reduction.m8.golden.bin`) whose bytes are a hand-verified `TileReduction` at `M=8` with a *distinct sentinel value per field* (e.g. each field set to its own field-index, so `mean_arc_length_n=100.0`, `spread_n=106.0`, … `status_flags=130`). The test runs `decodeTileReduction(golden, 8)` and asserts every field equals its sentinel. Any reordering, insertion, or retyping in `TILE_REDUCTION_FIELDS` shifts a sentinel into the wrong field and fails loudly — catching exactly the constant-size reorder that the size pin misses.

2. **Generated-vs-checked-in WGSL diff.** A test asserts `wgslTileReductionStruct()` equals the struct text compiled into `reduce.wgsl` (string compare, or compile both and compare member offsets). This catches a WGSL edit that bypasses the table.

3. **Schema-version guard test.** A test feeds the decoder a buffer whose version field is `TILE_REDUCTION_SCHEMA_VERSION + 1` and asserts `decodeTileReduction` throws. This proves the runtime guard is wired, so a stale cached payload or a mismatched dispatch is rejected rather than silently misread.

When M6 changes the layout, the correct workflow is: edit the table, bump the version, regenerate the golden `.bin` (a one-line script that writes sentinels through the new table), and re-run. The three tests then re-lock the new layout. The fixture is what makes the contract un-driftable: it is impossible to land a layout change that compiles, passes the size pin, and yet decodes wrong.
