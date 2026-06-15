# ADR 0002: Outcome-class enum to u32 mapping

- **Status:** Accepted (ratified into the spec 2026-06-15)
- **Date:** 2026-06-15
- **Gates:** M3, M5, M6
- **Recommendation:** Pin BOUNDED=0, COLLISION=1, ESCAPE=2, DEGENERATE=3, TIMEOUT=4 (low 3 bits of sample_descriptor) in a single shared file generated into both a TS enum and a WGSL const, fold MAX_SUBSTEPS/SIM_FAILED into existing classes, and lock it with a parity golden test.

---

## Context

`SimResult.sample_descriptor` is a packed `u32` whose low 3 bits hold the terminal **outcome class**. That class is written once on the GPU (M3) and then read by two independent consumers: the M5 reduction histogram (`reduce.wgsl`, which buckets samples into `shared_class_hist: array<atomic<u32>, 5>` indexed by `r.sample_descriptor & 0x7u`) and the M6 packer (`packing.ts`, `packSampleDescriptor` / `unpackSampleDescriptor`, field `outcomeClass: 0|1|2|3|4`). The spec describes the field but never pins the integers: §6.6's canonical per-sample summary table lists "outcome class | uint | broad category (bounded/escape/collision/…)" and a separate "event code | uint | sub-detail (which body/pair, degenerate reason)". The parenthetical is illustrative, not normative, and the ellipsis is doing real damage. The spec's failure-handling section (§"Failure handling") names a *different* set of terminal labels again (`SIM_FAILED`, `MAX_SUBSTEPS`, `TIMEOUT`), with no statement of which broad class each collapses into.

The audit is correct that there is no enum→u32 contract, and the M3 milestone already contains at least four mutually inconsistent encodings of the same 3-bit field:

- `render_layer0.wgsl` colour switch: `0=bounded, 1=collision, 2=escape, 3=degenerate, 4=timeout/max_substeps`.
- `simulate.wgsl` integration loop: on a max-substeps stall it executes `terminal_kind = 3u` (line ~807), then writes `sample_descriptor = (terminal_kind & 0x7u) | …`. Code `3` is **DEGENERATE** in the render switch and in M6's packer. So every stalled tile is silently counted as DEGENERATE by the M5 histogram. This is exactly the "mismatch corrupts histograms silently" failure.
- `events.wgsl` `EventOut.kind`: `1=collision, 2=escape, 3=max_substeps, 4=sim_failed` — a *third* numbering where `3` and `4` mean something else again.
- `decode.wgsl` `ICOut.terminal`: a private `0=none, 1=degenerate, 2=collision_t0` enum, funnelled through `write_terminal` which emits descriptor class `1` (collision) for a `t=0` collision.

On the TypeScript side the ground truth is M0's `TerminalLabel`, a 9-member discriminated union (`NONE, DEGENERATE, COLLISION_T0, COLLISION, ESCAPE, BOUNDED, TIMEOUT, MAX_SUBSTEPS, SIM_FAILED`). The M3 integration test (`layer0_gpu_vs_cpu.test.ts`) hand-maps these to integers inline (`COLLISION?1 : ESCAPE?2 : BOUNDED?0 : DEGENERATE?3 : 4`), duplicating the contract a fifth time. Nine TS labels must be projected onto the 5 broad GPU classes, and that projection is currently implicit and inconsistent.

This gates M3 (writer + `& 0x7u`), M5 (5-bucket histogram, `outcome_impurity`, `dominant_outcome`), and M6 (pack/unpack). Multiple build agents are implementing these milestones in parallel against the milestone docs as-written, so the contradictions will ship unless the integers, their home, and their lockstep mechanism are fixed now.

## Options

### Option A — Pin the de-facto render/packer mapping, single shared source, fold the extra labels

Adopt the mapping the render shader and M6 packer already imply:

```
BOUNDED   = 0
COLLISION = 1
ESCAPE    = 2
DEGENERATE= 3
TIMEOUT   = 4
```

Place it in one file, `src/gpu/outcome_class.ts`, exporting a TS `const enum`/object plus a `wgsl` string literal:

```ts
export const OUTCOME_CLASS = { BOUNDED:0, COLLISION:1, ESCAPE:2, DEGENERATE:3, TIMEOUT:4 } as const;
export const OUTCOME_CLASS_WGSL = `
const OC_BOUNDED:   u32 = 0u;
const OC_COLLISION: u32 = 1u;
const OC_ESCAPE:    u32 = 2u;
const OC_DEGENERATE:u32 = 3u;
const OC_TIMEOUT:   u32 = 4u;`;
```

The WGSL string is prepended to the shader source by the existing `concatShaders()` step, so TS and WGSL read from the *same* file — no codegen build step. Define the canonical projection of M0's 9 TS labels onto the 5 classes in the same file: `NONE→BOUNDED` (loop ran to horizon), `COLLISION_T0→COLLISION`, `MAX_SUBSTEPS→TIMEOUT` (forward progress stalled, classify as "didn't classify in budget"), `SIM_FAILED→DEGENERATE` (state untrustworthy, same bucket as decode failures). Fix the M3 loop bug (`terminal_kind = 3u` → `OC_TIMEOUT` i.e. `4u`) and replace the inline mapping in the integration test with the shared projection function.

- **Pros:** Matches the encoding already baked into the render colour switch and M6 packer (least code churn there); keeps `BOUNDED=0` so a zero-initialised buffer reads as the benign "ran, bounded" class; single file is trivially greppable; no build-time codegen. Histogram's 5 buckets map 1:1 to classes 0..4 with no holes.
- **Cons:** `0=BOUNDED` means an uninitialised/never-written sample is indistinguishable from a genuinely bounded one (mitigated: M3 always writes every sample). Folding `SIM_FAILED` into `DEGENERATE` loses a distinction at the broad-class level (recoverable via the `event code` / detail bits).
- **Cost:** Low. New ~30-line file; three edits in M3 (loop bug, `write_terminal`, test); M5/M6 import the names instead of magic numbers. One golden test.

### Option B — Reserve 0 for UNKNOWN/unwritten, shift the real classes up

```
UNKNOWN=0, BOUNDED=1, COLLISION=2, ESCAPE=3, DEGENERATE=4, TIMEOUT=5
```

Same single-source mechanism as A, but a sentinel `0` distinguishes "never written" from "bounded".

- **Pros:** A zeroed buffer is unambiguously "no result yet"; defends against partial dispatches and read-before-write bugs.
- **Cons:** 6 classes overflow M5's `array<atomic<u32>, 5>` and M6's `0|1|2|3|4` type — both must change (histogram to 6, packer type widened). Contradicts the render switch and packer that already exist, so *more* churn, not less. The 3-bit field still fits (max 5), but every existing constant in M3/M5/M6 shifts by one, inviting exactly the off-by-one drift this ADR exists to prevent.
- **Cost:** Medium. Touches the histogram size, the packer's type union, the render switch, and every doc's example values.

### Option C — Keep magic numbers, document a table in the spec only

Leave each shader/TS site as-is but add a normative table to §6.6 and rely on review to keep them aligned.

- **Pros:** Zero code change now.
- **Cons:** Does not fix the live M3 `terminal_kind = 3u` corruption; provides no mechanical lockstep; "keep them aligned by hand across TS + 4 WGSL sites" is precisely the multi-agent failure mode. Rejected.
- **Cost:** Low effort, high latent risk.

## Decision

**Adopt Option A.** It is the simplest option that satisfies both the science and a multi-agent build: it ratifies the integers already implied by the render shader and the M6 packer (`BOUNDED=0, COLLISION=1, ESCAPE=2, DEGENERATE=3, TIMEOUT=4`), so M5's existing 5-bucket histogram and M6's `0|1|2|3|4` type are correct as written and need no resize. The single shared file `src/gpu/outcome_class.ts` is the one source of truth; the WGSL `const` block is a string export from that same file and is concatenated into the shader by the existing `concatShaders()` path, so TS and WGSL cannot diverge without editing one literal. No codegen build step is introduced.

The 9 M0 TS labels project onto the 5 GPU classes as: `BOUNDED, NONE → BOUNDED(0)`; `COLLISION, COLLISION_T0 → COLLISION(1)`; `ESCAPE → ESCAPE(2)`; `DEGENERATE, SIM_FAILED → DEGENERATE(3)`; `TIMEOUT, MAX_SUBSTEPS → TIMEOUT(4)`. Rationale for the two fold choices: `MAX_SUBSTEPS` means "made progress but didn't classify within budget", which is semantically `TIMEOUT`, not a numerical failure; `SIM_FAILED` means "state untrustworthy", which belongs with `DEGENERATE` (the decode-failure bucket) so the coherence score's `suspect_fraction` and the impurity term treat it as unreliable. Finer distinctions (which body, which pair, degenerate reason, sim-failed vs decode-degenerate) live in the *detail* bits (3–4) and the separate event-code path per §6.6, not the broad class.

This must fix the live bug in `simulate.wgsl`: the max-substeps branch `terminal_kind = 3u` becomes `OC_TIMEOUT` (`4u`); without that edit, ratifying the integers alone still leaves stalled tiles miscounted as DEGENERATE.

## Consequences

- **`src/gpu/outcome_class.ts` (new):** the canonical TS object + WGSL const string + a `terminalToOutcomeClass(label: TerminalLabel): number` projection helper. Every other site imports from here.
- **M3 `simulate.wgsl`:** replace literal `terminal_kind` writes with `OC_*`; fix the max-substeps branch to `OC_TIMEOUT`. `write_terminal` uses `OC_COLLISION` for `COLLISION_T0` and `OC_DEGENERATE` for the degenerate path. `concatShaders()` must prepend `OUTCOME_CLASS_WGSL`.
- **M3 `render_layer0.wgsl`:** switch arms keyed to `OC_*` (values already match, so colours are unchanged); the `cls==3` arm is DEGENERATE and `cls==4` is TIMEOUT — confirm comments.
- **M3 `events.wgsl`:** `EventOut.kind` is an *internal* event enum, not the descriptor class — rename its values or add a comment so no agent confuses `kind` (1=collision,2=escape,3=max_substeps,4=sim_failed) with the outcome class. The translation from `EventOut.kind` to outcome class happens at the descriptor write and must go through the `OC_*` names.
- **M3 `layer0_gpu_vs_cpu.test.ts`:** delete the inline `COLLISION?1:…` ladder; call `terminalToOutcomeClass`.
- **M5 `reduce.wgsl`:** `shared_class_hist` stays size 5; `dominant_outcome` and `outcome_impurity` are now defined against the pinned classes. Document that buckets are `[BOUNDED,COLLISION,ESCAPE,DEGENERATE,TIMEOUT]`.
- **M6 `packing.ts`:** `outcomeClass: 0|1|2|3|4` retained; add a type alias `OutcomeClass = (typeof OUTCOME_CLASS)[keyof typeof OUTCOME_CLASS]` so the union is generated from the source, not hand-written.
- **Spec §6.6:** replace the "(bounded/escape/collision/…)" parenthetical with the normative table and a pointer to `outcome_class.ts` as the implementation source of truth; add the 9→5 projection.
- **Decode/atlas (M2) and CPU run (M1):** unaffected at the type level (they keep the rich `TerminalLabel`); only the GPU-facing projection is pinned.

## Verification

A golden parity test `test/golden/outcome_class_contract.test.ts` that pins the integers and the lockstep, failing if any drift:

1. **Frozen integers:** assert `OUTCOME_CLASS` deep-equals `{BOUNDED:0,COLLISION:1,ESCAPE:2,DEGENERATE:3,TIMEOUT:4}` (a hard-coded literal in the test, so changing the source without changing the test is a visible diff and a deliberate act).
2. **TS↔WGSL lockstep:** parse `OUTCOME_CLASS_WGSL` with a regex (`const OC_(\w+):\s*u32\s*=\s*(\d+)u`) and assert the extracted name→value map equals `OUTCOME_CLASS`. This catches an edit to one literal but not the other.
3. **Histogram width:** assert `Math.max(...Object.values(OUTCOME_CLASS)) < 5` and `Object.values` are exactly `0,1,2,3,4` with no gaps, so M5's `array<atomic<u32>,5>` cannot silently under-allocate.
4. **Projection totality:** for every `kind` in M0's `TerminalLabel` union (enumerated explicitly in the test), assert `terminalToOutcomeClass` returns a value in `0..4`; specifically `MAX_SUBSTEPS→4`, `SIM_FAILED→3`, `COLLISION_T0→1`, `NONE→0` — locking the fold so no future edit re-routes `MAX_SUBSTEPS` back to `3`.
5. **Round-trip:** for each class `c`, `unpackSampleDescriptor(packSampleDescriptor({outcomeClass:c, …})).outcomeClass === c`.

This fixture is cheap (pure TS, no GPU) and runs in the M6 golden suite; because it hard-codes the integers in two independent places (the literal in step 1 and the regex-extracted WGSL in step 2), no single-file edit can move the contract without a red test.
